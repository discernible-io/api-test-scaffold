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

async function get_rodit_config() {
  return config_own_rodit;
}

function set_session_jwk_public_key(jwk_public_key) {
  session_base64url_jwk_public_key = jwk_public_key;
}

function get_session_jwk_public_key() {
  return session_base64url_jwk_public_key;
}

async function set_rodit_config(configuration_file_path) {
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

    // Read the configuration file to get the path of the JSON file
    const configoptions = await fs.readFile(configuration_file_path, "utf8");
    const pathaccountidfile = configoptions.trim(); // Assuming the file contains just the path

    // Now read the JSON file using the path we got from the configuration file
    const accountidfile = await fs.readFile(pathaccountidfile, "utf8");
    const options = JSON.parse(accountidfile);

    const own_rodit_hex_accountid = options.implicit_account_id;
    if (typeof own_rodit_hex_accountid !== "string") {
      throw new Error("Error 044: Invalid or missing account_id value");
    }

    console.debug("Info: Own Account ID:", own_rodit_hex_accountid);

    let own_string_private_key = options.private_key;
    if (typeof own_string_private_key !== "string") {
      throw new Error("Error 043: Invalid private_key value");
    }

    const own_rodit_base58_private_key = own_string_private_key.split(":")[1];

    // Check if the account is funded
    const result = await nearorg_rpc_state(
      CONSTANTS.BLOCKCHAIN_NETWORK,
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

    const own_rodit_bytes_roditid = new Uint8Array(
      Buffer.from(own_rodit.token_id)
    );

    const own_rodit_private_key = bs58.decode(own_rodit_base58_private_key);
    const own_rodit_bytes_private_key = new Uint8Array(
      Buffer.from(own_rodit_private_key)
    );

    const own_rodit_bytes_signature = nacl.sign.detached(
      own_rodit_bytes_roditid,
      own_rodit_bytes_private_key
    );
    const own_roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");

    const session_base64url_jwk_public_key = hex2base64url(
      own_rodit_hex_accountid
    );
    set_session_jwk_public_key(session_base64url_jwk_public_key);

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
      own_roditid_base64url_signature,
      own_rodit_bytes_private_key,
      apiendpoint,
      port,
      iso639, // Language
      iso3166, // Country code
      iso15924, // Language Script
      timeoptions, // Time and date options, including timezone name, offset and date and time format
    };

    return {
      own_rodit,
      own_roditid_base64url_signature,
      own_rodit_bytes_private_key,
      apiendpoint,
      port,
    };
  } catch (error) {
    logger.error(`Error 041: Processing configuration file: ${error.message}`);
    throw error;
  }
}

// Log in and verify the server endpoint
async function login_and_verify_server(
  apiendpoint,
  roditid_base64url_signature,
  ownrodit
) {
  try {
    let roditid = ownrodit.token_id;
    // The variables roditid, roditid_base64url_signature must match in name
    // with the variables used in the server side
    const response = await fetch(apiendpoint + "/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roditid, roditid_base64url_signature }),
    });

    if (!response.ok) {
      throw new Error("Error 040: Login failed");
    }

    const data = await response.json();
    let jwt_token = data.token;

    // Validate the server
    let peer_bytes_ed25519_public_key;
    try {
      const { _, peer_rodit } = await validate_jwt_token(jwt_token, ownrodit);
      peer_bytes_ed25519_public_key = new Uint8Array(
        Buffer.from(peer_rodit.owner_id, "hex")
      );
    } catch (validationError) {
      throw new Error(
        `Error 039: Server validation failed: ${validationError.message}`
      );
    }
    console.debug("Info: Client of API endpoint is logged in");
    return { jwt_token, peer_bytes_ed25519_public_key };
  } catch (error) {
    logger.error(`Error 038: ${error.message}`);
    return false;
  }
}

async function verify_peerrodit_getit(
  peerroditid,
  peerroditid_base64url_signature
) {
  try {
    const peer_rodit = await verify_hasrodit_getit(
      peerroditid,
      peerroditid_base64url_signature
    );

    const [isVerified, isLive, isActive, isTrusted] = await Promise.all([
      verify_rodit_isamatch(
        own_rodit.metadata.serviceproviderid,
        peer_rodit.metadata.serviceprovidersignature,
        peer_rodit.token_id
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
    let goodrodit;
    if (!isVerified || !isLive || !isActive || !isTrusted) {
      goodrodit = false;
      throw new Error("Error 037: Peer RODiT verification failed");
    }
    goodrodit = true;
    console.debug("Info: Peer Account ID:", peer_rodit.owner_id);
    return {
      peer_rodit,
      goodrodit,
    };
  } catch (error) {
    logger.error(`Error 036: in verify_peerrodit_getit: ${error.message}`);
    return {
      peer_rodit: null,
      goodrodit: false,
    };
  }
}

async function verify_hasrodit_getit(
  peerroditid,
  peerroditid_base64url_signature
) {
  const account_idargs = `{"token_id": "${peerroditid}"}`;

  try {
    // Ensure rodit_id and rodit_id_signature are Uint8Array
    const bytes_roditid = new Uint8Array(Buffer.from(peerroditid));

    const bytes_ed25519_signature = new Uint8Array(
      Buffer.from(peerroditid_base64url_signature, "base64url")
    );

    const peer_rodit = await nearorg_rpc_tokenfromroditid(
      CONSTANTS.BLOCKCHAIN_NETWORK,
      CONSTANTS.SMART_CONTRACT,
      "rodit_token",
      account_idargs
    );

    const peer_bytes_ed25519_public_key = new Uint8Array(
      Buffer.from(peer_rodit.owner_id, "hex")
    );

    const isVerified = nacl.sign.detached.verify(
      bytes_roditid,
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
      `Error 034: There is no Peer RODiT associated with the account: ${err}`
    );
    throw new Error("Error 033: PeerEd25519RoditMissing");
  }
}

async function verify_rodit_isamatch(
  ownServiceProviderId,
  peerServiceProviderSignature,
  peerTokenId
) {
  // Obtain a Own Service Provider RODiT (Mother RODiT) from its ID
  const args_ownServiceProviderId = JSON.stringify({
    token_id: ownServiceProviderId,
  });
  let own_serviceprovider_rodit;
  try {
    own_serviceprovider_rodit = await nearorg_rpc_tokenfromroditid(
      CONSTANTS.BLOCKCHAIN_NETWORK,
      CONSTANTS.SMART_CONTRACT,
      "rodit_token",
      args_ownServiceProviderId
    );
  } catch (error) {
    logger.error("Error 032: Peer RODiT does not match Own RODiT - Fetching");
    return false;
  }

  let bytes_ownServiceProviderOwnerId;

  console.debug(
    "Info: Service Provider Account ID:",
    own_serviceprovider_rodit.owner_id
  );
  try {
    bytes_ownServiceProviderOwnerId = new Uint8Array(
      Buffer.from(own_serviceprovider_rodit.owner_id, "hex")
    );
  } catch (error) {
    logger.error("Error 031: Failed to decode hex string");
    return false;
  }

  if (bytes_ownServiceProviderOwnerId.length !== CONSTANTS.RODIT_ID_PK_SZ) {
    logger.error("Error 030: Invalid byte array length");
    return false;
  }

  const bytes_peerServiceProviderSignature = new Uint8Array(
    Buffer.from(peerServiceProviderSignature, "base64")
  );

  if (
    bytes_peerServiceProviderSignature.length !==
    CONSTANTS.RODIT_ID_SIGNATURE_SZ
  ) {
    logger.error("Error 029: Invalid public key length");
    return false;
  }

  const bytes_peerTokenId = new Uint8Array(Buffer.from(peerTokenId));

  try {
    const isValid = nacl.sign.detached.verify(
      bytes_peerTokenId,
      bytes_peerServiceProviderSignature,
      bytes_ownServiceProviderOwnerId
    );

    if (isValid) {
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
  return nearorg_rpc_timestamp(CONSTANTS.BLOCKCHAIN_NETWORK)
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
async function nearorg_rpc_timestamp(xnet) {
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
async function nearorg_rpc_tokenfromroditid(xnet, id, method_name, args) {
  const url = NEAR_RPC_URL;

  const json_data = {
    jsonrpc: "2.0",
    id: id,
    method: "query",
    params: {
      request_type: "call_function",
      finality: "final",
      account_id: id,
      method_name: method_name,
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
async function nearorg_rpc_state(xnet, id, accountId) {
  const url = NEAR_RPC_URL;

  if (xnet === ".") {
    console.debug("Info: NEAR Blockchain Network is mainnet");
  } else {
    console.debug(`Info: NEAR Blockchain Network is ${xnet}`);
  }

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
    throw error;
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
  peerrodit,
  ownrodit,
  own_rodit_bytes_private_key,
  own_roditid_base64url_signature
) {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Make sure that the token will not last beyond the expiration date of the RODiT
    const notafter = await dateStringToUnixTime(peerrodit.metadata.notafter);
    const duration = parseInt(peerrodit.metadata.jwtduration, 10);
    let expiresat = now;

    if (now + duration < notafter) {
      expiresat = parseInt(now) + parseInt(peerrodit.metadata.jwtduration);
    } else {
      throw new Error("Error 009: RODiT duration check failed");
    }

    console.debug("Info: This API endpoint Login of Client check passed");
    const notbefore = await dateStringToUnixTime(ownrodit.metadata.notbefore);

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
      iss: ownrodit.metadata.subjectuniqueidentifierurl, // App Name
      sub: peerrodit.metadata.serviceproviderid + ";sub=" + peerrodit.token_id, // Unique Id of the client
      aud: peerrodit.metadata.serviceproviderid, // App Client
      exp: expiresat,
      nbf: notbefore,
      iat: now,
      jti: "jti" + ulid(), // jti added to distinguish this quickly visually from the rodit_id
      // amr: "near.org/rodit" // field added to indicate which blockchain and authentication method version has been used
      rodit_id: ownrodit.token_id,
      rodit_idsignature: own_roditid_base64url_signature,
      rodit_maxrequests: ownrodit.metadata.maxrequests,
      rodit_maxrqwindow: ownrodit.metadata.maxrqwindow,
      rodit_permissionedroutes: own_rodit.metadata.permissionedroutes,

    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(own_rodit_keyobject_private_key);
    return token;
  } catch (error) {
    logger.error(`Error 008: in generate_jwt_token: ${error.message}`);
    throw error; // Re-throw the error if you want calling functions to handle it
  }
}



async function validate_jwt_token(token, ownrodit) {
  try {
    const unverifiedpayload = decodeJwt(token);
    const account_idargs = `{"token_id": "${unverifiedpayload.rodit_id}"}`;
    const sp_rodit = await nearorg_rpc_tokenfromroditid(
      CONSTANTS.BLOCKCHAIN_NETWORK,
      CONSTANTS.SMART_CONTRACT,
      "rodit_token",
      account_idargs
    );
    let serviceprovider_base64_public_key = Buffer.from(
      sp_rodit.owner_id,
      "hex"
    ).toString("base64url");
    const jwk_public_key = await base64url2jwk_public_key(
      serviceprovider_base64_public_key
    );
    const { payload, _ } = await jwtVerify(token, jwk_public_key, {
      algorithms: ["EdDSA"],
    });

    set_session_jwk_public_key(serviceprovider_base64_public_key);

    let { peer_rodit, goodrodit } = await verify_peerrodit_getit(
      payload.rodit_id,
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

      if (payload.iss !== ownrodit.metadata.subjectuniqueidentifierurl) {
        throw new Error("Error 005: Invalid issuer");
      }

      if (payload.aud !== ownrodit.metadata.serviceproviderid) {
        throw new Error("Error 004: Invalid audience");
      }

      return { payload, peer_rodit };
    } else throw error;
  } catch (error) {
    logger.error("Error 003: Token validation failed: ${error}");
    throw error;
  }
}

async function verify_jwt_token(req, res, next) {
  try {
    const authHeader = req.headers["authorization"];

    let token;
    if (authHeader) {
      const parts = authHeader.split(" ");
      token = parts.length > 1 ? parts[1] : null;
    }

    if (token == null) {
      return res.status(401).json({ error: " Error 002: No token provided" });
    }

    const jwk_public_key = await base64url2jwk_public_key(
      get_session_jwk_public_key()
    );
    const { payload, protectedHeader } = await jwtVerify(
      token,
      jwk_public_key,
      {
        algorithms: ["EdDSA"],
      }
    );
    req.user = payload;
    next();
  } catch (error) {
    logger.error(`Error 001: in verify_jwt_token: ${error.message}`);
    return res.status(403).json({ error: "Token verification failed" });
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

function set_session_jwk_public_key(jwk_public_key) {
  session_base64url_jwk_public_key = jwk_public_key;
}

function get_session_jwk_public_key() {
  return session_base64url_jwk_public_key;
}

const send_webhook = async (event, data, isError = false) => {
  if (!config_own_rodit || !config_own_rodit.own_rodit.metadata.webhookurl) {
    logger.error("Error 111: Webhook URL not available in Rodit configuration");
    return;
  }

  const timestamp = Date.now();
  const payload = JSON.stringify({ event, data, isError, timestamp });
  const sha256_ofpayload = crypto.createHash('sha256').update(payload).digest();

  try {
    // Convert the hex private key to Uint8Array for TweetNaCl
    const own_rodit_private_key = new Uint8Array(Buffer.from(config_own_rodit.own_rodit_bytes_private_key, 'hex'));

    // Sign the payload hash with the Ed25519 private key using TweetNaCl
    const signature_ofpayload = nacl.sign.detached(sha256_ofpayload, own_rodit_private_key);

    // Convert the signature_ofpayload to a hex string
    const signature_hex_ofpayload = Buffer.from(signature_ofpayload).toString('hex');

    // Send the webhook
    const response = await fetch(`http://${config_own_rodit.own_rodit.metadata.webhookurl}/webhook`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature_hex_ofpayload,
        "X-Timestamp": timestamp.toString()
      },
      body: payload
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await response.text(); // consume the response body
    logger.info(`Webhook sent successfully: ${event}`);
  } catch (error) {
    logger.error(`Webhook error for event ${event}: ${error.message}`);
  }
};

const authenticate_webhook = (signature, timestamp, payload, publicKey) => {
  // Verify the timestamp (e.g., within last 5 minutes)
  const currentTime = Date.now();
  const timeThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds
  if (currentTime - parseInt(timestamp) > timeThreshold) {
    throw new Error('Error 199: Webhook timestamp is too old');
  }

  // Verify the signature
  const sha256_ofpayload = crypto.createHash('sha256').update(payload).digest();
  const buffer_signature_ofpayload = Buffer.from(signature, 'hex');

  // Verify the signature using TweetNaCl
  const isValid = nacl.sign.detached.verify(
    sha256_ofpayload,
    buffer_signature_ofpayload,
    publicKey
  );

  if (!isValid) {
    throw new Error('Error 198: Invalid signature');
  }

  return true;
};

module.exports = {
  set_rodit_config,
  get_rodit_config,
  login_and_verify_server,
  generate_jwt_token,
  verify_jwt_token,
  verify_peerrodit_getit,
  send_webhook,
  authenticate_webhook,
};
