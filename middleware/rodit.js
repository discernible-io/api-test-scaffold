// Copyright (c) 2023 Cableguard, Inc. All rights reserved.

const bs58       = require('bs58');
const fs         = require('fs').promises;
const nacl       = require('tweetnacl');
nacl.util        = require('tweetnacl-util');
const { importJWK, jwtVerify , decodeJwt }  = require('jose');
const { Resolver } = require('dns').promises;

// CG: Move SMART CONTRACT and LOCKCHAIN_NETWORK to configuration file
const CONSTANTS = {
    SMART_CONTRACT: "10201-cableguard-org.testnet",
    BLOCKCHAIN_NETWORK: ".testnet", // IMPORTANT: Values here must be either ".testnet" for testnet or "." for mainnet
    RODIT_ID_SZ: 128,
    RODIT_ID_PK_SZ: 32,
    RODIT_ID_SIGNATURE_SZ: 64,
    ED25519_KEY_SZ: 64
};

const resolver = new Resolver();
// RODiT class
class RODiT {
    constructor() {
        this.token_id = "";
        this.owner_id = "";
        this.approved_account_ids = null;
        this.royalty = null;
        this.metadata = {
          openapijsonurl: "",
          notafter: "",
          notbefore: "",
          maxrequests: "",
          maxrqwindow: "",
          jwtduration: "",
          permissionedroutes: "",
          subjectuniqueidentifierurl: "",
          serviceproviderid: "",
          serviceprovidersignature: ""
        };
    }
}

/* async function croditconfig(configuration_file_path) {
  try {
    // Read the configuration file to get the path of the JSON file
    const configoptions = await fs.readFile(configuration_file_path, 'utf8');
    const pathaccountidfile = configoptions.trim(); // Assuming the file contains just the path

    // Now read the JSON file using the path we got from the configuration file
    const accountidfile = await fs.readFile(pathaccountidfile, 'utf8');
    const options = JSON.parse(accountidfile);
    
    const own_rodit_hex_accountid = options.implicit_account_id;
    if (typeof own_rodit_hex_accountid !== 'string') {
      throw new Error('Error: Invalid or missing account_id value');
    }

    console.debug('Info: Own Account ID:', own_rodit_hex_accountid);

    let own_string_private_key = options.private_key;
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
} */

async function roditconfig(configuration_file_path) {
  try {
    // Read the configuration file to get the path of the JSON file
    const configoptions = await fs.readFile(configuration_file_path, 'utf8');
    const pathaccountidfile = configoptions.trim(); // Assuming the file contains just the path

    // Now read the JSON file using the path we got from the configuration file
    const accountidfile = await fs.readFile(pathaccountidfile, 'utf8');
    const options = JSON.parse(accountidfile);
    
    const own_rodit_hex_accountid = options.implicit_account_id;
    if (typeof own_rodit_hex_accountid !== 'string') {
      throw new Error('Error: Invalid or missing account_id value');
    }

    console.debug('Info: Own Account ID:', own_rodit_hex_accountid);

    let own_string_private_key = options.private_key;
    if (typeof own_string_private_key !== 'string') {
      throw new Error('Error: Invalid private_key value');
    }

    const own_rodit_base58_private_key = own_string_private_key.split(':')[1];

      // Check if the account is funded
      const result = await nearorg_rpc_state(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, own_rodit_hex_accountid);
    
      if (result === false) {
          throw new Error(`Error: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`);
      }
    own_rodit = await nearorg_rpc_tokensfromaccountid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, own_rodit_hex_accountid);

    const own_rodit_bytes_roditid = new Uint8Array(Buffer.from(own_rodit.token_id));


    const own_rodit_private_key = bs58.decode(own_rodit_base58_private_key);
    const own_rodit_bytes_private_key = new Uint8Array(Buffer.from(own_rodit_private_key));

    const own_rodit_bytes_signature = nacl.sign.detached(own_rodit_bytes_roditid, own_rodit_bytes_private_key);
    const own_roditid_base64url_signature = Buffer.from(own_rodit_bytes_signature).toString('base64url');

    return { own_rodit, own_roditid_base64url_signature, own_rodit_bytes_private_key };
  } catch (err) {
    console.error(`Error: Processing configuration file: ${err.message}`);
    throw err;
  }
}

async function verify_hasrodit_getit(peer_roditid, peer_roditid_base64url_signature) {

    const account_idargs = `{"token_id": "${peer_roditid}"}`;

    try {
        // Ensure rodit_id and rodit_id_signature are Uint8Array
        const bytes_roditid = new Uint8Array(Buffer.from(peer_roditid));

        const bytes_ed25519_signature = new Uint8Array(Buffer.from(peer_roditid_base64url_signature, 'base64url'));

        const peer_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, "nft_token", account_idargs);
        
        const peer_bytes_ed25519_public_key = new Uint8Array(Buffer.from(peer_rodit.owner_id, 'hex'));

        const isVerified = nacl.sign.detached.verify(bytes_roditid, bytes_ed25519_signature, peer_bytes_ed25519_public_key);

        if (isVerified) {
            console.info('Info: Peer RODiT possession check passed');
            return peer_rodit;
        } else {
            console.error('Error: Peer RODiT possession check failed');
            throw new Error('PeerEd25519SignatureVerificationFailure');
        }
    } catch (err) {
        console.error(`Error: There is no Peer RODiT associated with the account: ${err}`);
        throw new Error('Error: PeerEd25519RoditMissing');
    }
}

async function verify_rodit_isamatch(ownServiceProviderId, peerServiceProviderSignature, peerTokenId) {

    // Obtain a Own Service Provider RODiT (Mother RODiT) from its ID
    const args_ownServiceProviderId = JSON.stringify({ token_id: ownServiceProviderId });
    let own_serviceprovider_rodit;
    try {
        own_serviceprovider_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, 'nft_token', args_ownServiceProviderId);
    } catch (error) {
        console.error('Error: Peer RODiT does not match Own RODiT - Fetching');
        return false;
    }

    let bytes_ownServiceProviderOwnerId;
   
    console.info('Info: Service Provider RODiT:', own_serviceprovider_rodit);
    console.info('Info: Peer Account ID:',own_serviceprovider_rodit.owner_id);
    try {
        bytes_ownServiceProviderOwnerId = new Uint8Array(Buffer.from(own_serviceprovider_rodit.owner_id, 'hex'));
    } catch (error) {
        console.error('Error: Failed to decode hex string');
        return false;
    }

    if (bytes_ownServiceProviderOwnerId.length !== CONSTANTS.RODIT_ID_PK_SZ) {
        console.error('Error: Invalid byte array length');
        return false;
    }

    const bytes_peerServiceProviderSignature = new Uint8Array(Buffer.from(peerServiceProviderSignature, 'base64'));

    if (bytes_peerServiceProviderSignature.length !== CONSTANTS.RODIT_ID_SIGNATURE_SZ) {
        console.error('Error: Invalid public key length');
        return false;
    }

    const bytes_peerTokenId = new Uint8Array(Buffer.from(peerTokenId));

    try {
        const isValid = nacl.sign.detached.verify(bytes_peerTokenId, bytes_peerServiceProviderSignature, bytes_ownServiceProviderOwnerId);

        if (isValid) {
            console.info('Info Peer RODiT matches Own RODiT');
            return true;
        } else {
            console.error('Error: Peer RODiT does not match Own RODiT');
            return false;
        }
    } catch (error) {
        console.error('Error: Peer RODiT does not match Own RODiT - Parsing public key');
        return false;
    }
}

async function verify_rodit_isactive(tokenId, ownsubjectuniqueidentifierurl) {
  const domainAndExtensionRegex = /(\w+\.\w+)$/;

  // Find the rightmost part (domain and extension)
  const match = ownsubjectuniqueidentifierurl.match(domainAndExtensionRegex);

  if (match) {
    const domainandextension = match[1];
    const revokingDnsEntry = `${tokenId}.revoked.${domainandextension}`;

    try {
      await resolver.resolveTxt(revokingDnsEntry);
      console.error(`Error: Peer RODiT ${tokenId} revoked by ${domainandextension} as per ${revokingDnsEntry}`);
      return false;
    } catch (error) {
      // If an Error is found, instead of an entry, the Peer RODiT is not revoked
      console.info("Info: Peer RODiT is not revoked");
      return true;
    }
  } else {
    // If no domain and extension match is found, the Peer RODiT is not revoked
    console.info("Info: Peer RODiT is not revoked");
    return true;
  }
}

async function verify_rodit_istrusted_issuingsmartcontract(ownsubjectuniqueidentifierurl) {
  const smartcontract = CONSTANTS.SMART_CONTRACT;
  const smartontractnonear = smartcontract.replace(".testnet", "");
  const smartcontracturl = smartontractnonear.replace("-", ".");

  const domainandextension = /(\w+\.\w+)$/;

  // Find the rightmost part (domain and extension)
  const maindomainmatch = domainandextension.exec(ownsubjectuniqueidentifierurl);
  if (maindomainmatch) {
    const domainandextension = maindomainmatch[1];
    const enablingdnsentry = `${smartontractnonear}.smartcontract.${domainandextension}`;
    
    try {
      const cfgresponse = await resolver.resolveTxt(enablingdnsentry);
      if (cfgresponse.length > 0) {
        console.info("Info: Smart Contract is trusted");
        return true;
      } else {
        console.error(`Error: Smart Contract ${smartcontracturl} not trusted by ${domainandextension} in verify_smartcontract_istruste`);
        return false;
      }
    } catch (err) {
      console.error(`Error: Smart Contract ${smartcontracturl} not trusted by ${domainandextension} in verify_smartcontract_istruste`);
      return false;
    }
  } else {
    console.error(`Error: Domain can't be parsed in verify_rodit_istrusted_issuingsmartcontract`);
    return false;
  }
}

async function verify_rodit_islive(peer_rodit_notafter, peer_rodit_notbefore) {
    // Helper function to parse date strings
    function parseDate(datestring) {
      const date = new Date(datestring);
      return isNaN(date.getTime()) ? new Date(0) : date;
    }
  
    // 1970-01-01 chosen as null date considering Unix and X.509 standards for timekeeping
    const datetimenul = new Date(0);
    
    const datetimenotafter = parseDate(peer_rodit_notafter);
    const datetimenotbefore = parseDate(peer_rodit_notbefore);
  
    // Assuming nearorgRpcTimestamp is an async function that returns a Promise
    return nearorg_rpc_timestamp(CONSTANTS.BLOCKCHAIN_NETWORK)
      .then(stringtimenow => {
        const timestamp = parseInt(stringtimenow, 10);
        if (isNaN(timestamp)) {
          console.error("Error: Can't parse near block timestamp");
          return false;
        }
  
        const datetimetimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds
  
        if (
          ((datetimetimestamp <= datetimenotafter) || datetimenotafter.getTime() === datetimenul.getTime()) &&
          ((datetimetimestamp >= datetimenotbefore) || datetimenotbefore.getTime() === datetimenul.getTime())
        ) {
          console.log("Info: Peer RODiT is live");
          return true;
        } else {
          console.error(
            "Error: Peer RODiT is not live - notbefore %s now %s notafter %s",
            datetimenotbefore.toISOString(),
            datetimetimestamp.toISOString(),
            datetimenotafter.toISOString()
          );
          return false;
        }
      })
      .catch(error => {
        console.error("Error: While checking time from blockchain", error);
        return false;
      });
  }

  // Obtain timestamp from blockchain
  async function nearorg_rpc_timestamp(xnet) {
    const url = `https://rpc${xnet}.near.org`;
    const jsonData = {
      jsonrpc: "2.0",
      id: "dontcare",
      method: "block",
      params: {
        finality: "final"
      }
    };
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(jsonData)
      });
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
  
      const parsedJson = await response.json();

      if (parsedJson.error) {
        throw new Error(`Error: ${parsedJson.error.message}`);
      }

      const timestamp = parsedJson.result?.header?.timestamp;
  
      return timestamp ? timestamp.toString() : "0";
    } catch (error) {
      console.error("Error in nearorgRpcTimestamp:", error);
      throw error;
    }
  }

// Obtain RODiT from RODiT ID
async function nearorg_rpc_tokenfromroditid(xnet, id, method_name, args) {
    const url = `https://rpc${xnet}.near.org`;

    const json_data = {
        jsonrpc: '2.0',
        id: id,
        method: 'query',
        params: {
            request_type: 'call_function',
            finality: 'final',
            account_id: id,
            method_name: method_name,
            args_base64: Buffer.from(args).toString('base64')
        },
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(json_data),
    })

    const json_response = await response.json();

    if (json_response.error) {
        throw new Error(`Error: ${json_response.error.message}`);
    }

    const result_array = json_response.result.result;

    if (!Array.isArray(result_array)) {
        throw new Error('Error: Result is not an array');
    }

    const result_bytes = result_array.map(v => v);

    const result_string = Buffer.from(result_bytes).toString('utf8');

    const rodit = new RODiT();
    Object.assign(rodit, JSON.parse(result_string)); 
    return rodit;
}

// Obtain state of the account id
async function nearorg_rpc_state(xnet, id, accountId) {
    const url = `https://rpc${xnet}.near.org`;
  
    if (xnet === '.') {
      console.info("Info: NEAR Blockchain Network is mainnet");
    } else {
      console.info(`Info: NEAR Blockchain Network is ${xnet}`);
    }
  
    const jsonData = {
      jsonrpc: "2.0",
      id: id,
      method: "query",
      params: {
        request_type: "view_account",
        finality: "final",
        account_id: accountId
      }
    };
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(jsonData)
      });
  
      const responseText = await response.json();
      if (JSON.stringify(responseText).includes("does not exist while viewing")) {
        console.error("Error: The NEAR account does not exist in the blockchain, it needs to be funded with at least 0.01 NEAR in this network");
        return false
      }
  
      return true
    } catch (error) {
      throw error;
      return false;
    }
  }

  // Obtain RODiT from account_id
  async function nearorg_rpc_tokensfromaccountid(xnet, id, account_id) {
      const url = `https://rpc${xnet}.near.org`;

      const args= JSON.stringify({ account_id: account_id, from_index: 0, limit: 1});
      const jsonData = {
          jsonrpc: "2.0",
          id: id,
          method: "query",
          params: {
              request_type: "call_function",
              finality: "optimistic",
              account_id: id,
              method_name: "nft_tokens_for_owner",
              args_base64: Buffer.from(args).toString('base64')
            },
      };
  
      try {
          const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonData)
          });
  
          const responseText = await response.text();
          const parsedJson = JSON.parse(responseText);
          const resultArray = parsedJson.result.result;
          if (!Array.isArray(resultArray)) {
              throw new Error("Result is not an array");
          }
  
          const resultBytes = new Uint8Array(resultArray);
          const resultString = new TextDecoder().decode(resultBytes);
          const resultStruct = JSON.parse(resultString);
  
          if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
              throw new Error("Error: No RODiT instance found");
          }
          // Only the first RODiT in the account is returned
          return resultStruct[0];
      } catch (error) {
          console.error("Error:", error.message);
          throw error;
      }
  }

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

async function validate_jwt_token(token,ownrodit) {
    try {
        const unverifiedpayload = decodeJwt(token,ownrodit);
        const account_idargs = `{"token_id": "${unverifiedpayload.rodit_id}"}`
        const sp_rodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, "nft_token", account_idargs);
        let serviceprovider_base64_public_key = Buffer.from(sp_rodit.owner_id, 'hex').toString('base64url');
        session_jwk_public_key = await base64url2jwk_public_key(serviceprovider_base64_public_key);
        const { payload, protectedHeader } = await jwtVerify(token, session_jwk_public_key, {
            algorithms: ['EdDSA']
        });

        const peer_rodit = await verify_hasrodit_getit(payload.rodit_id, payload.rodit_idsignature);
        const isVerified = await verify_rodit_isamatch(ownrodit.metadata.serviceproviderid, peer_rodit.metadata.serviceprovidersignature, peer_rodit.token_id);
        const isLive = await verify_rodit_islive(peer_rodit.metadata.notafter, peer_rodit.metadata.notbefore);
        const isActive = await verify_rodit_isactive(payload.rodit_id, ownrodit.metadata.subjectuniqueidentifierurl);
        const isTrusted = await verify_rodit_istrusted_issuingsmartcontract(ownrodit.metadata.subjectuniqueidentifierurl);


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

        if (payload.iss !== ownrodit.metadata.subjectuniqueidentifierurl) {
            throw new Error('Error: Invalid issuer');
        }

        if (payload.aud !== ownrodit.metadata.serviceproviderid) {
             throw new Error('Error: Invalid audience');
        }

        return payload;
    } catch (error) {
        console.error('Error: Token validation failed:', error);
        throw error;
    }
}

async function dateStringToUnixTime(datestring) {
  // Create a new Date object from the string
  const date = new Date(datestring);
  
  // Get the Unix timestamp (in milliseconds)
  const unixTimeMs = date.getTime();
  
  // Convert milliseconds to seconds and round down
  const unixTimeSec = Math.floor(unixTimeMs / 1000);
  
  return unixTimeSec;
}

module.exports = {
    verify_hasrodit_getit, verify_rodit_isamatch, verify_rodit_islive, nearorg_rpc_timestamp,
    verify_rodit_isactive,verify_rodit_istrusted_issuingsmartcontract,nearorg_rpc_state,
    nearorg_rpc_tokensfromaccountid,nearorg_rpc_tokenfromroditid,roditconfig,validate_jwt_token,
    dateStringToUnixTime,CONSTANTS,RODiT
};