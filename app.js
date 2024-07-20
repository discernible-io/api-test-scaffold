const path       = require('path');
const os         = require('os');
const bs58       = require('bs58');
const crypto     = require('crypto');
const fs         = require('fs').promises;
const dns        = require('dns').promises;
const { Buffer } = require('buffer');
const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const { importJWK, jwtVerify , decodeJwt }  = require('jose');
const { CONSTANTS, RODiT, verify_isthererodit_getit, verify_rodit_isamatch, verify_rodit_islive, verify_rodit_isactive,
    verify_rodit_istrusted_issuingsmartcontract, nearorg_rpc_state, nearorg_rpc_tokensfromaccountid,nearorg_rpc_tokenfromroditid
     } = require('./middleware/rodit');

// CG: Configuration to be added to a configuration file instead
const config = {
    ACCOUNT_FILE_PATH: path.join(
        os.homedir(),
        '.near-credentials',
        'testnet',
        '8f17766d5b66016fb69c0ed79e4b0e41cb0b43629042d10925d522d7450534b6.json'
    ),
};

let own_rodit;

// CG: Move to rodit.js
async function base64url2jwk_public_key(base64url_public_key) {
    
    const jwk_public_key = {
        kty: "OKP",
        crv: "Ed25519",
        x: base64url_public_key,
        use: "sig"
    };
    session_jwk_public_key = await importJWK(jwk_public_key, 'EdDSA');
    return session_jwk_public_key;
}

// CG: Move to rodit.js
async function validate_jwt_token(token) {
    try {
        const unverifiedpayload = decodeJwt(token);
        console.info(`Info: API endpoint supplied JWT`,unverifiedpayload );
        const account_idargs = `{"token_id": "${unverifiedpayload.roditid}"}`
        const sp_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, "nft_token", account_idargs);

        let serviceprovider_base64_public_key = Buffer.from(sp_rodit.owner_id, 'hex').toString('base64url');
        session_jwk_public_key = await base64url2jwk_public_key(serviceprovider_base64_public_key);
        const { payload, protectedHeader } = await jwtVerify(token, session_jwk_public_key, {
            algorithms: ['EdDSA']
        });

        const peer_rodit = await verify_isthererodit_getit(payload.roditid, payload.roditidsignature);
        const isVerified = await verify_rodit_isamatch(own_rodit.metadata.serviceproviderid, peer_rodit.metadata.serviceprovidersignature, peer_rodit.token_id);
        const isLive = await verify_rodit_islive(peer_rodit.metadata.notafter, peer_rodit.metadata.notbefore);
        const isActive = await verify_rodit_isactive(payload.roditid, own_rodit.metadata.subjectuniqueidentifierurl);
        const isTrusted = await verify_rodit_istrusted_issuingsmartcontract(own_rodit.metadata.subjectuniqueidentifierurl);

        if (!isVerified || !isLive || !isActive || !isTrusted) {
            throw new Error('Error: RODiT verification failed');
        }

        const now = Math.floor(Date.now() / 1000);
        if (payload.exp <= now) {
            throw new Error('Error: Token has expired');
        }

        if (payload.nbf > now) {
            throw new Error('Error: Token is not yet valid');
        }

        if (payload.iss !== own_rodit.metadata.subjectuniqueidentifierurl) {
            throw new Error('Error: Invalid issuer');
        }

        if (payload.aud !== own_rodit.metadata.serviceproviderid) {
             throw new Error('Error: Invalid audience');
        }

        return payload;
    } catch (error) {
        console.error('Error: Token validation failed:', error);
        throw error;
    }
}

// CG: Move to rodit.js
// CG: Strangely enough changing the names of these variables make the whole
// thing stop working. These are OWN RODiT not PEER RODiT
async function login(peer_roditid, peer_roditid_base64url_signature) {
    try {
        apiroute = '/login';
        const response = await fetch(apiendpoint+apiroute, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({peer_roditid, peer_roditid_base64url_signature }),
        });

        if (!response.ok) {
            throw new Error('Error: Login failed');
        }

        const data = await response.json();
        token = data.token;

        await validate_jwt_token(token);

        console.info('Info: Client of API endpoint is logged in');
        return true;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return false;
    }
}

async function accessProtectedRouteEcho(echoInput) {
    try {
        await validate_jwt_token(token);

        apiroute = '/api/echo';
        const response = await fetch(apiendpoint+apiroute, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: echoInput }),
        });

        if (!response.ok) {
            throw new Error('Error: Failed to access Echo protected route');
        }

        const data = await response.json();
        console.info(`Info: Server Response: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// CG: Move to rodit.js
async function readaccountkeys(accountFileName) {
    try {
      const accountFileContents = await fs.readFile(accountFileName, 'utf8');
      const json = JSON.parse(accountFileContents);
  
      const accountId = json.implicit_account_id;
      if (typeof accountId !== 'string') {
        throw new Error('Invalid or missing account_id value');
      }
  
      let own_string_private_key = json.private_key;
      if (typeof own_string_private_key !== 'string') {
        throw new Error('Invalid private_key value');
      }
      const ownrodit_base58_private_key = own_string_private_key.split(':')[1];
  
      return { accountId, ownrodit_base58_private_key };
    } catch (err) {
      console.error(`Error processing account file: ${err.message}`);
      throw err;
    }
  }

(async () => {
    // Retrieve the key pair from the account file
    const { accountId: ownrodit_hex_accountid, ownrodit_base58_private_key: ownrodit_base58_private_key } 
        = await readaccountkeys(config.ACCOUNT_FILE_PATH);
    console.debug('Info: Own Account ID:', ownrodit_hex_accountid);

    // CG: Move as a function to rodit.js
    // Check if the account is funded    
    const result = await nearorg_rpc_state(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, ownrodit_hex_accountid);
    if (result === false) {
      throw new Error(`Error: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`);
    }
    // Fetch the RODiT
    own_rodit = await nearorg_rpc_tokensfromaccountid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, ownrodit_hex_accountid);
    // Locate the API endpoint
    port = own_rodit.metadata.listenport; // This is fetched from RODiT but probably should come from DNS
    apiendpoint = 'http://'+own_rodit.metadata.subjectuniqueidentifierurl+':'+port;
    const ownrodit_private_key = bs58.decode(ownrodit_base58_private_key);
    const ownrodit_bytes_private_key = new Uint8Array(Buffer.from(ownrodit_private_key));
    const ownrodit_bytes_roditid = new Uint8Array(Buffer.from(own_rodit.token_id));
    const ownrodit_bytes_signature = nacl.sign.detached(ownrodit_bytes_roditid, ownrodit_bytes_private_key);
    const ownrodit_base64url_signature = Buffer.from(ownrodit_bytes_signature).toString('base64url');

    // Log in
    const loginSuccess = await login(own_rodit.token_id,  ownrodit_base64url_signature);

    if (loginSuccess) {
        const echoInput = 'Hello, World!';
        
        // Access the protected route
        await accessProtectedRouteEcho(echoInput);
    }
})();
