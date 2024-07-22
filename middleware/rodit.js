// Copyright (c) 2023 Cableguard, Inc. All rights reserved.

const nacl = require('tweetnacl');
nacl.util = require('tweetnacl-util');
const { Resolver } = require('dns').promises;

// Move SMART CONTRACT to configuration file
const CONSTANTS = {
    SMART_CONTRACT: "10201-cableguard-org.testnet",
    BLOCKCHAIN_NETWORK: ".testnet", // IMPORTANT: Values here must be either ".testnet" for testnet or "." for mainnet
    RODIT_ID_SZ: 128,
    RODIT_ID_SIGNATURE_SZ: 64,
    ED25519_KEY_SZ: 64
};

const RODIT_ID_PK_SZ = 32;

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

async function verify_hasrodit_getit(peer_roditid, peer_roditid_base64url_signature) {
    // const slice_roditid = peer_roditid.slice();
    // const string_roditid = Buffer.from(slice_roditid).toString('utf8').replace(/\0/g, '');
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
    let ownServiceProviderRodit;
    try {
        ownServiceProviderRodit = await nearorg_rpc_tokenfromroditid(CONSTANTS.BLOCKCHAIN_NETWORK, CONSTANTS.SMART_CONTRACT, 'nft_token', args_ownServiceProviderId);
    } catch (error) {
        console.error('Error: Peer RODiT does not match Own RODiT - Fetching');
        return false;
    }

    let bytes_ownServiceProviderOwnerId;
   
    console.info('Info: Service Provider RODiT:', ownServiceProviderRodit);
    console.info('Info: Client Account ID',ownServiceProviderRodit.owner_id);
    try {
        bytes_ownServiceProviderOwnerId = new Uint8Array(Buffer.from(ownServiceProviderRodit.owner_id, 'hex'));
    } catch (error) {
        console.error('Error: Failed to decode hex string');
        return false;
    }

    if (bytes_ownServiceProviderOwnerId.length !== RODIT_ID_PK_SZ) {
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

async function verify_rodit_isactive(tokenId, ownSubjectUniqueIdentifierUrl) {
  const domainAndExtensionRegex = /(\w+\.\w+)$/;

  // Find the rightmost part (domain and extension)
  const match = ownSubjectUniqueIdentifierUrl.match(domainAndExtensionRegex);

  if (match) {
    const domainAndExtension = match[1];
    const revokingDnsEntry = `${tokenId}.revoked.${domainAndExtension}`;

    try {
      await resolver.resolveTxt(revokingDnsEntry);
      console.error(`Error: Peer RODiT ${tokenId} revoked by ${domainAndExtension} as per ${revokingDnsEntry}`);
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

async function verify_rodit_istrusted_issuingsmartcontract(ownSubjectUniqueIdentifierUrl) {
  const smartContract = CONSTANTS.SMART_CONTRACT;
  const smartContractNonear = smartContract.replace(".testnet", "");
  const smartContractUrl = smartContractNonear.replace("-", ".");

  const domainAndExtension = /(\w+\.\w+)$/;

  // Find the rightmost part (domain and extension)
  const mainDomainMatch = domainAndExtension.exec(ownSubjectUniqueIdentifierUrl);
  if (mainDomainMatch) {
    const domainAndExtension = mainDomainMatch[1];
    const enablingDnsEntry = `${smartContractNonear}.smartcontract.${domainAndExtension}`;
    
    try {
      const cfgResponse = await resolver.resolveTxt(enablingDnsEntry);
      if (cfgResponse.length > 0) {
        console.info("Info: Smart Contract is trusted");
        return true;
      } else {
        console.error(`Error: Smart Contract ${smartContractUrl} not trusted by ${domainAndExtension} in verify_smartcontract_istruste`);
        return false;
      }
    } catch (err) {
      console.error(`Error: Smart Contract ${smartContractUrl} not trusted by ${domainAndExtension} in verify_smartcontract_istruste`);
      return false;
    }
  } else {
    console.error(`Error: Domain can't be parsed in verify_rodit_istrusted_issuingsmartcontract`);
    return false;
  }
}

async function verify_rodit_islive(peerRoditNotafter, peerRoditNotbefore) {
    // Helper function to parse date strings
    function parseDate(dateString) {
      const date = new Date(dateString);
      return isNaN(date.getTime()) ? new Date(0) : date;
    }
  
    // 1970-01-01 chosen as null date considering Unix and X.509 standards for timekeeping
    const datetimeNul = new Date(0);
    
    const datetimeNotafter = parseDate(peerRoditNotafter);
    const datetimeNotbefore = parseDate(peerRoditNotbefore);
  
    // Assuming nearorgRpcTimestamp is an async function that returns a Promise
    return nearorg_rpc_timestamp(CONSTANTS.BLOCKCHAIN_NETWORK)
      .then(stringTimenow => {
        const timestamp = parseInt(stringTimenow, 10);
        if (isNaN(timestamp)) {
          console.error("Error: Can't parse near block timestamp");
          return false;
        }
  
        const datetimeTimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds
  
        if (
          ((datetimeTimestamp <= datetimeNotafter) || datetimeNotafter.getTime() === datetimeNul.getTime()) &&
          ((datetimeTimestamp >= datetimeNotbefore) || datetimeNotbefore.getTime() === datetimeNul.getTime())
        ) {
          console.log("Info: Peer RODiT is live");
          return true;
        } else {
          console.error(
            "Error: Peer RODiT is not live - notbefore %s now %s notafter %s",
            datetimeNotbefore.toISOString(),
            datetimeTimestamp.toISOString(),
            datetimeNotafter.toISOString()
          );
          return false;
        }
      })
      .catch(error => {
        console.error("Error:", error);
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

module.exports = {
    verify_hasrodit_getit, verify_rodit_isamatch, verify_rodit_islive, nearorg_rpc_timestamp,
    verify_rodit_isactive,verify_rodit_istrusted_issuingsmartcontract,nearorg_rpc_state,nearorg_rpc_tokensfromaccountid,nearorg_rpc_tokenfromroditid,CONSTANTS,RODiT
};