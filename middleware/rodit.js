// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

/**
 * Module Dependencies
 */
const bs58 = require("bs58");
const { ulid } = require("ulid");
const config = require("config");
const fs = require("fs").promises;
const logger = require("../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const borsh = require("borsh");
nacl.util = require("tweetnacl-util");
const { decodeUTF8 } = require("tweetnacl-util");
const { importJWK, jwtVerify, decodeJwt, SignJWT } = require("jose");
const { Resolver } = require("dns").promises;
const base64url = require("base64url");

// Global state (consider refactoring to reduce global state)
class AuthStateManager {
 constructor() {
  if (AuthStateManager.instance) {
   return AuthStateManager.instance;
  }
  AuthStateManager.instance = this;
  
  // Standardize property names
  this.sessionBase64urlJwkPublicKey = null;
  this.configOwnRodit = null;
  this.currentToken = null;
 }

 // Use consistent method names
 setSessionBase64urlJwkPublicKey(key) {
  this.sessionBase64urlJwkPublicKey = key;
 }

 getSessionBase64urlJwkPublicKey() {
  return this.sessionBase64urlJwkPublicKey;
 }

 setConfigOwnRodit(config) {
  this.configOwnRodit = config;
 }

 getConfigOwnRodit() {
  return this.configOwnRodit;
 }

 setCurrentToken(token) {
  this.currentToken = token;
 }

 getCurrentToken() {
  return this.currentToken;
 }
}

const stateManager = new AuthStateManager();

const resolver = new Resolver();

/**
 * Constants and Configuration
 */
const CONSTANTS = {
 SMART_CONTRACT: "10975-cableguard-org.testnet",
 SMART_CONTRACT_REVOKED: "10975-revoked-cableguard-org.testnet",
 BLOCKCHAIN_NETWORK: ".testnet",
 RODIT_ID_SZ: 128,
 RODIT_ID_PK_SZ: 32,
 RODIT_ID_SIGNATURE_SZ: 64,
 ED25519_KEY_SZ: 64,
};

const API_OPTIONS = config.get("API_OPTIONS");
const SERVERPORT = config.get("SERVERPORT");
const API_PROTOCOL = config.get("API_PROTOCOL");
const NEAR_RPC_URL = config.get("NEAR_RPC_URL");
const tokenrenewaloptions = API_OPTIONS.TOKENRENEWALOPTIONS;

/**
 * Core Data Structures
 */
class RODiT {
 constructor() {
  this.token_id = "";
  this.owner_id = "";
  this.metadata = {
   openapijson_url: "",
   not_after: "",
   not_before: "",
   max_requests: "",
   maxrq_window: "",
   webhook_url: "",
   webhook_cidr: "",
   userselected_dn: "",
   allowed_cidr: "",
   allowed_iso3166list: "",
   jwt_duration: "",
   permissioned_routes: "",
   subjectuniqueidentifier_url: "",
   serviceprovider_id: "",
   serviceprovider_signature: "",
  };
 }
}

class PayloadNEP413 {
 constructor(props) {
  this.tag = props.tag || 2147484061;
  this.message = props.message;
  if (props.nonce instanceof Uint8Array) {
   if (props.nonce.length !== 32) {
    throw new Error("Nonce must be exactly 32 bytes");
   }
   this.nonce = props.nonce;
  } else if (
   Array.isArray(props.nonce) ||
   (typeof props.nonce === "object" && props.nonce !== null)
  ) {
   const nonceArray = Array.isArray(props.nonce)
    ? props.nonce
    : Object.values(props.nonce);
   if (nonceArray.length !== 32) {
    throw new Error("Nonce must be exactly 32 bytes");
   }
   this.nonce = new Uint8Array(nonceArray);
  } else {
   throw new Error(
    "Invalid nonce format - must be Uint8Array or convertible to Uint8Array"
   );
  }
  this.recipient = props.recipient;
  this.callbackUrl = props.callbackUrl;
 }
}

const PayloadNEP413Schema = {
 struct: {
  tag: "u32",
  message: "string",
  nonce: { array: { type: "u8", len: 32 } },
  recipient: "string",
  callbackUrl: { option: "string" },
 },
};

/**
 * Utility Functions
 */
const debugWithType = (name, value) => {
 const type = typeof value;
 const isNull = value === null;
 const isUndefined = value === undefined;
 const isArray = Array.isArray(value);

 let detailedType = type;
 if (isNull) detailedType = "null";
 if (isUndefined) detailedType = "undefined";
 if (isArray) detailedType = "array";

 const valueDisplay = isNull || isUndefined ? String(value) : value;

 console.debug(`${name}:`, {
  value: valueDisplay,
  type: detailedType,
 });
};

const setValue = (obj, field, value) => {
 if (obj && typeof obj === "object") {
  obj[field] = value;
 }
 return value;
};

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

/**
 * Data Validation Functions
 */
const validateAndSetUrl = (value, field, obj = null) => {
 if (value == null) {
  return null;
 }
 
 // First remove any existing protocol
 let normalizedUrl = value.replace(/^(https?:\/\/)/, '');
 
 // Now validate the domain part with slightly modified regex to ensure same behavior
 const urlRegex = /^(localhost(:[0-9]{1,5})?|([\da-z\.-]+)\.([a-z\.]{2,6})|((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))([\/\w \.-]*)*\/?$/i;

 // If valid domain, always store with https://
 if (urlRegex.test(normalizedUrl)) {
  return setValue(obj, field, `https://${normalizedUrl}`);
 }

 throw new Error(`Invalid URL for ${field}: ${value}`);
};

const validateAndSetDate = (value, field, obj = null) => {
 if (value == null || value === "0" || value === "") {
  return "1970-01-01";
 }
 const date = new Date(value);
 if (isNaN(date.getTime()) || date < new Date("1970-01-01")) {
  throw new Error(
   `Invalid date for ${field}: ${value}. Must be YYYY-MM-DD and no earlier than 1970-01-01`
  );
 }
 return setValue(obj, field, value);
};

const validateAndSetJson = (value, field, obj = null) => {
 if (value == null) {
  return null;
 }
 let jsonString;
 if (typeof value === "object") {
  jsonString = JSON.stringify(value);
 } else if (typeof value === "string") {
  try {
   JSON.parse(value);
   jsonString = value;
  } catch (e) {
   throw new Error(`Invalid JSON for ${field}: ${value}`);
  }
 } else {
  throw new Error(`Invalid type for ${field}: ${typeof value}`);
 }
 return setValue(obj, field, jsonString);
};

const validateAndSetSignature = (value, field, obj = null) => {
 if (value == null) {
  return null;
 }
 const base64urlPattern = /^[A-Za-z0-9_-]+$/;
 if (!base64urlPattern.test(value)) {
  throw new Error(`Invalid base64url encoding for ${field}: ${value}`);
 }
 if (value.length !== 86) {
  throw new Error(
   `Invalid signature length for ${field}: ${value}. Expected 86 characters for base64url encoded Ed25519 signature.`
  );
 }
 return setValue(obj, field, value);
};

function ensureDateIsSet(dateVar, defaultValue) {
 return dateVar || defaultValue;
}

/**
 * Data Transformation Functions
 */
function base64ToBase64Url(base64) {
 return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function canonicalizeObject(obj) {
 if (typeof obj !== "object" || obj === null) {
  return obj;
 }
 if (Array.isArray(obj)) {
  return obj.map(canonicalizeObject);
 }
 return Object.fromEntries(
  Object.entries(obj)
   .sort()
   .map(([key, value]) => [key, canonicalizeObject(value)])
 );
}

function calculateCanonicalHash(variable) {
 const canonicalObj = canonicalizeObject(variable);
 const canonicalJson = JSON.stringify(canonicalObj);
 const messageUint8 = decodeUTF8(canonicalJson);
 const hashUint8 = nacl.hash(messageUint8);

 return Array.from(hashUint8)
  .map((b) => b.toString(16).padStart(2, "0"))
  .join("");
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

/**
 * Session Management Functions
 */

async function set_rodit_config(
 own_rodit_hex_accountid,
 own_string_private_key
) {
 try {
  const smartContractUrl = CONSTANTS.SMART_CONTRACT;
  const urlExtension = smartContractUrl.split(".").pop();

  // Check network mismatch
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

  // Check account balance but don't stop on error
  let own_rodit;
  try {
   const result = await nearorg_rpc_state(
    CONSTANTS.SMART_CONTRACT,
    own_rodit_hex_accountid
   );

   if (result === false) {
    logger.warn(
     `Warning 042: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`
    );
   }

   own_rodit = await nearorg_rpc_tokensfromaccountid(
    CONSTANTS.SMART_CONTRACT,
    own_rodit_hex_accountid
   );
  } catch (balanceError) {
   logger.warn(
    `Warning 042: The NEAR account has no balance in ${CONSTANTS.BLOCKCHAIN_NETWORK}`
   );
   // Continue execution even after balance check fails
   own_rodit = await nearorg_rpc_tokensfromaccountid(
    CONSTANTS.SMART_CONTRACT,
    own_rodit_hex_accountid
   );
  }

  const session_base64url_jwk_public_key = hex2base64url(
   own_rodit_hex_accountid
  );
  stateManager.setSessionBase64urlJwkPublicKey(session_base64url_jwk_public_key);

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
   own_rodit.metadata.subjectuniqueidentifier_url +
   ":" +
   SERVERPORT;
  let port = SERVERPORT;

  const iso639 = API_OPTIONS.ISO639;
  const iso3166 = API_OPTIONS.ISO3166;
  const iso15924 = API_OPTIONS.ISO15924;
  const timeoptions = API_OPTIONS.TIMEOPTIONS;

  stateManager.setConfigOwnRodit({
   own_rodit,
   own_rodit_bytes_private_key,
   apiendpoint,
   port,
   iso639,
   iso3166,
   iso15924,
   timeoptions,
  });

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

// Log in and verify the server endpoint
async function login_server(
 own_rodit // Ready to login to several servers
) {
 try {
  const config_own_rodit = await stateManager.getConfigOwnRodit();
  if (!config_own_rodit) {
   logger.error("Error: Client configuration not initialized");
   return;
  }
  const apiendpoint = config_own_rodit.apiendpoint;
  let roditid = own_rodit.token_id;
  const timestamp = Math.floor(Date.now() / 1000);

  const roditidandtimestamp = new TextEncoder().encode(
   roditid + (await unixTimeToDateString(timestamp))
  );

  const own_rodit_bytes_signature = nacl.sign.detached(
   roditidandtimestamp,
   config_own_rodit.own_rodit_bytes_private_key
  );

  const roditid_base64url_signature = Buffer.from(
   own_rodit_bytes_signature
  ).toString("base64url");

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
   const { _, peer_rodit } = await validate_jwt_token_be(
    jwt_token,
    own_rodit
   );
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

async function login_client(req, res) {
 try {
  const {
   roditid: peer_roditid,
   timestamp: peer_timestamp,
   roditid_base64url_signature: roditid_base64url_signature,
  } = req.body;
  console.debug("Info: Client RODiT ID:", peer_roditid);

  if (!peer_roditid || !peer_timestamp || !roditid_base64url_signature) {
   return res.status(400).json({
    message: "Error 100: Missing RODiT ID, Signature or Timestamp",
   });
  }

  try {
   const config_own_rodit = await stateManager.getConfigOwnRodit();

   if (!config_own_rodit) {
    throw new Error("Error 111: Server configuration not initialized");
   }

   const { peer_rodit: peer_rodit, goodrodit: isRoditValid } =
    await verify_peerrodit_getrodit(
     peer_roditid,
     peer_timestamp,
     roditid_base64url_signature,
     config_own_rodit.own_rodit
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

   const token = await generate_jwt_token(
    peer_rodit,
    peer_timestamp,
    config_own_rodit.own_rodit,
    config_own_rodit.own_rodit_bytes_private_key
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

async function login_client_withnep413(req, res) {
 try {
  const { signature, message, nonce, recipient, callbackUrl } = req.body;

  // Validate required fields
  if (!signature || !message || !nonce || !recipient || !callbackUrl) {
   return res.status(400).json({
    message: "Error 100: Missing required fields",
    details: "All fields are required",
   });
  }

  // Get the RODiT token for public key verification
  const config_own_rodit = await stateManager.getConfigOwnRodit();

  if (!config_own_rodit) {
   throw new Error("Error 113: Server configuration not initialized");
  }

  const { peer_rodit: peer_rodit, goodrodit: isRoditValid } =
   await verify_peerrodit_getrodit_withnep413(
    message,
    nonce,
    recipient,
    callbackUrl,
    signature,
    config_own_rodit.own_rodit
   );

  if (!isRoditValid) {
   logger.error(
    "Error 107: Login attempt failed: Invalid RODiT ID or Signature"
   );
   return res.status(401).json({
    message:
     "Error 106: Login attempt failed: Invalid RODiT ID or Signature",
   });
  }

  const token = await generate_jwt_token(
   peer_rodit,
   Math.floor(Date.now() / 1000),
   config_own_rodit.own_rodit,
   config_own_rodit.own_rodit_bytes_private_key
  );

  return res.json({ token });
 } catch (error) {
  console.error("=== Error ===");
  console.error("Login error:", error);
  console.error("Stack:", error.stack);
  return res.status(500).json({
   message: `Error 175c: Login attempt failed: ${error.message}`,
  });
 }
}

async function validate_jwt_token_be(token, own_rodit) {
 try {
  const unverifiedpayload = decodeJwt(token);

  const sp_rodit = await nearorg_rpc_tokenfromroditid(
   unverifiedpayload.rodit_id
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

  stateManager.setSessionBase64urlJwkPublicKey(serviceprovider_base64_public_key)

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

   if (payload.iss !== own_rodit.metadata.subjectuniqueidentifier_url) {
    throw new Error("Error 005: Invalid issuer");
   }

   if (payload.aud !== own_rodit.owner_id) {
    throw new Error("Error 004: Invalid audience");
   }

   return { payload, peer_rodit };
  }
 } catch (error) {
  logger.error(`Error in validate_jwt_token_be: ${error.message}`);
  throw new Error(`JWT token validation failed: ${error.message}`);
 }
}

async function verify_peerrodit_getrodit(
 peerroditid,
 peertimestamp,
 peerroditid_base64url_signature,
 own_rodit
) {
 try {
  const peer_rodit = await nearorg_rpc_tokenfromroditid(peerroditid);
  console.debug("peer_rodit", peer_rodit);
  const [ownershipVerified, isVerified, isLive, isActive, isTrusted] =
   await Promise.all([
    verify_rodit_ownership(
     peerroditid,
     peertimestamp,
     peerroditid_base64url_signature,
     peer_rodit
    ),
    verify_rodit_isamatch(
     own_rodit.metadata.serviceprovider_id,
     peer_rodit
    ),
    verify_rodit_islive(
     peer_rodit.metadata.not_after,
     peer_rodit.metadata.not_before
    ),
    verify_rodit_isactive(
     peer_rodit.token_id,
     own_rodit.metadata.subjectuniqueidentifier_url
    ),
    verify_rodit_istrusted_issuingsmartcontract(
     own_rodit.metadata.subjectuniqueidentifier_url
    ),
   ]);

  if (
   !ownershipVerified ||
   !isVerified ||
   !isLive ||
   !isActive ||
   !isTrusted
  ) {
   throw new Error("Error 037: Peer RODiT verification failed");
  }

  console.debug("Info: Peer Account ID:", peer_rodit.owner_id);
  return {
   peer_rodit,
   goodrodit: true,
  };
 } catch (error) {
  console.debug(`Error 036: in verify_peerrodit_getrodit: ${error.message}`);
  return {
   peer_rodit: null,
   goodrodit: false,
   error: `Error 036: in verify_peerrodit_getrodit: ${error.message}`,
  };
 }
}

async function verify_peerrodit_getrodit_withnep413(
 message,
 nonce,
 recipient,
 callbackUrl,
 signature,
 own_rodit
) {
 try {
  let peer_rodit = await nearorg_rpc_tokenfromroditid(message);
  const verification_results = await Promise.all([
   verify_rodit_ownership_withnep413(
    message,
    nonce,
    recipient,
    callbackUrl,
    signature,
    peer_rodit
   ),
   verify_rodit_isamatch(own_rodit.metadata.serviceprovider_id, peer_rodit),
   verify_rodit_islive(
    peer_rodit.metadata.not_after,
    peer_rodit.metadata.not_before
   ),
   verify_rodit_isactive(
    peer_rodit.token_id,
    own_rodit.metadata.subjectuniqueidentifier_url
   ),
   verify_rodit_istrusted_issuingsmartcontract(
    own_rodit.metadata.subjectuniqueidentifier_url
   ),
  ]);

  const [ownershipVerified, isVerified, isLive, isActive, isTrusted] =
   verification_results;

  console.debug("RODiT Verification Results:", {
   ownershipVerified: {
    status: ownershipVerified,
    description: "Checks if the RODiT possession is valid",
   },
   isVerified: {
    status: isVerified,
    description: "Verifies if RODiT matches the service provider",
   },
   isLive: {
    status: isLive,
    description: "Checks if RODiT is within its valid time period",
   },
   isActive: {
    status: isActive,
    description: "Verifies if RODiT has not been revoked",
   },
   isTrusted: {
    status: isTrusted,
    description: "Confirms if the issuing smart contract is trusted",
   },
  });

  if (
   !ownershipVerified ||
   !isVerified ||
   !isLive ||
   !isActive ||
   !isTrusted
  ) {
   throw new Error("Error 037: Peer RODiT verification failed");
  }

  console.debug("Info: Peer Account ID:", peer_rodit.owner_id);
  return {
   peer_rodit,
   goodrodit: true,
  };
 } catch (error) {
  console.debug(
   `Error 336: in verify_peerrodit_getrodit_withnep413: ${error.message}`
  );
  return {
   peer_rodit: null,
   goodrodit: false,
   error: `Error 337: in verify_peerrodit_getrodit_withnep413: ${error.message}`,
  };
 }
}

async function verify_rodit_ownership_withnep413(
 message,
 nonce,
 recipient,
 callbackUrl,
 signature,
 peer_rodit
) {
 try {
  const payload = new PayloadNEP413({
   tag: 2147484061, // Include tag in the payload
   message,
   nonce: new Uint8Array(Object.values(nonce)),
   recipient,
   callbackUrl,
  });

  // Serialize the payload using borsh
  const serializedPayload = borsh.serialize(PayloadNEP413Schema, payload);

  // Hash the serialized payload
  const payloadHash = crypto
   .createHash("sha256")
   .update(serializedPayload)
   .digest();

  // Convert signature from base64url to base64
  const standardBase64 = signature
   .replace(/-/g, "+")
   .replace(/_/g, "/")
   .padEnd(signature.length + ((4 - (signature.length % 4)) % 4), "=");

  const signatureBytes = nacl.util.decodeBase64(standardBase64);
  const publicKeyBytes = new Uint8Array(
   Buffer.from(peer_rodit.owner_id, "hex")
  );

  // Verify the signature against the hash of the serialized payload
  const isVerified = nacl.sign.detached.verify(
   payloadHash, // Use hash of serialized payload instead of bundle hash
   signatureBytes,
   publicKeyBytes
  );

  if (isVerified) {
   console.debug("Info: Peer RODiT possession check passed");
   return true;
  } else {
   logger.error("Error: Peer RODiT possession check failed");
   throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
  }
 } catch (error) {
  logger.error(`Error 034: ${error}`);
  throw new Error("Error 033:");
 }
}

async function verify_rodit_ownership(
 peerroditid,
 peertimestamp,
 peerroditid_base64url_signature,
 peer_rodit
) {
 try {
  const roditidandtimestamp = new TextEncoder().encode(
   "NEAR" + peerroditid + (await unixTimeToDateString(peertimestamp))
  );

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
   return true;
  } else {
   logger.error("Error: Peer RODiT possession check failed");
   throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
  }
 } catch (error) {
  logger.error(`Error 034: ${error}`);
  throw new Error("Error 033:");
 }
}

async function verify_rodit_isamatch(own_service_provider_id, peer_rodit) {
 try {
  const own_provider_ids = own_service_provider_id.split(";");
  if (own_provider_ids.length < 2) {
   logger.error("Error: Invalid own serviceprovider_id format");
   return false;
  }
  const signing_token_ulid = own_provider_ids[1];

  const base_prefix = "bc=near.org;sc=" + config.NEAR_CONTRACT_ID;

  const signing_token_id = `${base_prefix};id=${signing_token_ulid}`;

  console.debug("Looking up signing RODiT:", {
   signing_token_id,
   peer_provider_id: peer_rodit.metadata.serviceprovider_id,
  });

  const signing_rodit = await nearorg_rpc_tokenfromroditid(signing_token_id);

  console.debug("peer_rodit:", peer_rodit);
  console.debug("signing_rodit:", signing_rodit);

  let bytes_signing_owner_id;
  try {
   bytes_signing_owner_id = new Uint8Array(
    Buffer.from(signing_rodit.owner_id, "hex")
   );
   console.debug("Info: Signing RODiT Account ID:", signing_rodit.owner_id);
  } catch (error) {
   logger.error("Error: Failed to decode signing key");
   return false;
  }

  if (bytes_signing_owner_id.length !== CONSTANTS.RODIT_ID_PK_SZ) {
   logger.error("Error: Invalid signing key length");
   return false;
  }

  const base64urlSignature = peer_rodit.metadata.serviceprovider_signature;

  // Convert base64url back to base64
  const base64Signature = base64urlSignature
   .replace(/-/g, "+")
   .replace(/_/g, "/")
   .padEnd(
    base64urlSignature.length + ((4 - (base64urlSignature.length % 4)) % 4),
    "="
   );

  // Convert base64 to bytes (matching the original signing output)
  const bytes_signature = new Uint8Array(
   Buffer.from(base64Signature, "base64")
  );

  if (bytes_signature.length !== CONSTANTS.RODIT_ID_SIGNATURE_SZ) {
   logger.error("Error: Invalid signature length");
   return false;
  }

  const hashInput = {
   token_id: peer_rodit.token_id,
   openapijson_url: peer_rodit.metadata.openapijson_url,
   not_after: peer_rodit.metadata.not_after,
   not_before: peer_rodit.metadata.not_before,
   max_requests: peer_rodit.metadata.max_requests,
   maxrq_window: peer_rodit.metadata.maxrq_window,
   webhook_cidr: peer_rodit.metadata.webhook_cidr,
   allowed_cidr: peer_rodit.metadata.allowed_cidr,
   allowed_iso3166list: peer_rodit.metadata.allowed_iso3166list,
   jwt_duration: peer_rodit.metadata.jwt_duration,
   permissioned_routes: peer_rodit.metadata.permissioned_routes,
   serviceprovider_id: peer_rodit.metadata.serviceprovider_id,
   subjectuniqueidentifier_url:
    peer_rodit.metadata.subjectuniqueidentifier_url,
  };

  // Right before calculating hash:
  console.debug("Pre-hash inputs:", {
   hashInput: JSON.stringify(hashInput, null, 2),
  });

  const hashBytes = new Uint8Array(
   Buffer.from(calculateCanonicalHash(hashInput), "hex")
  );

  console.debug("Verification components:", {
   hashBytes: Buffer.from(hashBytes).toString("hex"),
   signature: Buffer.from(bytes_signature).toString("hex"),
   publicKey: Buffer.from(bytes_signing_owner_id).toString("hex"),
  });

  const sigBytes = new Uint8Array(Buffer.from(base64Signature, 'base64'));
  console.debug("Signature conversion steps:", {
   original_base64url: base64urlSignature,
   converted_base64: base64Signature,
   final_bytes: Buffer.from(sigBytes).toString('hex'),
   verify_inputs: {
    message: Buffer.from(hashBytes).toString('hex'),
    signature: Buffer.from(bytes_signature).toString('hex'),
    pubkey: Buffer.from(bytes_signing_owner_id).toString('hex')
   }
  });

  const is_valid = nacl.sign.detached.verify(
   hashBytes,
   bytes_signature,
   bytes_signing_owner_id
  );

  if (is_valid) {
   console.debug("Info: Signature verification successful");
   return true;
  } else {
   logger.error("Error: Signature verification failed");
   return false;
  }
 } catch (error) {
  logger.error("Error: Verification failed with error", error);
  return false;
 }
}

async function verify_rodit_isactive(tokenId, ownsubjectuniqueidentifier_url) {
 const domainandextensionRegex =
  /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

 // Find the rightmost part (domain and extension)
 const match = ownsubjectuniqueidentifier_url.match(domainandextensionRegex);

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
 ownsubjectuniqueidentifier_url
) {
 try {
  const smartcontract = CONSTANTS.SMART_CONTRACT;
  const smartontractnonear = smartcontract.replace(".testnet", "");
  const smartcontracturl = smartontractnonear.replace("-", ".");

  const domainandextension =
   /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

  const maindomainmatch = domainandextension.exec(
   ownsubjectuniqueidentifier_url
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
      `Error 024: Smart Contract ${smartcontracturl} not trusted by ${domainandextension}`
     );
     return false;
    }
   } catch (error) {
    logger.error(
     `Error 023: Smart Contract ${smartcontracturl} not trusted by ${domainandextension}`
    );
    return false;
   }
  } else {
   logger.error(`Error 022: Domain can't be parsed`);
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

async function nearorg_rpc_tokenfromroditid(roditid) {
 try {
  const json_data = {
   jsonrpc: "2.0",
   id: CONSTANTS.SMART_CONTRACT,
   method: "query",
   params: {
    request_type: "call_function",
    finality: "final",
    account_id: CONSTANTS.SMART_CONTRACT,
    method_name: "rodit_token",
    args_base64: Buffer.from(
     JSON.stringify({ token_id: roditid })
    ).toString("base64"),
   },
  };

  const response = await fetch(NEAR_RPC_URL, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(json_data),
  });

  const responseText = await response.text();
  const parsedJson = JSON.parse(responseText);

  if (parsedJson.result && parsedJson.result.error) {
   console.debug("Error: WASM execution:", parsedJson.result.error);
   throw new Error(
    `Smart contract execution failed: ${parsedJson.result.error}`
   );
  }

  const resultArray = parsedJson.result.result;
  if (!Array.isArray(resultArray)) {
   throw new Error("Error: Result is not an array");
  }

  const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
  const parsed = JSON.parse(resultString);
  const rodit = new RODiT();
  Object.assign(rodit, parsed);
  return rodit;
 } catch (error) {
  logger.error(`Error fetching RODiT: ${error}`);
  throw new Error("Error fetching RODiT");
 }
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

async function nearorg_rpc_tokensfromaccountid(id, account_id) {
 const args = JSON.stringify({
  account_id: account_id,
  from_index: null,
  limit: null,
 });

 const jsonData = {
  jsonrpc: "2.0",
  id: id,
  method: "query",
  params: {
   request_type: "call_function",
   finality: "final",
   account_id: id,
   method_name: "rodit_tokens_for_owner",
   args_base64: Buffer.from(args).toString("base64"),
  },
 };

 try {
  const response = await fetch(NEAR_RPC_URL, {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(jsonData),
  });

  const responseText = await response.text();
  const parsedJson = JSON.parse(responseText);

  // Check for WASM execution errors first
  if (parsedJson.result && parsedJson.result.error) {
   console.debug("Error 002: WASM execution:", parsedJson.result.error);
   throw new Error(
    `Error 013: Smart contract execution failed: ${parsedJson.result.error}`
   );
  }

  const resultArray = parsedJson.result.result;
  if (!Array.isArray(resultArray)) {
   throw new Error("Error 012: Result is not an array");
  }

  // Convert the array of numbers to a string
  const resultString = new TextDecoder().decode(new Uint8Array(resultArray));

  // Parse the resulting JSON string
  const resultStruct = JSON.parse(resultString);

  // Handle the no RODiT instance case differently
  if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
   logger.warn("Warning 011: No RODiT instance found");
   // Return a default or empty RODiT instance instead of throwing
   const emptyRodit = new RODiT();
   // Set any default values if needed
   // emptyRodit.someDefaultProperty = someDefaultValue;
   return emptyRodit;
  }

  // Create a new RODiT instance and populate it
  const rodit = new RODiT();
  Object.assign(rodit, resultStruct[0]);
  return rodit;
 } catch (error) {
  console.debug("Error 004 in fetch or processing:", error);
  logger.error(`Error 010: ${error.message}`);
  throw error; // Still throw other errors
 }
}

async function generate_jwt_token(
 peer_rodit,
 peer_timestamp,
 own_rodit,
 own_rodit_bytes_private_key
) {
 try {
  const now = peer_timestamp;
  const notafter = await dateStringToUnixTime(peer_rodit.metadata.not_after);
  const duration = parseInt(peer_rodit.metadata.jwt_duration, 10);
  let expiresat = now;
  if (now + duration < notafter) {
   expiresat = parseInt(now) + parseInt(peer_rodit.metadata.jwt_duration);
  } else {
   throw new Error("Error 009: RODiT duration check failed");
  }
  console.debug("Info: This API endpoint Login of Client check passed");
  const notbefore = await dateStringToUnixTime(own_rodit.metadata.not_before);

  const roditidandtimestamp = new TextEncoder().encode(
   own_rodit.token_id + (await unixTimeToDateString(peer_timestamp))
  );

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
   iss: peer_rodit.metadata.subjectuniqueidentifier_url, // App Name
   sub:
    peer_rodit.metadata.serviceprovider_id + ";sub=" + peer_rodit.token_id, // Unique Id of the client
   aud: peer_rodit.owner_id, // App Client
   exp: expiresat,
   nbf: notbefore,
   iat: peer_timestamp,
   jti: "jti" + ulid(), // jti added to distinguish this quickly visually from the rodit_id
   // amr: "near.org/rodit" // field added to indicate which blockchain and authentication method version has been used
   rodit_id: own_rodit.token_id,
   rodit_owner: own_rodit.owner_id,
   rodit_idsignature: own_roditid_base64url_signature,
   rodit_maxrequests: peer_rodit.metadata.max_requests,
   rodit_maxrqwindow: peer_rodit.metadata.maxrq_window,
   rodit_permissionedroutes: peer_rodit.metadata.permissioned_routes,
   rodit_webhookcidr: peer_rodit.metadata.webhook_cidr, // CIDR that can be used by the client to accept webhook requests only from specific IPs
   rodit_allowedcidr: peer_rodit.metadata.allowed_cidr, // CIDR that limit from what networks the client can perform calls
   rodit_allowediso3166list: peer_rodit.metadata.allowed_iso3166list, // List that limits from which countries the client can perform calls
   rodit_webhookurl: peer_rodit.metadata.webhook_url, // URL that can receive webhook calls
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

async function brief_validate_jwt_token_be(token) {
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
   notAfter: peer_rodit.metadata.not_after,
  };
 } catch (error) {
  logger.error(`Error in brief_validate_jwt_token_be: ${error}`);
  return {
   isValid: false,
   notAfter: null,
  };
 }
}

async function thorough_validate_jwt_token_be(token) {
 try {
  const config_own_rodit = await stateManager.getConfigOwnRodit();
  const peer_rodit = await nearorg_rpc_tokenfromroditid(token.aud);

  const [isVerified, isLive, isActive, isTrusted] = await Promise.all([
   verify_rodit_isamatch(
    config_own_rodit.own_rodit.metadata.serviceprovider_id,
    peer_rodit
   ),
   verify_rodit_islive(
    peer_rodit.metadata.not_after,
    peer_rodit.metadata.not_before
   ),
   verify_rodit_isactive(
    peer_rodit.token_id,
    config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
   ),
   verify_rodit_istrusted_issuingsmartcontract(
    config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url
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
    notAfter: peer_rodit.metadata.not_after,
   };
  }

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
   notAfter: peer_rodit.metadata.not_after,
  };
 } catch (error) {
  logger.error(`Error in throrough_validate_jwt_token_be: ${error}`);
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

  const config_own_rodit = await stateManager.getConfigOwnRodit();

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
     code: "MISSING_TOKEN",
     message: "No token provided",
     requestId,
    },
   });
  }

  try {
   const jwk_public_key = await base64url2jwk_public_key(
    stateManager.getSessionBase64urlJwkPublicKey()
   );
   logger.debug(`Public key retrieved - Request ID: ${requestId}`);

   let { payload, protectedHeader, newToken } = await verifyToken(
    token,
    jwk_public_key,
    req.headers["x-timestamp"],
    requestId
   );

   if (newToken) {
    res.setHeader("New-Token", newToken);
    logger.info(
     `Token renewed after expiration - Request ID: ${requestId}`
    );
   } else if (tokenrenewaloptions.SERVERORCLIENT === "SERVER-INITIATED") {
    // Server-initiated token renewal logic
    const renewalResult = await checkAndRenewToken(
     payload,
     req.headers["x-timestamp"],
     requestId
    );
    if (renewalResult.newToken) {
     res.setHeader("New-Token", renewalResult.newToken);
     logger.info(
      `Token renewed - Request ID: ${requestId}`,
      renewalResult.logInfo
     );
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
  logger.error(
   `Unexpected error in authenticate_apicall: ${error.message} - Request ID: ${requestId}`
  );
  return res.status(500).json({
   error: {
    code: "INTERNAL_SERVER_ERROR",
    message: "Internal server error during authentication",
    requestId,
   },
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
  const result = await jwtVerify(token, jwk_public_key, {
   algorithms: ["EdDSA"],
  });
  logger.debug(`Token verified successfully - Request ID: ${requestId}`);
  return result;
 } catch (jwtError) {
  if (jwtError.code === "ERR_JWT_EXPIRED") {
   logger.info(
    `Token expired, attempting renewal - Request ID: ${requestId}`
   );
   const config_own_rodit = await stateManager.getConfigOwnRodit();
   const unverifiedpayload = decodeJwt(token);
   const { isValid, notAfter } = await thorough_validate_jwt_token_be(
    unverifiedpayload,
    requestId
   );
   if (isValid) {
    const newToken = await generate_jwt_token_fromtoken(
     unverifiedpayload,
     config_own_rodit.own_rodit.metadata.jwtduration,
     notAfter,
     timestamp
    );
    logger.info(
     `New token generated for expired token - Request ID: ${requestId}`
    );
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

 logger.debug(
  `Token renewal check - Time left: ${durationLeftpct}%, Request ID: ${requestId}`
 );

 if (durationLeftpct < 100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE) {
  const randomNumber = generateRandomNumber();
  if (
   randomNumber < tokenrenewaloptions.THRESHOLD_VALIDATION_TYPE ||
   newduration <
    (payload.rodit_maxrqwindow *
     (100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE)) /
     100
  ) {
   logger.info(
    `Performing full verification for token renewal - Request ID: ${requestId}`
   );
   const { isValid, notAfter } = await thorough_validate_jwt_token_be(
    payload,
    requestId
   );
   if (isValid) {
    const newToken = await generate_jwt_token_fromtoken(
     payload,
     newduration,
     notAfter,
     timestamp
    );
    return {
     newToken,
     logInfo: {
      newDuration: newduration,
      reason: "Full verification",
      notAfter: notAfter,
     },
    };
   }
  } else {
   logger.info(
    `Performing light verification for token renewal - Request ID: ${requestId}`
   );
   const { isValid, notAfter } = await brief_validate_jwt_token_be(
    payload,
    requestId
   );
   if (isValid) {
    const newToken = await generate_jwt_token_fromtoken(
     payload,
     newduration,
     notAfter,
     timestamp
    );
    return {
     newToken,
     logInfo: {
      newDuration: newduration,
      reason: "Light verification",
      notAfter: notAfter,
     },
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
    code: "INVALID_TOKEN",
    message: "Invalid token",
    requestId,
   },
  });
 }
 return res.status(403).json({
  error: {
   code: "TOKEN_VERIFICATION_FAILED",
   message: "Token verification failed",
   requestId,
  },
 });
}

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
  const config_own_rodit = stateManager.getConfigOwnRodit();
  if (!config_own_rodit || !config_own_rodit.own_rodit.metadata.webhookurl) {
   logger.error(
    `Error: Webhook URL not available in Rodit configuration - Request ID: ${requestId}`
   );
   return {
    isValid: false,
    error: {
     code: "WEBHOOK_CONFIG_ERROR",
     message: "Webhook URL not available in Rodit configuration",
     requestId,
    },
   };
  }

  const timestamp = Date.now();
  const payload = JSON.stringify({
   event,
   data,
   isError,
   timestamp,
   requestId,
  });
  const sha256_ofpayload = crypto
   .createHash("sha256")
   .update(payload)
   .digest();

  const own_rodit_private_key = new Uint8Array(
   Buffer.from(config_own_rodit.own_rodit_bytes_private_key, "hex")
  );

  const signature_ofpayload = nacl.sign.detached(
   sha256_ofpayload,
   own_rodit_private_key
  );
  const signature_hex_ofpayload =
   Buffer.from(signature_ofpayload).toString("hex");

  const response = await fetch(
   `http://${config_own_rodit.own_rodit.metadata.webhookurl}/webhook`,
   {
    method: "POST",
    headers: {
     "Content-Type": "application/json",
     "X-Signature": signature_hex_ofpayload,
     "X-Timestamp": timestamp.toString(),
     "X-Request-ID": requestId,
    },
    body: payload,
   }
  );

  if (!response.ok) {
   throw new Error(`HTTP error! status: ${response.status}`);
  }

  await response.text(); // consume the response body
  logger.info(
   `Webhook sent successfully - Event: ${event}, Request ID: ${requestId}`
  );

  return {
   isValid: true,
   message: "Webhook sent successfully",
   requestId,
  };
 } catch (error) {
  logger.error(
   `Error in send_webhook: ${error.message} - Request ID: ${requestId}`
  );
  return {
   isValid: false,
   error: {
    code: "WEBHOOK_SEND_ERROR",
    message: `Failed to send webhook: ${error.message}`,
    requestId,
   },
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
function authenticate_webhook(
 payload,
 signature_hex_ofpayload,
 timestamp,
 peer_bytes_public_key
) {
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
     code: "TIMESTAMP_EXPIRED",
     message: "Webhook timestamp is too old",
     requestId,
    },
   };
  }

  const sha256_ofpayload = crypto
   .createHash("sha256")
   .update(payload)
   .digest();
  const buffer_signature_ofpayload = Buffer.from(
   signature_hex_ofpayload,
   "hex"
  );

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
     code: "INVALID_SIGNATURE",
     message: "Invalid webhook signature",
     requestId,
    },
   };
  }

  logger.info(`Webhook authentication successful - Request ID: ${requestId}`);
  return {
   isValid: true,
   message: "Webhook authentication successful",
   requestId,
  };
 } catch (error) {
  logger.error(
   `Unexpected error in webhook authentication: ${error.message} - Request ID: ${requestId}`
  );
  return {
   isValid: false,
   error: {
    code: "AUTHENTICATION_ERROR",
    message: "An unexpected error occurred during webhook authentication",
    details: error.message,
    requestId,
   },
  };
 }
}

module.exports = {
 login_client,
 login_server,
 login_client_withnep413,
 generate_jwt_token,
 authenticate_apicall,
 send_webhook,
 authenticate_webhook,
 nearorg_rpc_state,
 nearorg_rpc_tokensfromaccountid,
 base64url2jwk_public_key,
 debugWithType,
 validateAndSetUrl,
 validateAndSetDate,
 validateAndSetJson,
 validateAndSetSignature,
 ensureDateIsSet,
 base64ToBase64Url,
 canonicalizeObject,
 calculateCanonicalHash,
 CONSTANTS,
 stateManager,
};
