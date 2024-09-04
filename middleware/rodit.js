// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const bs58 = require("bs58");
const { ulid } = require("ulid");
const config = require("config");
const fs = require("fs").promises;
const logger = require("../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
nacl.util = require("tweetnacl-util");
const { importJWK, jwtVerify, decodeJwt, SignJWT } = require("jose");
const { Resolver } = require("dns").promises;

const CONSTANTS = {
  SMART_CONTRACT: "10903-cableguard-org.testnet", // // ".testnet" for TESTNET ".near" for MAINNET
  SMART_CONTRACT_REVOKED: "10903-revoked-cableguard-org.testnet", // // ".testnet" for TESTNET ".near" for MAINNET
  BLOCKCHAIN_NETWORK: ".testnet", // ".testnet" for TESTNET "." for MAINNET
  RODIT_ID_SZ: 128,
  RODIT_ID_PK_SZ: 32,
  RODIT_ID_SIGNATURE_SZ: 64,
  ED25519_KEY_SZ: 64,
};

let session_base64url_jwk_public_key;
let config_own_rodit;

const SERVERPORT = config.get("SERVERPORT");
const API_PROTOCOL = config.get("API_PROTOCOL");
const NEAR_RPC_URL = config.get("NEAR_RPC_URL");
const tokenrenewaloptions = config.get("TOKENRENEWALOPTIONS");

const resolver = new Resolver();

class RODiT {
  constructor() {
    this.token_id = "";
    this.owner_id = "";
    this.metadata = {
      openapijsonurl: "",
      notafter: "",
      notbefore: "",
      maxrequests: "",
      maxrqwindow: "",
      webhookurl: "",
      webhookcidr: "",
      userselecteddn: "", // user choice: User ID, organization ID / Tenant ID
      allowedcidr: "",
      allowediso3166list: "",
      jwtduration: "",
      permissionedroutes: "",
      subjectuniqueidentifierurl: "",
      serviceproviderid: "",
      serviceprovidersignature: "",
    };
  }
}

async function set_rodit_config(own_rodit_hex_accountid,own_string_private_key) {
  try {
    const smartContractUrl = CONSTANTS.SMART_CONTRACT;
    // Extract the extension from the SMART_CONTRACT URL
    const urlExtension = smartContractUrl.split(".").pop();
    // Check if there's a mismatch
    if (
      (CONSTANTS.BLOCKCHAIN_NETWORK === ".testnet" &&
        urlExtension !== "testnet") ||
      (CONSTANTS.BLOCKCHAIN_NETWORK === "." && urlExtension !== "near")
    ) {
      throw new Error(
        `Error 045: Mismatch: URL extension "${urlExtension}" does not match the blockchain network "${blockchainNetwork}".`
      );
    }

    if (typeof own_rodit_hex_accountid !== "string") {
      throw new Error("Error 044: Invalid or missing account_id value");
    }
  
    // Check if the account is funded
    const result = await nearorg_rpc_state(
      CONSTANTS.SMART_CONTRACT,
      own_rodit_hex_accountid
    );

    if (result === false) {
      throw new Error(
        `Error 042: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`
      );
    }
    own_rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      own_rodit_hex_accountid
    );

    const session_base64url_jwk_public_key = hex2base64url(
      own_rodit_hex_accountid
    );
    set_session_jwk_public_key(session_base64url_jwk_public_key);

    const own_rodit_bytes_roditid = new Uint8Array(
      Buffer.from(own_rodit.token_id)
    );

    const own_rodit_base58_private_key = own_string_private_key.split(":")[1];

    const own_rodit_private_key = bs58.decode(own_rodit_base58_private_key);
    const own_rodit_bytes_private_key = new Uint8Array(
      Buffer.from(own_rodit_private_key)
    );

    let apiendpoint =
      API_PROTOCOL +
      "://" +
      own_rodit.metadata.subjectuniqueidentifierurl +
      ":" +
      SERVERPORT;
    let port = SERVERPORT;

    const iso639 = config.get("ISO639"); // Language
    const iso3166 = config.get("ISO3166"); // Country code
    const iso15924 = config.get("ISO15924"); // Language Script
    const timeoptions = config.get("TIMEOPTIONS"); // Time and date options, including timezone name, offset and date and time format
    
    config_own_rodit = {
      own_rodit,
      own_rodit_bytes_private_key,
      apiendpoint,
      port,
      // CG: webhook url and port Is this selfconfig only or per client?
      iso639, // Language
      iso3166, // Country code
      iso15924, // Language Script
      timeoptions, // Time and date options, including timezone name, offset and date and time format
    };

    return {
      own_rodit,
      own_rodit_bytes_private_key,
      apiendpoint,
      port,
    };
  } catch (error) {
    logger.error(`Error in set_rodit_config: ${error.message}`);
    throw new Error(`Failed to set RODiT configuration: ${error.message}`);
  }
}

async function get_rodit_config(own_rodit) {
  return config_own_rodit;
}

function set_session_jwk_public_key(jwk_public_key) {
  session_base64url_jwk_public_key = jwk_public_key;
}

function get_session_jwk_public_key() {
  return session_base64url_jwk_public_key;
}

async function login_client(req, res) {
  try {
    const {
      roditid: peer_roditid,
      timestamp: peer_timestamp,
      roditid_base64url_signature: roditid_base64url_signature,
    } = req.body;
    console.debug("Info: Client RODiT ID:", peer_roditid);

    if (!peer_roditid ||  !peer_timestamp || !roditid_base64url_signature ) {
      return res
        .status(400)
        .json({ message: "Error 100: Missing RODiT ID, Signature or Timestamp" });
    }

    try {
      const { peer_rodit: peer_rodit, goodrodit: isRoditValid } =
        await verify_peerrodit_getrodit(
          peer_roditid,
          peer_timestamp,
          roditid_base64url_signature
        );

      if (!isRoditValid) {
        logger.error(
          "Error 101: Login attempt failed: Invalid RODiT ID or Signature"
        );
        return res.status(401).json({
          message:
            "Error 102: Login attempt failed: Invalid RODiT ID or Signature",
        });
      }

      const config_own_rodit = await get_rodit_config();
      if (!config_own_rodit) {
        throw new Error("Error 103: Server configuration not initialized");
      }

      const token = await generate_jwt_token(
        peer_rodit,
        peer_timestamp,
        config_own_rodit.own_rodit,
        config_own_rodit.own_rodit_bytes_private_key,
      );

      logger.info(
        `Login attempt succeeded for token ID: ${peer_rodit.token_id}`
      );
      return res.json({ token });
    } catch (error) {
      logger.error(`Error 104: Login attempt failed: ${error.message}`);
      return res
        .status(401)
        .json({ message: `Error 105: Login attempt failed: ${error.message}` });
    }
  } catch (error) {
    logger.error(`Error in login_client: ${error.message}`);
    return res
      .status(500)
      .json({ message: "Internal server error during login" });
  }
}

// Log in and verify the server endpoint
async function login_server(
  own_rodit // Ready to login to several servers
) {
  try {
    const config_own_rodit = await get_rodit_config(own_rodit); // Ready to login to several servers
    if (!config_own_rodit) {
      logger.error("Error:  Client configuration not initialized");
      return;
    }
    const apiendpoint = config_own_rodit.apiendpoint;
    let roditid = own_rodit.token_id;
    const timestamp = Math.floor(Date.now() / 1000);

    const roditidandtimestamp = new TextEncoder().encode(roditid + await unixTimeToDateString(timestamp));

    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      config_own_rodit.own_rodit_bytes_private_key
    );

    const roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");

    // The variables roditid, roditid_base64url_signature must match in name
    // with the variables used in the server side    
    const response = await fetch(apiendpoint + "/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roditid, timestamp, roditid_base64url_signature }),
    });

    if (!response.ok) {
      throw new Error("Error 040: Login failed");
    }

    const data = await response.json();
    let jwt_token = data.token;

    // Validate the server
    let peer_bytes_ed25519_public_key;
    try {
      const { _, peer_rodit } = await validate_jwt_token(jwt_token, own_rodit);
      peer_bytes_ed25519_public_key = new Uint8Array(
        Buffer.from(peer_rodit.owner_id, "hex")
      );
    } catch (validationError) {
      throw new Error(
        `Error 039: Server validation failed: ${validationError.message}`
      );
    }
    console.debug("Info: Client of API endpoint is logged in");
    return { jwt_token, apiendpoint };
  } catch (error) {
    logger.error(`Error in login_server: ${error.message}`);
    return { error: "Failed to login to server" };
  }
}

async function validate_jwt_token(token, own_rodit) {
  try {
    const unverifiedpayload = decodeJwt(token);
    const account_idargs = `{"token_id": "${unverifiedpayload.rodit_id}"}`;
    // sp_rodit is the peer's rodit
    const sp_rodit = await nearorg_rpc_tokenfromroditid(
      CONSTANTS.SMART_CONTRACT,
      account_idargs
    );

    let serviceprovider_base64_public_key = Buffer.from(
      sp_rodit.owner_id,
      "hex"
    ).toString("base64url");
    const sp_public_key = await base64url2jwk_public_key(
      serviceprovider_base64_public_key
    );
    const { payload, _ } = await jwtVerify(token, sp_public_key, {
      algorithms: ["EdDSA"],
    });

    set_session_jwk_public_key(serviceprovider_base64_public_key);

    let { peer_rodit, goodrodit } = await verify_peerrodit_getrodit(
      payload.rodit_id,
      payload.iat,
      payload.rodit_idsignature
    );
    if (goodrodit) {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) {
        throw new Error("Error 007: Token has expired");
      }

      if (payload.nbf > now) {
        throw new Error("Error 006: Token is not yet valid");
      }

      if (payload.iss !== own_rodit.metadata.subjectuniqueidentifierurl) {
        throw new Error("Error 005: Invalid issuer");
      }

      if (payload.aud !== own_rodit.owner_id) {
        throw new Error("Error 004: Invalid audience");
      }

      return { payload, peer_rodit };
    }
  } catch (error) {
    logger.error(`Error in validate_jwt_token: ${error.message}`);
    throw new Error(`JWT token validation failed: ${error.message}`);
  }
}

async function verify_peerrodit_getrodit(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature
) {
  try {

    const peer_rodit = await verify_hasrodit_getit(
      peerroditid,
      peertimestamp,
      peerroditid_base64url_signature
    );

    const [isVerified, isLive, isActive, isTrusted] = await Promise.all([
      verify_rodit_isamatch(
        own_rodit.metadata.serviceproviderid,
        peer_rodit.metadata.serviceprovidersignature,
        peer_rodit.token_id,
      ),
      verify_rodit_islive(
        peer_rodit.metadata.notafter,
        peer_rodit.metadata.notbefore
      ),
      verify_rodit_isactive(
        peer_rodit.token_id,
        own_rodit.metadata.subjectuniqueidentifierurl
      ),
      verify_rodit_istrusted_issuingsmartcontract(
        own_rodit.metadata.subjectuniqueidentifierurl
      ),
    ]);

    if (!isVerified || !isLive || !isActive || !isTrusted) {
      throw new Error("Error 037: Peer RODiT verification failed");
    }

    console.debug("Info: Peer Account ID:", peer_rodit.owner_id);
    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    logger.error(`Error 036: in verify_peerrodit_getrodit: ${error.message}`);
    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error 036: in verify_peerrodit_getrodit: ${error.message}`
    };
  }
}

async function verify_hasrodit_getit(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature
) {
  const account_idargs = `{"token_id": "${peerroditid}"}`;

  try {

    const peer_rodit = await nearorg_rpc_tokenfromroditid(
      CONSTANTS.SMART_CONTRACT,
      account_idargs
    );

    const roditidandtimestamp = new TextEncoder().encode(peerroditid + await unixTimeToDateString(peertimestamp));

    const bytes_ed25519_signature = new Uint8Array(
      Buffer.from(peerroditid_base64url_signature, "base64url")
    );

    const peer_bytes_ed25519_public_key = new Uint8Array(
      Buffer.from(peer_rodit.owner_id, "hex")
    );

    const isVerified = nacl.sign.detached.verify(
      roditidandtimestamp,
      bytes_ed25519_signature,
      peer_bytes_ed25519_public_key
    );

    if (isVerified) {
      console.debug("Info: Peer RODiT possession check passed");
      return peer_rodit;
    } else {
      logger.error("Error: Peer RODiT possession check failed");
      throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
    }
  } catch (error) {
    logger.error(
      `Error 034: ${error}`
    );
    throw new Error("Error 033:");
  }
}

async function verify_rodit_isamatch(
        own_service_provider_id,
        peer_service_provider_signature,
        peer_token_id,
      ) {
        // Obtain a Own Service Provider RODiT (Mother RODiT) from its ID
        const args_own_service_provider_id = JSON.stringify({
          token_id: own_service_provider_id,
        });
        let own_service_provider_rodit;
        try {
          own_service_provider_rodit = await nearorg_rpc_tokenfromroditid(
            CONSTANTS.SMART_CONTRACT,
            args_own_service_provider_id
          );
        } catch (error) {
          logger.error("Error 032: Peer RODiT does not match Own RODiT - Fetching");
          return false;
        }
        let bytes_own_service_provider_owner_id;
        console.debug("Info: Service Provider Account ID:",own_service_provider_rodit.owner_id
        );
        try {
          bytes_own_service_provider_owner_id = new Uint8Array(
            Buffer.from(own_service_provider_rodit.owner_id, "hex")
          );
        } catch (error) {
          logger.error("Error 031: Failed to decode hex string");
          return false;
        }
        if (bytes_own_service_provider_owner_id.length !== CONSTANTS.RODIT_ID_PK_SZ) {
          logger.error("Error 030: Invalid byte array length");
          return false;
        }
        const bytes_peer_service_provider_signature = new Uint8Array(
          Buffer.from(peer_service_provider_signature, "base64")
        );
        if (
          bytes_peer_service_provider_signature.length !==
          CONSTANTS.RODIT_ID_SIGNATURE_SZ
        ) {
          logger.error("Error 029: Invalid public key length");
          return false;
        }
        const bytes_peer_token_id = new Uint8Array(Buffer.from(peer_token_id));
        try {

          const is_valid = nacl.sign.detached.verify(
            bytes_peer_token_id,
            bytes_peer_service_provider_signature,
            bytes_own_service_provider_owner_id
          );
          if (is_valid) {
            console.debug("Info Peer RODiT matches Own RODiT");
            return true;
          } else {
            logger.error("Error 028: Peer RODiT does not match Own RODiT");
            return false;
          }
        } catch (error) {
          logger.error(
            "Error 027: Peer RODiT does not match Own RODiT - Parsing public key"
          );
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
      logger.error(
        `Error 026: Peer RODiT ${tokenId} revoked by ${domainandextension} as per ${revokingDnsEntry}`
      );
      return false;
    } catch (error) {
      // If an Error is found, instead of an entry, the Peer RODiT is not revoked
      console.debug("Info: Peer RODiT is not revoked");
      return true;
    }
  } else {
    // If no domain and extension match is found, the Peer RODiT is not revoked
    console.debug("Info: Peer RODiT is not revoked");
    return true;
  }
}

async function verify_rodit_istrusted_issuingsmartcontract(
  ownsubjectuniqueidentifierurl
) {
  try {
    const smartcontract = CONSTANTS.SMART_CONTRACT;
    const smartontractnonear = smartcontract.replace(".testnet", "");
    const smartcontracturl = smartontractnonear.replace("-", ".");

    const domainandextension = /(\w+\.\w+)$/;

    // Find the rightmost part (domain and extension)
    const maindomainmatch = domainandextension.exec(
      ownsubjectuniqueidentifierurl
    );
    if (!maindomainmatch) {
      throw new Error("Error 025: Domain can't be parsed");
    }
    if (maindomainmatch) {
      const domainandextension = maindomainmatch[1];
      const enablingdnsentry = `${smartontractnonear}.smartcontract.${domainandextension}`;

      try {
        const cfgresponse = await resolver.resolveTxt(enablingdnsentry);
        if (cfgresponse.length > 0) {
          console.debug("Info: Smart Contract is trusted");
          return true;
        } else {
          logger.error(
            `Error 024: Smart Contract ${smartcontracturl} not trusted by ${domainandextension} in verify_smartcontract_istruste`
          );
          return false;
        }
      } catch (error) {
        logger.error(
          `Error 023: Smart Contract ${smartcontracturl} not trusted by ${domainandextension} in verify_smartcontract_istruste`
        );
        return false;
      }
    } else {
      logger.error(
        `Error 022: Domain can't be parsed in verify_rodit_istrusted_issuingsmartcontract`
      );
      return false;
    }
  } catch (error) {
    logger.error(
      `Error 021: in verify_rodit_istrusted_issuingsmartcontract: ${error.message}`
    );
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
  return nearorg_rpc_timestamp()
    .then((stringtimenow) => {
      const timestamp = parseInt(stringtimenow, 10);
      if (isNaN(timestamp)) {
        logger.error("Error 020: Can't parse near block timestamp");
        return false;
      }

      const datetimetimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds

      if (
        (datetimetimestamp <= datetimenotafter ||
          datetimenotafter.getTime() === datetimenul.getTime()) &&
        (datetimetimestamp >= datetimenotbefore ||
          datetimenotbefore.getTime() === datetimenul.getTime())
      ) {
        console.log("Info: Peer RODiT is live");
        return true;
      } else {
        logger.error(
          "Error 019: Peer RODiT is not live - notbefore %s now %s notafter %s",
          datetimenotbefore.toISOString(),
          datetimetimestamp.toISOString(),
          datetimenotafter.toISOString()
        );
        return false;
      }
    })
    .catch((error) => {
      logger.error(`Error 018: While checking time from blockchain ${error}`);
      return false;
    });
}

// Obtain timestamp from blockchain
async function nearorg_rpc_timestamp() {
  const url = NEAR_RPC_URL;
  const jsonData = {
    jsonrpc: "2.0",
    id: "dontcare",
    method: "block",
    params: {
      finality: "final",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });

    if (!response.ok) {
      throw new Error(`http error! status: ${response.status}`);
    }

    const parsedJson = await response.json();

    if (parsedJson.error) {
      throw new Error(`Error 017: ${parsedJson.error.message}`);
    }

    const timestamp = parsedJson.result?.header?.timestamp;

    return timestamp ? timestamp.toString() : "0";
  } catch (error) {
    logger.error(`Error 016: in nearorgRpcTimestamp: ${error}`);
    throw error;
  }
}

// Obtain RODiT from RODiT ID
async function nearorg_rpc_tokenfromroditid(id, args) {
  const url = NEAR_RPC_URL;

  const json_data = {
    jsonrpc: "2.0",
    id: id,
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: id,
      method_name: "rodit_token",
      args_base64: Buffer.from(args).toString("base64"),
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(json_data),
  });

  const json_response = await response.json();

  if (json_response.error) {
    throw new Error(`Error 015: ${json_response.error.message}`);
  }

  const result_array = json_response.result.result;

  if (!Array.isArray(result_array)) {
    throw new Error("Error 014: Result is not an array");
  }

  const result_bytes = result_array.map((v) => v);

  const result_string = Buffer.from(result_bytes).toString("utf8");

  const rodit = new RODiT();
  Object.assign(rodit, JSON.parse(result_string));
  return rodit;
}

// Obtain state of the account id
async function nearorg_rpc_state(id, accountId) {
  const url = NEAR_RPC_URL;

  const jsonData = {
    jsonrpc: "2.0",
    id: id,
    method: "query",
    params: {
      request_type: "view_account",
      finality: "final",
      account_id: accountId,
    },
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.json();
    if (JSON.stringify(responseText).includes("does not exist while viewing")) {
      logger.error(
        "Error 013: The NEAR account does not exist in the blockchain, it needs to be funded with at least 0.01 NEAR in this network"
      );
      return false;
    }

    return true;
  } catch (error) {
    throw error; // All errors must the caught and logged
    return false;
  }
}

// Obtain RODiT from account_id
async function nearorg_rpc_tokensfromaccountid(id, account_id) {
  const url = NEAR_RPC_URL;

  const args = JSON.stringify({
    account_id: account_id,
    from_index: 0,
    limit: 1,
  });
  const jsonData = {
    jsonrpc: "2.0",
    id: id,
    method: "query",
    params: {
      request_type: "call_function",
      finality: "optimistic",
      account_id: id,
      method_name: "rodit_tokens_for_owner",
      args_base64: Buffer.from(args).toString("base64"),
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);
    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      throw new Error("Error 012: Result is not an array");
    }

    const resultBytes = new Uint8Array(resultArray);
    const resultString = new TextDecoder().decode(resultBytes);
    const resultStruct = JSON.parse(resultString);

    if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
      throw new Error("Error 011: No RODiT instance found");
    }
    // Only the first RODiT in the account is returned
    return resultStruct[0];
  } catch (error) {
    logger.error(`Error 010: ${error.message}`);
    throw error;
  }
}

async function generate_jwt_token(
  peer_rodit,
  peer_timestamp,
  own_rodit,
  own_rodit_bytes_private_key,
) {
  try {
    const now = peer_timestamp;

    // Make sure that the token will not last beyond the expiration date of the RODiT
    const notafter = await dateStringToUnixTime(peer_rodit.metadata.notafter);
    const duration = parseInt(peer_rodit.metadata.jwtduration, 10);
    let expiresat = now;
    if (now + duration < notafter) {
      expiresat = parseInt(now) + parseInt(peer_rodit.metadata.jwtduration);
    } else {
      throw new Error("Error 009: RODiT duration check failed");
    }

    console.debug("Info: This API endpoint Login of Client check passed");
    const notbefore = await dateStringToUnixTime(own_rodit.metadata.notbefore);

    const roditidandtimestamp = new TextEncoder().encode(own_rodit.token_id+await unixTimeToDateString(peer_timestamp));

    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      own_rodit_bytes_private_key
    );

    const own_roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");

    // For private key
    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), // Ed25519 private key header
        own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });

    const token = await new SignJWT({
      iss: peer_rodit.metadata.subjectuniqueidentifierurl, // App Name
      sub:
        peer_rodit.metadata.serviceproviderid + ";sub=" + peer_rodit.token_id, // Unique Id of the client
      aud: peer_rodit.owner_id, // App Client
      exp: expiresat,
      nbf: notbefore,
      iat: peer_timestamp,
      jti: "jti" + ulid(), // jti added to distinguish this quickly visually from the rodit_id
      // amr: "near.org/rodit" // field added to indicate which blockchain and authentication method version has been used
      rodit_id: own_rodit.token_id,
      rodit_owner: own_rodit.owner_id,
      rodit_idsignature: own_roditid_base64url_signature,
      rodit_maxrequests: peer_rodit.metadata.maxrequests,
      rodit_maxrqwindow: peer_rodit.metadata.maxrqwindow,
      rodit_permissionedroutes: peer_rodit.metadata.permissionedroutes,
      rodit_webhookcidr: peer_rodit.metadata.webhookcidr, // CIDR that can be used by the client to accept webhook requests only from specific IPs
      rodit_allowedcidr: peer_rodit.metadata.allowedcidr, // CIDR that limit from what networks the client can perform calls
      rodit_allowediso3166list: peer_rodit.metadata.allowediso3166list, // List that limits from which countries the client can perform calls
      rodit_webhookurl: peer_rodit.metadata.webhookurl, // URL that can receive webhook calls
      // Future optional fields
      config_iso639: null, // Language preference
      config_iso3166: null, // Country code preference
      config_iso15924: null, // Language Script preference
      config_timeoptions: null, // Time and date preference, including timezone name, offset and date and time format
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(own_rodit_keyobject_private_key);
    return token;
  } catch (error) {
    logger.error(`Error 008: in generate_jwt_token: ${error.message}`);
    throw error; // Re-throw the error if you want calling functions to handle it
  }
}

async function brief_validate_jwt_token(token) {
  try {
    const peer_rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      token.aud
    );
    const subParts = token.sub.split(";sub=");
    const extractedSub = subParts.length > 1 ? subParts[1] : "";
    const isValid =
      peer_rodit.token_id === extractedSub && peer_rodit.owner_id === token.aud;

    if (isValid) {
      logger.info(
        "Token validation successful, renewal recommended for user:",
        token.userId
      );
    } else {
      logger.warn("Token renewal conditions not met for user:", token.userId);
    }

    return {
      isValid,
      notAfter: peer_rodit.metadata.notafter,
    };
  } catch (error) {
    logger.error(`Error in brief_validate_jwt_token: ${error}`);
    return {
      isValid: false,
      notAfter: null,
    };
  }
}

async function thorough_validate_jwt_token(token) {
  try {
    const config_own_rodit = await get_rodit_config();
    const peer_rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      token.aud
    );
    const [isVerified, isLive, isActive, isTrusted] = await Promise.all([
      verify_rodit_isamatch(
        config_own_rodit.own_rodit.metadata.serviceproviderid,
        peer_rodit.metadata.serviceprovidersignature,
        peer_rodit.token_id,
        peer_rodit.iat
      ),
      verify_rodit_islive(
        peer_rodit.metadata.notafter,
        peer_rodit.metadata.notbefore
      ),
      verify_rodit_isactive(
        peer_rodit.token_id,
        config_own_rodit.own_rodit.metadata.subjectuniqueidentifierurl
      ),
      verify_rodit_istrusted_issuingsmartcontract(
        config_own_rodit.own_rodit.metadata.subjectuniqueidentifierurl
      ),
    ]);

    if (!isVerified || !isLive || !isActive || !isTrusted) {
      logger.warn("Peer RODiT verification failed", {
        isVerified,
        isLive,
        isActive,
        isTrusted,
      });
      return {
        isValid: false,
        notAfter: peer_rodit.metadata.notafter,
      };
    }

    console.debug("Info: Peer Account ID:", peer_rodit.owner_id);
    const subParts = token.sub.split(";sub=");
    const extractedSub = subParts.length > 1 ? subParts[1] : "";

    const isValid =
      peer_rodit.token_id === extractedSub && peer_rodit.owner_id === token.aud;

    if (isValid) {
      logger.info(
        "Token validation successful, renewal recommended for user:",
        token.userId
      );
    } else {
      logger.warn("Token renewal conditions not met for user:", token.userId);
    }

    return {
      isValid,
      notAfter: peer_rodit.metadata.notafter,
    };
  } catch (error) {
    logger.error(`Error in throrough_validate_jwt_token: ${error}`);
    return {
      isValid: false,
      notAfter: null,
    };
  }
}

async function generate_jwt_token_fromtoken(
  token,
  duration,
  notafter,
  timestamp
) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const tokenexpiration = duration + now;
    const notafterunixtime = await dateStringToUnixTime(notafter);
    if (tokenexpiration <= notafterunixtime) {
      // Proceed with token generation
    } else {
      throw new Error("Error 109: RODiT has expired");
    }

    const config_own_rodit = await get_rodit_config();

    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), // Ed25519 private key header
        config_own_rodit.own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });

    const newtoken = await new SignJWT({
      iss: token.iss, // App Name
      sub: token.sub, // Unique Id of the client
      aud: token.aud, // App Client
      exp: tokenexpiration,
      nbf: token.nbf,
      iat: now,
      jti: "jti" + ulid(), // jti added to distinguish this quickly visually from the rodit_id
      // amr: "near.org/rodit" // field added to indicate which blockchain and authentication method version has been used
      rodit_id: token.rodit_id,
      rodit_owner: token.rodit_owner,
      rodit_allowediso3166list: token.rodit_allowediso3166list, // List that limits from which countries the client can perform calls
      rodit_idsignature: token.rodit_idsignature,
      rodit_maxrequests: token.rodit_maxrequests,
      rodit_maxrqwindow: token.rodit_maxrqwindow,
      rodit_permissionedroutes: token.rodit_permissionedroutes,
      rodit_webhookcidr: token.rodit_webhookcidr, // CIDR that can be used by the client to accept webhook requests only from specific IPs
      rodit_allowedcidr: token.rodit_allowedcidr, // CIDR that limit from what networks the client can perform calls
      rodit_allowediso3166list: token.rodit_allowediso3166list, // List that limits from which countries the client can perform calls
      rodit_webhookurl: token.rodit_webhookurl, // URL that can receive webhook calls
      // Future optional fields
      config_iso639: null, // Language preference
      config_iso3166: null, // Country code preference
      config_iso15924: null, // Language Script preference
      config_timeoptions: null, // Time and date preference, including timezone name, offset and date and time format
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(own_rodit_keyobject_private_key);
    return newtoken;
  } catch (error) {
    logger.error(
      `Error 008: in generate_jwt_token_fromtoken: ${error.message}`
    );
    throw error; // All thrown errors must be catched and logged
  }
}

async function authenticate_apicall(req, res, next) {
  const requestId = ulid();
  logger.info(`JWT authentication started - Request ID: ${requestId}`);

  try {
    const token = extractTokenFromHeader(req.headers["authorization"]);
    if (token == null) {
      logger.warn(`No token provided - Request ID: ${requestId}`);
      return res.status(401).json({
        error: {
          code: 'MISSING_TOKEN',
          message: 'No token provided',
          requestId
        }
      });
    }
    
    try {
      const jwk_public_key = await base64url2jwk_public_key(get_session_jwk_public_key());
      logger.debug(`Public key retrieved - Request ID: ${requestId}`);
      
      let { payload, protectedHeader, newToken } = await verifyToken(token, jwk_public_key, req.headers["x-timestamp"], requestId);
      
      if (newToken) {
        res.setHeader("New-Token", newToken);
        logger.info(`Token renewed after expiration - Request ID: ${requestId}`);
      } else if (tokenrenewaloptions.SERVERORCLIENT === "SERVER-INITIATED") {
        // Server-initiated token renewal logic
        const renewalResult = await checkAndRenewToken(payload, req.headers["x-timestamp"], requestId);
        if (renewalResult.newToken) {
          res.setHeader("New-Token", renewalResult.newToken);
          logger.info(`Token renewed - Request ID: ${requestId}`, renewalResult.logInfo);
        }
      }
      
      if (tokenrenewaloptions.SERVERORCLIENT === "CLIENT-INITIATED") {
        // Add token expiration time to response header for client-initiated refresh
        res.setHeader("Token-Expiration", payload.exp);
      }
      
      req.user = payload;
      logger.info(`Authentication successful - Request ID: ${requestId}`);
      next();
    } catch (error) {
      handleTokenError(error, res, requestId);
    }
  } catch (error) {
    logger.error(`Unexpected error in authenticate_apicall: ${error.message} - Request ID: ${requestId}`);
    return res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error during authentication',
        requestId
      }
    });
  }
}

function extractTokenFromHeader(authHeader) {
  if (authHeader) {
    const parts = authHeader.split(" ");
    return parts.length > 1 ? parts[1] : null;
  }
  return null;
}

async function verifyToken(token, jwk_public_key, timestamp, requestId) {
  try {
    const result = await jwtVerify(token, jwk_public_key, { algorithms: ["EdDSA"] });
    logger.debug(`Token verified successfully - Request ID: ${requestId}`);
    return result;
  } catch (jwtError) {
    if (jwtError.code === "ERR_JWT_EXPIRED") {
      logger.info(`Token expired, attempting renewal - Request ID: ${requestId}`);
      const config_own_rodit = await get_rodit_config();
      const unverifiedpayload = decodeJwt(token);
      const { isValid, notAfter } = await thorough_validate_jwt_token(unverifiedpayload, requestId);
      if (isValid) {
        const newToken = await generate_jwt_token_fromtoken(
          unverifiedpayload,
          config_own_rodit.own_rodit.metadata.jwtduration,
          notAfter,
          timestamp
        );
        logger.info(`New token generated for expired token - Request ID: ${requestId}`);
        return { payload: unverifiedpayload, protectedHeader: null, newToken };
      }
    }
    throw jwtError;
  }
}

async function checkAndRenewToken(payload, timestamp, requestId) {
  const currentTime = Math.floor(Date.now() / 1000);
  const timeLeft = payload.exp - currentTime;
  const currentDuration = payload.exp - payload.iat;
  const durationLeftpct = (timeLeft / currentDuration) * 100;
  const newduration = currentDuration * tokenrenewaloptions.DURATIONRAMP;

  logger.debug(`Token renewal check - Time left: ${durationLeftpct}%, Request ID: ${requestId}`);

  if (durationLeftpct < 100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE) {
    const randomNumber = generateRandomNumber();
    if (randomNumber < tokenrenewaloptions.THRESHOLD_VALIDATION_TYPE ||
        newduration < (payload.rodit_maxrqwindow * (100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE)) / 100) {
      logger.info(`Performing full verification for token renewal - Request ID: ${requestId}`);
      const { isValid, notAfter } = await thorough_validate_jwt_token(payload, requestId);
      if (isValid) {
        const newToken = await generate_jwt_token_fromtoken(payload, newduration, notAfter, timestamp);
        return { 
          newToken, 
          logInfo: {
            newDuration: newduration,
            reason: "Full verification",
            notAfter: notAfter,
          }
        };
      }
    } else {
      logger.info(`Performing light verification for token renewal - Request ID: ${requestId}`);
      const { isValid, notAfter } = await brief_validate_jwt_token(payload, requestId);
      if (isValid) {
        const newToken = await generate_jwt_token_fromtoken(payload, newduration, notAfter, timestamp);
        return { 
          newToken, 
          logInfo: {
            newDuration: newduration,
            reason: "Light verification",
            notAfter: notAfter,
          }
        };
      }
    }
  }
  return { newToken: null };
}

function handleTokenError(error, res, requestId) {
  logger.error(`Token error: ${error.message} - Request ID: ${requestId}`);
  if (error.code === "ERR_JWT_INVALID") {
    return res.status(401).json({ 
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid token',
        requestId
      }
    });
  }
  return res.status(403).json({ 
    error: {
      code: 'TOKEN_VERIFICATION_FAILED',
      message: 'Token verification failed',
      requestId
    }
  });
}

// Helper functions that need to be implemented or imported:
// thorough_validate_jwt_token, brief_validate_jwt_token, generate_jwt_token_fromtoken, generateRandomNumber

/**
 * Sends a webhook notification
 * @param {string} event - The event name
 * @param {object} data - The event data
 * @param {boolean} isError - Whether the event represents an error
 * @returns {Object} Webhook send result
 */
const send_webhook = async (event, data, isError = false) => {
  const requestId = ulid();
  logger.info(`Sending webhook - Event: ${event}, Request ID: ${requestId}`);

  try {
    if (!config_own_rodit || !config_own_rodit.own_rodit.metadata.webhookurl) {
      logger.error(`Error: Webhook URL not available in Rodit configuration - Request ID: ${requestId}`);
      return {
        isValid: false,
        error: {
          code: 'WEBHOOK_CONFIG_ERROR',
          message: 'Webhook URL not available in Rodit configuration',
          requestId
        }
      };
    }

    const timestamp = Date.now();
    const payload = JSON.stringify({ event, data, isError, timestamp, requestId });
    const sha256_ofpayload = crypto.createHash("sha256").update(payload).digest();

    const own_rodit_private_key = new Uint8Array(
      Buffer.from(config_own_rodit.own_rodit_bytes_private_key, "hex")
    );

    const signature_ofpayload = nacl.sign.detached(
      sha256_ofpayload,
      own_rodit_private_key
    );
    const signature_hex_ofpayload = Buffer.from(signature_ofpayload).toString("hex");

    const response = await fetch(
      `http://${config_own_rodit.own_rodit.metadata.webhookurl}/webhook`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature_hex_ofpayload,
          "X-Timestamp": timestamp.toString(),
          "X-Request-ID": requestId
        },
        body: payload,
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await response.text(); // consume the response body
    logger.info(`Webhook sent successfully - Event: ${event}, Request ID: ${requestId}`);

    return {
      isValid: true,
      message: 'Webhook sent successfully',
      requestId
    };

  } catch (error) {
    logger.error(`Error in send_webhook: ${error.message} - Request ID: ${requestId}`);
    return {
      isValid: false,
      error: {
        code: 'WEBHOOK_SEND_ERROR',
        message: `Failed to send webhook: ${error.message}`,
        requestId
      }
    };
  }
};

// payload is always the decoded contents of a token

/**
 * Authenticates incoming webhooks
 * @param {string} payload - Webhook payload
 * @param {string} signature_hex_ofpayload - Hex signature of the payload
 * @param {string} timestamp - Webhook timestamp
 * @param {Uint8Array} peer_bytes_public_key - Peer's public key
 * @returns {Object} Authentication result
 */
function authenticate_webhook(payload, signature_hex_ofpayload, timestamp, peer_bytes_public_key) {
  const requestId = ulid();
  logger.info(`Webhook authentication started - Request ID: ${requestId}`);

  try {
    // Verify the timestamp (e.g., within last 5 minutes)
    const currentTime = Date.now();
    const timeThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds
    if (currentTime - parseInt(timestamp) > timeThreshold) {
      logger.warn(`Webhook timestamp too old - Request ID: ${requestId}`);
      return {
        isValid: false,
        error: {
          code: 'TIMESTAMP_EXPIRED',
          message: 'Webhook timestamp is too old',
          requestId
        }
      };
    }

    const sha256_ofpayload = crypto.createHash("sha256").update(payload).digest();
    const buffer_signature_ofpayload = Buffer.from(signature_hex_ofpayload, "hex");
    
    const isValid = nacl.sign.detached.verify(
      sha256_ofpayload,
      buffer_signature_ofpayload,
      peer_bytes_public_key
    );

    if (!isValid) {
      logger.error(`Invalid webhook signature - Request ID: ${requestId}`);
      return {
        isValid: false,
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Invalid webhook signature',
          requestId
        }
      };
    }

    logger.info(`Webhook authentication successful - Request ID: ${requestId}`);
    return {
      isValid: true,
      message: 'Webhook authentication successful',
      requestId
    };

  } catch (error) {
    logger.error(`Unexpected error in webhook authentication: ${error.message} - Request ID: ${requestId}`);
    return {
      isValid: false,
      error: {
        code: 'AUTHENTICATION_ERROR',
        message: 'An unexpected error occurred during webhook authentication',
        details: error.message,
        requestId
      }
    };
  }
}

function generateRandomNumber() {
  return Math.random(); // Random number between 0 and 1
}

// The same case must be used across names of functions and variables
async function dateStringToUnixTime(datestring) {
  // Create a new Date object from the string
  const date = new Date(datestring);

  // Get the Unix timestamp (in milliseconds)
  const unixTimeMs = date.getTime();

  // Convert milliseconds to seconds and round down
  const unixTimeSec = Math.floor(unixTimeMs / 1000);

  return unixTimeSec;
}

async function unixTimeToDateString(unixTimeSec) {
  // Convert seconds to milliseconds
  const unixTimeMs = unixTimeSec * 1000;

  // Create a new Date object using the milliseconds timestamp
  const date = new Date(unixTimeMs);

  // Convert the Date object to an ISO 8601 string
  const dateString = date.toISOString();

  return dateString;
}


function set_session_jwk_public_key(jwk_public_key) {
  session_base64url_jwk_public_key = jwk_public_key;
}

function get_session_jwk_public_key() {
  return session_base64url_jwk_public_key;
}

async function base64url2jwk_public_key(base64url_public_key) {
  const jwk_public_key = {
    kty: "OKP",
    crv: "Ed25519",
    x: base64url_public_key,
    use: "sig",
  };
  const session_jwk_public_key = await importJWK(jwk_public_key, "EdDSA");
  return session_jwk_public_key;
}

function hex2base64url(hexString) {
  // Step 1: Convert hex to Uint8Array
  const bytes = new Uint8Array(
    hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
  );

  // Step 2: Convert Uint8Array to base64
  const base64 = btoa(String.fromCharCode.apply(null, bytes));

  // Step 3: Convert base64 to base64url
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

module.exports = {
  set_rodit_config,
  get_rodit_config,
  login_client,
  login_server,
  generate_jwt_token,
  authenticate_apicall,
  send_webhook,
  authenticate_webhook,
};
