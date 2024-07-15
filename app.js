const { importJWK, jwtVerify } = require('jose');
const path      = require('path');
const fs        = require('fs').promises;
const os        = require('os');
const dns = require('dns').promises;
const { Buffer } = require('buffer');
const { CONSTANTS, Rodit, verify_isthererodit_getit, verify_rodit_isamatch, verify_rodit_islive, verify_rodit_isactive,
    verify_rodit_istrusted_issuingsmartcontract, nearorg_rpc_state, nearorg_rpc_tokensfromaccountid,nearorg_rpc_tokenfromroditid
     } = require('./middleware/rodit');

const config = {
    PORT: process.env.PORT || 3000,
    JWT_EXPIRATION: 3600, // 1 hour
    ACCOUNT_FILE_PATH: path.join(
        os.homedir(),
        '.near-credentials',
        'testnet',
        '7fa445b786f8358c5125801cc914364668fed057d9ef80f814c60deedbabc9f2.json'
    ),
    APP_NAME: 'your-app-name',
    APP_CLIENT: 'your-app-client'
};

let token = '{"token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ2cG4uY2FibGVndWFyZC5uZXQiLCJzdWIiOiJiYz1uZWFyLm9yZztzYz0wOTMxMy1jYWJsZWd1YXJkLW9yZy50ZXN0bmV0O2lkPTAxSjIxQTBTOU5KQ0ZYSFozVkE1M0swOTdNO3N1Yj0wMUoyMUEwU0NCUVZGN1JTS01ROTQ1RVQ1NyIsImF1ZCI6ImJjPW5lYXIub3JnO3NjPTA5MzEzLWNhYmxlZ3VhcmQtb3JnLnRlc3RuZXQ7aWQ9MDFKMjFBMFM5TkpDRlhIWjNWQTUzSzA5N00iLCJleHAiOjE3MjEwNjAxMDUsIm5iZiI6MTcyMDEzNzYwMCwiaWF0IjoxNzIxMDU2NTA1LCJqdGkiOiJqdGkwMUoyVkZDQkdBUlhQTUI4R0dER0RYR0pUNSIsInJvZGl0aWQiOiIwMUoyMUEwU0NGNFBDVjVCNE45UlZGUlNESyIsInJvZGl0aWRzaWduYXR1cmUiOiJ2V05UNkplaDVaa3ZUX21wRlZQSUoyQ2ZPOGFEWDhhME0xcXFDSzRxbGZILXd3Q2t6VDdHTmZQR0JreWFFN3plX0xLbU5PYnVhSkw4VmFKdzRuUnJDdyJ9.89ln8NQmPhUk4qJqQE7kysoeaJywYMhIvRxjbu9OC_zTarbCVx-i9ADeOS65l_ZgNE3wHoADp7W2ediH8VIjDQ"}';

async function base64url2jwk_public_key(peer_base64url_public_key) {
    const publicKeyJwk = {
        kty: "OKP",
        crv: "Ed25519",
        x: "Ix9lAYNP0Q5IKeC6ISTv1V56HyUHxWv7ZEKliMVXz70",
        use: "sig"
    };
    peer_jwk_public_key = await importJWK(publicKeyJwk, 'EdDSA');
    return peer_jwk_public_key;
}

async function validateToken(token) {
    try {
        const decodedtoken= Buffer.from(token, 'base64url').toString('utf-8');
        console.debug(`Info: token`,decodedtoken);
        console.debug(`Info: peer_jwk_public_key`,peer_jwk_public_key);
        const { payload, protectedHeader } = await jwtVerify(token, peer_jwk_public_key, {
            algorithms: ['EdDSA']
        });

        const now = Math.floor(Date.now() / 1000);

        if (payload.exp <= now) {
            throw new Error('Token has expired');
        }

        if (payload.nbf > now) {
            throw new Error('Token is not yet valid');
        }

        if (payload.iss !== 'vpn.cableguard.net') {
            throw new Error('Invalid issuer');
        }

        if (payload.aud !== 'bc=near.org;sc=09313-cableguard-org.testnet;id=01J21A0S9NJCFXHZ3VA53K097M') {
            throw new Error('Invalid audience');
        }

        return payload;
    } catch (error) {
        console.error('Token validation failed:', error);
        throw error;
    }
}

async function login(peer_roditid, peer_roditid_base64url_signature) {
    try {
        const response = await fetch('http://167.99.5.69:3000/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({peer_roditid, peer_roditid_base64url_signature }),
        });

        if (!response.ok) {
            throw new Error('Login failed');
        }

        const data = await response.json();
        token = data.token;

        await validateToken(token);

        console.log('Logged in successfully!');
        return true;
    } catch (error) {
        console.error(`Error: ${error.message}`);
        return false;
    }
}

async function accessProtectedRoute(echoInput) {
    try {
        await validateToken(token);

        const response = await fetch('http://167.99.5.69:3000/api/echo', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: echoInput }),
        });

        console.debug(`response:`, response);

        if (!response.ok) {
            throw new Error('Failed to access protected route');
        }

        const data = await response.json();
        console.debug(`Server response: ${JSON.stringify(data)}`);
    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

async function processAccountFile(accountFileName) {
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

async function findserver(tokenid) {
    const account_idargs = JSON.stringify({
        token_id: tokenid
    });
    try {
        // console.debug(`tokenid`,tokenid);
        // console.debug(`account_idargs`,account_idargs);
        const serviceprovider_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, "nft_token", account_idargs);
        // console.debug(`serviceprovider_rodit Rodit:`,JSON.stringify(serviceprovider_rodit));
        const dnsUrl = serviceprovider_rodit.metadata.subjectuniqueidentifierurl + ".";
        // console.debug(`dnsUrl`,dnsUrl);
        let ipaddress;
        try {
            const addresses = await dns.resolve4(dnsUrl);
            ipaddress = addresses[0];
            if (!ipaddress) {
                throw new Error(`No IP address found in the API Server DNS entry ${dnsUrl}`);
            }
        } catch (error) {
            throw new Error(`Error: API DNS entry not found. A DNS entry with the IP address of the API server ${dnsUrl} in the RODiT must be accessible`);
        }
        let peer_base64_pk = '=';
        try {
            const txtRecords = await dns.resolveTxt(dnsUrl);
            if (txtRecords.length === 0) {
                throw new Error(`No API Server Public Key found for ${dnsUrl}!`);
            }
            const peer_configs = txtRecords.flat().join(' ');
            const pk_start = peer_configs.indexOf('pk=');
            if (pk_start === -1) {
                throw new Error('Error: No Public Key found in the default API Server');
            }
            const pk_end = peer_configs.indexOf(';', pk_start);
            peer_base64_pk = peer_configs.slice(pk_start + 3, pk_end !== -1 ? pk_end : undefined);
        } catch (error) {
            throw new Error(`Error resolving TXT record: ${error.message}`);
        }
        let peer_bytes_pk;
        try {
            peer_bytes_pk = Buffer.from(peer_base64_pk, 'base64');
            if (peer_bytes_pk.length !== 32) {
                throw new Error('Invalid public key length');
            }
        } catch (error) {
            throw new Error(`Error: Failed Base64 decoding: ${error.message}`);
        }
        return {ipaddress,peer_bytes_pk};
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }
}

(async () => {
    const { accountId: ownrodit_hex_accountid, ownrodit_base58_private_key } = await processAccountFile(config.ACCOUNT_FILE_PATH);
    // console.debug(`ownrodit_hex_accountid:`,JSON.stringify(ownrodit_hex_accountid));
    // console.debug(`ownrodit_base58_private_key:`,ownrodit_base58_private_key);
    const result = await nearorg_rpc_state(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, ownrodit_hex_accountid);
    if (result === false) {
      throw new Error(`The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`);
    }
    const own_rodit = await nearorg_rpc_tokensfromaccountid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, ownrodit_hex_accountid);
    // console.debug(`Own Rodit:`,JSON.stringify(own_rodit));
    // console.debug(`own_rodit.metadata.serviceproviderid`,own_rodit.metadata.serviceproviderid);
    const { ipaddress, serviceprovider_base58_public_key } = await findserver(own_rodit.metadata.serviceproviderid);
    console.debug(`ipaddress`,ipaddress);
    console.debug(`peerrodit_base58_public_key:`,serviceprovider_base58_public_key);

    peer_jwk_public_key= await base64url2jwk_public_key("Ix9lAYNP0Q5IKeC6ISTv1V56HyUHxWv7ZEKliMVXz70");
    const own_rodit_id = '01J21A0SCBQVF7RSKMQ945ET57';
    const base64url_own_rodit_id_signature = 'kWtnUDj6AmnhJqJQ2eHJTcopnsis8HH7rGOgPc6gy2Ipv2zFgMmxTR/gZp+fgwRIiyIKHLzAtDmpQnnHw9+BDg==';

    const loginSuccess = await login(own_rodit_id, base64url_own_rodit_id_signature);

    if (loginSuccess) {
        const echoInput = 'Hello, World!';
        await accessProtectedRoute(echoInput);
    }
})();
