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
const { CONSTANTS, RODiT, verify_hasrodit_getit, verify_rodit_isamatch, verify_rodit_islive, verify_rodit_isactive,
    verify_rodit_istrusted_issuingsmartcontract, nearorg_rpc_state, nearorg_rpc_tokensfromaccountid,nearorg_rpc_tokenfromroditid
     } = require('./middleware/rodit');

// CG: Configuration to be added to a configuration file instead
const config = {
      CONFIGURATION_FILE_PATH: path.join(
        '/etc/rodit',
        'roditconfig.client'
      ),
};

let own_rodit;

async function croditconfig(configuration_file_path) {
    try {
      // Read the configuration file to get the path of the JSON file
      const configFileContents = await fs.readFile(configuration_file_path, 'utf8');
      const jsonFilePath = configFileContents.trim(); // Assuming the file contains just the path
  
      // Now read the JSON file using the path we got from the configuration file
      const accountFileContents = await fs.readFile(jsonFilePath, 'utf8');
      const json = JSON.parse(accountFileContents);
      
      const own_rodit_hex_accountid = json.implicit_account_id;
      if (typeof own_rodit_hex_accountid !== 'string') {
        throw new Error('Error: Invalid or missing account_id value');
      }

      console.debug('Info: Own Account ID:', own_rodit_hex_accountid);

      let own_string_private_key = json.private_key;
      if (typeof own_string_private_key !== 'string') {
        throw new Error('Error: Invalid private_key value');
      }

        // Check if the account is funded
        const result = await nearorg_rpc_state(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, own_rodit_hex_accountid);
      
        if (result === false) {
            throw new Error(`Error: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`);
        }
      
      own_rodit = await nearorg_rpc_tokensfromaccountid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, own_rodit_hex_accountid);
  
      const own_rodit_bytes_roditid = new Uint8Array(Buffer.from(own_rodit.token_id));

      const own_rodit_base58_private_key = own_string_private_key.split(':')[1];
      const own_rodit_private_key = bs58.decode(own_rodit_base58_private_key);
      const own_rodit_bytes_private_key = new Uint8Array(Buffer.from(own_rodit_private_key));

      const own_rodit_bytes_signature = nacl.sign.detached(own_rodit_bytes_roditid, own_rodit_bytes_private_key);
      const own_roditid_base64url_signature = Buffer.from(own_rodit_bytes_signature).toString('base64url');

      return { own_rodit, own_roditid_base64url_signature };
    } catch (err) {
      console.error(`Error: Processing configuration file: ${err.message}`);
      throw err;
    }
  }


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

async function validate_jwt_token(token) {
    try {
        const unverifiedpayload = decodeJwt(token);
        console.debug(`Info: API endpoint supplied JWT`,unverifiedpayload );
        console.debug(`Info: API endpoint supplied JWT`,unverifiedpayload.rodit_id );
        const account_idargs = `{"token_id": "${unverifiedpayload.rodit_id}"}`
        const sp_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, "nft_token", account_idargs);
        let serviceprovider_base64_public_key = Buffer.from(sp_rodit.owner_id, 'hex').toString('base64url');
        session_jwk_public_key = await base64url2jwk_public_key(serviceprovider_base64_public_key);
        const { payload, protectedHeader } = await jwtVerify(token, session_jwk_public_key, {
            algorithms: ['EdDSA']
        });

        const peer_rodit = await verify_hasrodit_getit(payload.rodit_id, payload.rodit_idsignature);
        const isVerified = await verify_rodit_isamatch(own_rodit.metadata.serviceproviderid, peer_rodit.metadata.serviceprovidersignature, peer_rodit.token_id);
        const isLive = await verify_rodit_islive(peer_rodit.metadata.notafter, peer_rodit.metadata.notbefore);
        const isActive = await verify_rodit_isactive(payload.rodit_id, own_rodit.metadata.subjectuniqueidentifierurl);
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
            body: JSON.stringify({peer_roditid, peer_roditid_base64url_signature}),
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

(async () => {
    const {own_rodit, own_roditid_base64url_signature} = await croditconfig(config.CONFIGURATION_FILE_PATH);

    // Locate the API endpoint
    port = 3000; // CG: hppt until https gets implemented
    apiendpoint = 'http://'+own_rodit.metadata.subjectuniqueidentifierurl+':'+port;

    // Log in
    const loginSuccess = await login(own_rodit.token_id,  own_roditid_base64url_signature);

    if (loginSuccess) {
        const echoInput = 'Hello, World!';
        
        // Access the protected route
        await accessProtectedRouteEcho(echoInput);
    }
})();
