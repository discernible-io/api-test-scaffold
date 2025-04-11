// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

/**
 * Module Dependencies
 */
const bs58 = require("bs58");
const { ulid } = require("ulid");
const config = require("config");
const fs = require("fs").promises;
const logger = require("../../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const borsh = require("borsh");
nacl.util = require("tweetnacl-util");
const { decodeUTF8 } = require("tweetnacl-util");
const { importJWK, jwtVerify, decodeJwt, SignJWT } = require("jose");
const { Resolver } = require("dns").promises;
const {
  initializeProductionVault,
  get_rodit_fromvault,
  setupTokenRenewal,
  vault,
} = require("./vaultsetup-production");

/**
 * Constants and Configuration
 */
const CONSTANTS = {
  SMART_CONTRACT: config.get("APISERVICEOPTIONS.scaccountid"),
  SMART_CONTRACT_REVOKED: "10975-revoked-cableguard-org.testnet",
  BLOCKCHAIN_NETWORK: config.get("NEAR_NETWORK_ID"),
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
 * Singleton State Management Classes
 */
class AuthStateManager {
  constructor() {
    if (AuthStateManager.instance) {
      return AuthStateManager.instance;
    }

    this.sessionBase64urlJwkPublicKey = null;
    this.configOwnRodit = null;
    this.currentToken = null;

    AuthStateManager.instance = this;
  }

  async setSessionBase64urlJwkPublicKey(key) {
    this.sessionBase64urlJwkPublicKey = key;
    return key;
  }

  getSessionBase64urlJwkPublicKey() {
    return this.sessionBase64urlJwkPublicKey;
  }

  async setConfigOwnRodit(config) {
    this.configOwnRodit = config;
    return config;
  }

  getConfigOwnRodit() {
    return this.configOwnRodit;
  }

  async setCurrentToken(token) {
    this.currentToken = token;
    return token;
  }

  getCurrentToken() {
    return this.currentToken;
  }
}

class RoditManager {
  constructor() {
    if (RoditManager.instance) {
      return RoditManager.instance;
    }

    this.stateManager = new AuthStateManager();
    this.vaultInitialized = false;
    this.vaultPath = null;
    this.credentials = {
      portal: null,
      sanctum: null,
      server: null,
      client: null,
    };

    RoditManager.instance = this;
  }

  async initializeVault() {
    if (this.vaultInitialized) {
      return vault;
    }

    try {
      const vaultInstance = await initializeProductionVault();
      await setupTokenRenewal(vaultInstance);
      this.vaultInitialized = true;
      this.vaultPath = config.get("VAULT_RODIT_KEYVALUE_PATH");
      return vaultInstance;
    } catch (error) {
      logger.error(`Error initializing vault: ${error.message}`);
      throw error;
    }
  }

  async getCredentials(type) {
    if (!this.vaultInitialized) {
      await this.initializeVault();
    }

    if (this.credentials[type]) {
      return this.credentials[type];
    }

    try {
      // Make the accountType consistent with the type parameter
      const accountType = `account_${type}`;

      const vaultData = await get_rodit_fromvault(
        vault,
        `${this.vaultPath}/${type}`,
        accountType
      );

      if (!vaultData.private_key || typeof vaultData.private_key !== "string") {
        throw new Error(`Invalid or missing private_key for ${type}`);
      }

      const privateKeyStr = vaultData.private_key.startsWith("ed25519:")
        ? vaultData.private_key.replace("ed25519:", "")
        : vaultData.private_key;

      vaultData.signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
      this.credentials[type] = vaultData;
      return vaultData;
    } catch (error) {
      logger.error(`Error retrieving ${type} credentials: ${error.message}`);
      throw error;
    }
  }

  async initializeRoditConfig(type) {
    const requestId = ulid();
    logger.info(
      `Starting RODiT config initialization for "${type}" - Request ID: ${requestId}`
    );

    try {
      logger.debug(
        `Getting credentials for "${type}" - Request ID: ${requestId}`
      );
      const credentials = await this.getCredentials(type);

      if (!credentials) {
        logger.error(
          `Failed to retrieve credentials for "${type}" - Request ID: ${requestId}`
        );
        throw new Error(`Credentials not available for ${type}`);
      }

      const { account_id, implicit_account_id } = credentials;
      logger.info(
        `Using account_id: ${account_id} for "${type}" - Request ID: ${requestId}`
      );

      logger.debug(
        `Checking account state on blockchain - Request ID: ${requestId}`
      );
      const accountState = await nearorg_rpc_state(
        CONSTANTS.SMART_CONTRACT,
        account_id
      );

      if (!accountState) {
        logger.warn(
          `The NEAR account ${account_id} has no balance in the network - Request ID: ${requestId}`
        );
      } else {
        logger.info(
          `Account ${account_id} state verified on blockchain - Request ID: ${requestId}`
        );
      }

      logger.debug(
        `Fetching RODiT tokens for account ${account_id} - Request ID: ${requestId}`
      );
      const own_rodit = await nearorg_rpc_tokensfromaccountid(
        CONSTANTS.SMART_CONTRACT,
        account_id
      );

      // Check if we have a real RODiT token
      if (!own_rodit || !own_rodit.token_id) {
        logger.warn(
          `No RODiT instances found for account: ${account_id} - Proceeding with partial initialization - Request ID: ${requestId}`
        );

        // Create a minimal configuration for signroot
        const minimalConfig = {
          own_rodit: {
            token_id: "",
            owner_id: account_id,
            metadata: {
              subjectuniqueidentifier_url: "localhost", // Fallback value
              serviceprovider_id: "",
              not_after: "2030-01-01",
              not_before: "2020-01-01",
            },
          },
          own_rodit_bytes_private_key: credentials.signing_bytes_key,
          apiendpoint: "localhost:" + config.get("SERVERPORT"),
          port: config.get("SERVERPORT"),
          iso639: config.get("API_OPTIONS.ISO639"),
          iso3166: config.get("API_OPTIONS.ISO3166"),
          iso15924: config.get("API_OPTIONS.ISO15924"),
          timeoptions: config.get("API_OPTIONS.TIMEOPTIONS"),
        };

        const configCopy = JSON.parse(
          JSON.stringify({
            ...minimalConfig,
            // Exclude sensitive data
            own_rodit_bytes_private_key: "*** REDACTED ***",
          })
        );

        logger.info(
          `Minimal config object for partial initialization: ${JSON.stringify(
            configCopy,
            null,
            2
          )}`
        );

        logger.debug(
          `Storing minimal configuration in state manager - Request ID: ${requestId}`
        );
        await this.stateManager.setConfigOwnRodit(minimalConfig);

        logger.debug(
          `Converting implicit account ID to base64url - Request ID: ${requestId}`
        );
        const session_base64url_jwk_public_key = Buffer.from(
          implicit_account_id,
          "hex"
        ).toString("base64url");

        logger.debug(
          `Setting session base64url JWK public key - Request ID: ${requestId}`
        );
        await this.stateManager.setSessionBase64urlJwkPublicKey(
          session_base64url_jwk_public_key
        );

        logger.info(
          `Partial RODiT configuration for "${type}" completed successfully - Request ID: ${requestId}`
        );
        return minimalConfig;
      }

      logger.info(
        `Successfully retrieved RODiT token: ${own_rodit.token_id} - Request ID: ${requestId}`
      );

      const SERVERPORT = config.get("SERVERPORT");

      if (
        !own_rodit.metadata ||
        !own_rodit.metadata.subjectuniqueidentifier_url
      ) {
        logger.error(
          `Missing subjectuniqueidentifier_url in RODiT metadata - Request ID: ${requestId}`
        );
        throw new Error(
          "Missing required metadata: subjectuniqueidentifier_url"
        );
      }

      const apiendpoint =
        own_rodit.metadata.subjectuniqueidentifier_url + ":" + SERVERPORT;

      logger.debug(
        `Constructed API endpoint: ${apiendpoint} - Request ID: ${requestId}`
      );

      logger.info(
        `Building configuration object for "${type}" - Request ID: ${requestId}`
      );
      const configObject = {
        own_rodit,
        own_rodit_bytes_private_key: credentials.signing_bytes_key,
        apiendpoint,
        port: SERVERPORT,
        iso639: config.get("API_OPTIONS.ISO639"),
        iso3166: config.get("API_OPTIONS.ISO3166"),
        iso15924: config.get("API_OPTIONS.ISO15924"),
        timeoptions: config.get("API_OPTIONS.TIMEOPTIONS"),
      };

      const configCopy = JSON.parse(
        JSON.stringify({
          ...configObject,
          // Exclude sensitive data
          own_rodit_bytes_private_key: "*** REDACTED ***",
        })
      );

      logger.info(`Full config object: ${JSON.stringify(configCopy, null, 2)}`);

      logger.debug(
        `Storing configuration in state manager - Request ID: ${requestId}`
      );
      await this.stateManager.setConfigOwnRodit(configObject);
      logger.info(
        `Configuration stored successfully for "${type}" - Request ID: ${requestId}`
      );

      logger.debug(
        `Converting implicit account ID to base64url - Request ID: ${requestId}`
      );
      const session_base64url_jwk_public_key = Buffer.from(
        implicit_account_id,
        "hex"
      ).toString("base64url");

      logger.debug(
        `Setting session base64url JWK public key - Request ID: ${requestId}`
      );
      await this.stateManager.setSessionBase64urlJwkPublicKey(
        session_base64url_jwk_public_key
      );

      logger.info(
        `RODiT configuration for "${type}" completed successfully - Request ID: ${requestId}`
      );
      return configObject;
    } catch (error) {
      logger.error(
        `Error initializing RODiT config for "${type}": ${error.message} - Request ID: ${requestId}`,
        {
          requestId,
          type,
          stack: error.stack,
          step: error.step || "unknown",
        }
      );
      throw error;
    }
  }
}

const roditManager = new RoditManager();
const stateManager = new AuthStateManager();
const resolver = new Resolver();

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

  logger.debug(`${name}: Type: ${detailedType}, Value: ${valueDisplay}`);
};

function logServerBufferState(stage, data, logger, requestId) {
  logger.debug(`Buffer state at ${stage}:`, {
    requestId,
    type: typeof data,
    isBuffer: Buffer.isBuffer(data) || data instanceof Uint8Array,
    length: data?.length || 0,
    hexRepresentation:
      data instanceof Uint8Array || Buffer.isBuffer(data)
        ? Buffer.from(data).toString("hex").substring(0, 32) + "..."
        : null,
  });
}

const setValue = (obj, field, value) => {
  if (obj && typeof obj === "object") {
    obj[field] = value;
  }
  return value;
};

function generateRandomNumber() {
  return Math.random();
}

async function dateStringToUnixTime(datestring) {
  const date = new Date(datestring);
  const unixTimeMs = date.getTime();
  const unixTimeSec = Math.floor(unixTimeMs / 1000);
  return unixTimeSec;
}

async function unixTimeToDateString(unixTimeSec) {
  const unixTimeMs = unixTimeSec * 1000;
  const date = new Date(unixTimeMs);
  return date.toISOString();
}

/**
 * Data Validation Functions
 */
validateAndSetUrl = (value, field, obj = null) => {
  if (value == null) {
    return null;
  }

  // First remove any existing protocol
  let normalizedUrl = value.replace(/^(https?:\/\/)/, "");

  // Remove whitespace for testing
  const testUrl = normalizedUrl.replace(/\s+/g, "");

  // Updated regex to properly handle ports and domain names
  const urlRegex =
    /^(localhost(:[0-9]{1,5})?|([\da-z][\da-z-]*[\da-z]\.)*[\da-z][\da-z-]*[\da-z]\.[a-z\.]{2,6}(:[0-9]{1,5})?|((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(:[0-9]{1,5})?)(\/[\w\.-]*)*\/?$/i;

  if (urlRegex.test(testUrl)) {
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

function validateSignatureFormat(signature, requestId) {
  const result = {
    isValid: false,
    length: signature.length,
    format: null,
    error: null,
  };

  try {
    const base64urlPattern = /^[A-Za-z0-9_-]+$/;
    result.isValid = base64urlPattern.test(signature);
    result.format = result.isValid ? "valid base64url" : "invalid format";
    return result;
  } catch (error) {
    result.error = error.message;
    logger.error("Signature validation error:", {
      requestId,
      error: error.message,
    });
    return result;
  }
}

function validatePublicKeyFormat(publicKey, requestId) {
  const result = {
    isValid: false,
    length: publicKey.length,
    format: null,
    error: null,
  };

  try {
    const hexPattern = /^[0-9a-f]+$/i;
    result.isValid = hexPattern.test(publicKey);
    result.format = result.isValid ? "valid hex" : "invalid format";
    return result;
  } catch (error) {
    result.error = error.message;
    logger.error("Public key validation error:", {
      requestId,
      error: error.message,
    });
    return result;
  }
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
 * NEAR Blockchain Functions
 */
async function nearorg_rpc_fetchpublickeybytes(accountId) {
  try {
    const isImplicitAccount = /^[0-9a-f]{64}$/.test(accountId);

    if (isImplicitAccount) {
      return new Uint8Array(Buffer.from(accountId, "hex"));
    }

    const rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      accountId
    );

    if (!rodit || !rodit.owner_id) {
      throw new Error(`No valid RODiT found for account: ${accountId}`);
    }

    return new Uint8Array(Buffer.from(rodit.owner_id, "hex"));
  } catch (error) {
    logger.error(`Error processing account ${accountId}: ${error.message}`);
    throw new Error(`Error retrieving public key: ${error.message}`);
  }
}

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
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const parsedJson = await response.json();

    if (parsedJson.error) {
      throw new Error(`Error 017: ${parsedJson.error.message}`);
    }

    const timestamp = parsedJson.result?.header?.timestamp;

    return timestamp ? timestamp.toString() : "0";
  } catch (error) {
    logger.error(`Error in nearorgRpcTimestamp: ${error.message}`);
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

    if (!response.ok) {
      logger.error(`HTTP error from RPC endpoint: ${response.status}`);
      return new RODiT();
    }

    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);

    if (parsedJson.result && parsedJson.result.error) {
      logger.error(`WASM execution error: ${parsedJson.result.error}`);
      return new RODiT();
    }

    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      logger.error(
        `Invalid result format - expected array, got: ${typeof resultArray}`
      );
      return new RODiT();
    }

    const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
    const parsed = JSON.parse(resultString);

    const rodit = new RODiT();
    Object.assign(rodit, parsed);
    return rodit;
  } catch (error) {
    logger.error(`Failed to fetch RODiT token: ${error.message}`);
    return new RODiT();
  }
}

async function nearorg_rpc_state(id, accountId) {
  try {
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

    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.json();

    if (JSON.stringify(responseText).includes("does not exist while viewing")) {
      logger.warn(
        `Account ${accountId} does not exist in blockchain - needs minimum 0.01 NEAR funding`
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Failed to check account state: ${error.message}`);
    throw error;
  }
}

async function nearorg_rpc_tokensfromaccountid(id, account_id) {
  try {
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

    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);

    if (parsedJson.result && parsedJson.result.error) {
      logger.error(`WASM execution error: ${parsedJson.result.error}`);
      throw new Error(
        `Smart contract execution failed: ${parsedJson.result.error}`
      );
    }

    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      logger.error(
        `Invalid result format - expected array, got: ${typeof resultArray}`
      );
      throw new Error("Result is not an array");
    }

    const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
    const resultStruct = JSON.parse(resultString);

    if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
      logger.warn(`No RODiT instances found for account: ${account_id}`);
      const emptyRodit = new RODiT();
      return emptyRodit;
    }

    const rodit = new RODiT();
    Object.assign(rodit, resultStruct[0]);
    return rodit;
  } catch (error) {
    logger.error(`Failed to fetch RODiT tokens: ${error.message}`);
    throw error;
  }
}

/**
 * Login and Authentication Functions
 */
async function login_server(own_rodit) {
  console.log("Starting login_server with own_rodit:", own_rodit);
  try {
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    console.log("Retrieved config_own_rodit:", config_own_rodit);

    if (!config_own_rodit) {
      logger.error("Error 0111: Client configuration not initialized");
      return;
    }

    const apiendpoint = config_own_rodit.apiendpoint;
    console.log("Using apiendpoint:", apiendpoint);

    let roditid = own_rodit.token_id;
    console.log("Using roditid:", roditid);

    const timestamp = Math.floor(Date.now() / 1000);
    console.log("Generated timestamp:", timestamp);

    const timeString = await unixTimeToDateString(timestamp);
    console.log("Converted timestamp to date string:", timeString);

    const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);
    console.log(
      "Created roditidandtimestamp buffer with length:",
      roditidandtimestamp.length
    );

    console.log(
      "Using private key for signing:",
      config_own_rodit.own_rodit_bytes_private_key
        ? "Private key exists"
        : "Private key is undefined"
    );

    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      config_own_rodit.own_rodit_bytes_private_key
    );
    console.log(
      "Generated signature with length:",
      own_rodit_bytes_signature.length
    );

    const roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");
    console.log(
      "Converted signature to base64url:",
      roditid_base64url_signature
    );

    console.log("Sending login request to:", apiendpoint + "/login");
    console.log(
      "Request body:",
      JSON.stringify({
        roditid,
        timestamp,
        roditid_base64url_signature,
      })
    );

    const response = await fetch(apiendpoint + "/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roditid, timestamp, roditid_base64url_signature }),
    });
    console.log("Login response status:", response.status);

    if (!response.ok) {
      throw new Error("Error 040: Login failed");
    }

    const data = await response.json();
    console.log(
      "Received response data:",
      data ? "Data exists" : "Data is undefined"
    );

    let jwt_token = data.token;
    console.log(
      "Extracted JWT token:",
      jwt_token ? "Token exists" : "Token is undefined"
    );

    // Validate the server
    let peer_bytes_ed25519_public_key;
    try {
      console.log("Starting JWT token validation...");
      // There seems to be a syntax error in the destructuring here
      // The original code had { *, peer*rodit } which is invalid
      // Let's fix and log it properly
      const validationResult = await validate_jwt_token_be(
        jwt_token,
        own_rodit
      );
      console.log("JWT validation result:", validationResult);

      // Assuming the correct property name is peer_rodit
      const peer_rodit = validationResult.peer_rodit;
      console.log("Extracted peer_rodit:", peer_rodit);

      peer_bytes_ed25519_public_key = new Uint8Array(
        Buffer.from(peer_rodit.owner_id, "hex")
      );
      console.log(
        "Created peer_bytes_ed25519_public_key with length:",
        peer_bytes_ed25519_public_key.length
      );
    } catch (validationError) {
      console.error("JWT validation error details:", validationError);
      throw new Error(
        `Error 039: Server validation failed: ${validationError.message}`
      );
    }

    logger.info("Client of API endpoint is logged in");
    return { jwt_token, apiendpoint };
  } catch (error) {
    console.error("Full error object:", error);
    console.error("Error stack trace:", error.stack);
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
    logger.info("Client RODiT ID:", peer_roditid);

    if (!peer_roditid || !peer_timestamp || !roditid_base64url_signature) {
      return res.status(400).json({
        message: "Error 100: Missing RODiT ID, Signature or Timestamp",
      });
    }

    try {
      const config_own_rodit = await stateManager.getConfigOwnRodit();

      if (!config_own_rodit) {
        throw new Error("Error 0112: Server configuration not initialized");
      }

      const { peer_rodit: peer_rodit, goodrodit: isRoditValid } =
        await verify_peerrodit_getrodit(
          peer_roditid,
          peer_timestamp,
          roditid_base64url_signature,
          config_own_rodit.own_rodit
        );

      if (!isRoditValid) {
        logger.error("Login attempt failed: Invalid RODiT ID or Signature");
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
      logger.error(`Login attempt failed: ${error.message}`);
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

async function login_client_withnep413(req, res, config_own_rodit = null) {
  try {
    const { signature, message, nonce, recipient, callbackUrl } = req.body;
    logger.debug(
      `Processing NEP-413 login request - Message: ${message}, Recipient: ${recipient}`
    );

    if (!config_own_rodit) {
      logger.error(
        `Error 0113: Server configuration not initialized for NEP-413 login`
      );
      throw new Error("Error 0114: Server configuration not initialized");
    }

    logger.debug(`Verifying NEP-413 RODiT credentials`);
    const { peer_rodit: peer_rodit, goodrodit: isRoditValid } =
      await verify_peerrodit_getrodit_withnep413(
        message,
        nonce,
        recipient,
        callbackUrl,
        signature,
        config_own_rodit
      );

    if (!isRoditValid) {
      logger.error(`NEP-413 login failed - Invalid RODiT ID or Signature`);
      return res.status(401).json({
        message:
          "Error 106: Login attempt failed: Invalid RODiT ID or Signature",
      });
    }

    logger.debug(`Generating JWT token for validated NEP-413 login`);
    const token = await generate_jwt_token(
      peer_rodit,
      Math.floor(Date.now() / 1000),
      config_own_rodit.own_rodit,
      config_own_rodit.own_rodit_bytes_private_key
    );

    logger.info(`NEP-413 login successful`);
    return res.json({ token });
  } catch (error) {
    logger.error(`NEP-413 login failed with error: ${error.message}`);
    return res.status(500).json({
      message: `Error 175c: Login attempt failed: ${error.message}`,
    });
  }
}

async function login_portal(own_rodit, port) {
  const requestId = ulid();
  console.log(
    `Starting login_portal with own_rodit - Request ID: ${requestId}`,
    own_rodit
  );

  try {
    // Get configuration from state manager
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    console.log(
      `Retrieved config_own_rodit - Request ID: ${requestId}`,
      config_own_rodit
    );

    if (!config_own_rodit) {
      console.error(
        `Error 0111: Client configuration not initialized - Request ID: ${requestId}`
      );
      return { error: "Client configuration not initialized" };
    }

    // Check if the RODiT has the required metadata
    if (!own_rodit.metadata || !own_rodit.metadata.serviceprovider_id) {
      console.error(
        `Error: Missing serviceprovider_id in RODiT - Request ID: ${requestId}`
      );
      return { error: "Missing serviceprovider_id in RODiT" };
    }

    // Parse the serviceprovider_id to build API URL
    const serviceProviderId = own_rodit.metadata.serviceprovider_id;
    console.log(
      `Using serviceProviderId: ${serviceProviderId} - Request ID: ${requestId}`
    );

    // Extract smart contract component from serviceprovider_id
    const components = serviceProviderId.split(";");
    const scComponent = components
      .find((c) => c.startsWith("sc="))
      ?.substring(3);

    if (!scComponent) {
      console.error(
        `Error: Invalid serviceprovider_id format - Request ID: ${requestId}`
      );
      return { error: "Invalid serviceprovider_id format" };
    }

    // Extract domain and TLD from the smart contract name
    // Format expected: 10975-cableguard-org.testnet
    const scParts = scComponent.split(".");

    if (scParts.length < 1) {
      console.error(
        `Error: Invalid smart contract format - Request ID: ${requestId}`
      );
      return { error: "Invalid smart contract format" };
    }

    // Get the first part, which contains the domain information
    const domainPart = scParts[0];

    // Split by dash to get the domain components
    const domainComponents = domainPart.split("-");

    // Find the domain and TLD in the domain components
    // Expected format: 10975-cableguard-org
    let domain = null;
    let tld = null;

    // Skip the first component (numeric ID) and process the rest
    if (domainComponents.length >= 3) {
      domain = domainComponents[1]; // cableguard
      tld = domainComponents[2]; // org
    } else {
      console.error(
        `Error: Invalid domain format in smart contract - Request ID: ${requestId}`
      );
      return { error: "Invalid domain format in smart contract" };
    }

    // Build the API endpoint using the domain and TLD
    const apiendpoint = `https://signportal.${domain}.${tld}:${port}`;
    console.log(
      `Constructed portal apiendpoint: ${apiendpoint} - Request ID: ${requestId}`
    );

    // Rest of function continues as before
    let roditid = own_rodit.token_id;
    console.log(`Using RODiT ID: ${roditid} - Request ID: ${requestId}`);

    const timestamp = Math.floor(Date.now() / 1000);
    console.log(`Generated timestamp: ${timestamp} - Request ID: ${requestId}`);

    const timeString = await unixTimeToDateString(timestamp);
    console.log(
      `Converted timestamp to date string: ${timeString} - Request ID: ${requestId}`
    );

    const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);
    console.log(
      `Created roditidandtimestamp buffer with length: ${roditidandtimestamp.length} - Request ID: ${requestId}`
    );

    console.log(
      `Using private key for signing - Request ID: ${requestId}:`,
      config_own_rodit.own_rodit_bytes_private_key
        ? "Private key exists"
        : "Private key is undefined"
    );

    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      config_own_rodit.own_rodit_bytes_private_key
    );
    console.log(
      `Generated signature with length: ${own_rodit_bytes_signature.length} - Request ID: ${requestId}`
    );

    const roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");
    console.log(
      `Converted signature to base64url - Request ID: ${requestId}:`,
      roditid_base64url_signature
    );

    console.log(
      `Sending login request to: ${apiendpoint}/login - Request ID: ${requestId}`
    );
    console.log(
      `Request body - Request ID: ${requestId}:`,
      JSON.stringify({
        roditid,
        timestamp,
        roditid_base64url_signature,
      })
    );

    const response = await fetch(`${apiendpoint}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        roditid,
        timestamp,
        roditid_base64url_signature,
      }),
    });

    console.log(
      `Login response status: ${response.status} - Request ID: ${requestId}`
    );

    if (!response.ok) {
      throw new Error(
        `Error 040: Portal login failed with status ${response.status}`
      );
    }

    const data = await response.json();
    console.log(
      `Received response data - Request ID: ${requestId}:`,
      data ? "Data exists" : "Data is undefined"
    );

    let jwt_token = data.token;
    console.log(
      `Extracted JWT token - Request ID: ${requestId}:`,
      jwt_token ? "Token exists" : "Token is undefined"
    );

    let peer_bytes_ed25519_public_key;
    try {
      console.log(`Starting JWT token validation - Request ID: ${requestId}`);
      const validationResult = await validate_jwt_token_be(
        jwt_token,
        own_rodit
      );
      console.log(
        `JWT validation result - Request ID: ${requestId}:`,
        validationResult
      );

      const peer_rodit = validationResult.peer_rodit;
      console.log(
        `Extracted peer_rodit - Request ID: ${requestId}:`,
        peer_rodit
      );

      peer_bytes_ed25519_public_key = new Uint8Array(
        Buffer.from(peer_rodit.owner_id, "hex")
      );
      console.log(
        `Created peer_bytes_ed25519_public_key with length: ${peer_bytes_ed25519_public_key.length} - Request ID: ${requestId}`
      );
    } catch (validationError) {
      console.error(
        `JWT validation error details - Request ID: ${requestId}:`,
        validationError
      );
      throw new Error(
        `Error 039: Portal server validation failed: ${validationError.message}`
      );
    }

    console.log(`Portal login successful - Request ID: ${requestId}`);
    return {
      jwt_token,
      apiendpoint,
      requestId,
    };
  } catch (error) {
    console.error(`Full error object - Request ID: ${requestId}:`, error);
    console.error(`Error stack trace - Request ID: ${requestId}:`, error.stack);
    console.error(
      `Error in login_portal - Request ID: ${requestId}: ${error.message}`
    );
    return {
      error: `Failed to login to portal: ${error.message}`,
      requestId,
    };
  }
}
/**
 * Token Validation Functions
 */
async function validate_jwt_token_be(token, own_rodit) {
  try {
    const unverifiedpayload = decodeJwt(token);

    const sp_rodit = await nearorg_rpc_tokenfromroditid(
      unverifiedpayload.rodit_id
    );

    const publicKeyBytes = await nearorg_rpc_fetchpublickeybytes(
      sp_rodit.owner_id
    );
    const serviceprovider_base64_public_key =
      Buffer.from(publicKeyBytes).toString("base64url");

    const sp_public_key = await base64url2jwk_public_key(
      serviceprovider_base64_public_key
    );
    const { payload, _ } = await jwtVerify(token, sp_public_key, {
      algorithms: ["EdDSA"],
    });

    stateManager.setSessionBase64urlJwkPublicKey(
      serviceprovider_base64_public_key
    );

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

    const [ownershipVerified, isaMatch, isLive, isActive, isTrusted] =
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

    if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
      throw new Error("Error 037: Peer RODiT verification failed");
    }

    logger.info("Peer Account ID:", peer_rodit.owner_id);
    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    logger.error(`Error in verify_peerrodit_getrodit: ${error.message}`);
    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error in verify_peerrodit_getrodit: ${error.message}`,
    };
  }
}

async function verify_peerrodit_getrodit_withnep413(
  message,
  nonce,
  recipient,
  callbackUrl,
  signature,
  config_own_rodit
) {
  try {
    let peer_rodit = await nearorg_rpc_tokenfromroditid(message);

    // Correctly access serviceprovider_id
    const serviceprovider_id =
      config_own_rodit &&
      config_own_rodit.own_rodit &&
      config_own_rodit.own_rodit.metadata
        ? config_own_rodit.own_rodit.metadata.serviceprovider_id
        : null;

    if (!serviceprovider_id) {
      logger.error("Missing serviceprovider_id in configuration");
      throw new Error("Missing serviceprovider_id in configuration");
    }

    // Execute verification steps
    const verification_results = await Promise.all([
      verify_rodit_ownership_withnep413(
        message,
        nonce,
        recipient,
        callbackUrl,
        signature,
        peer_rodit
      ),
      verify_rodit_isamatch(serviceprovider_id, peer_rodit),
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

    const [ownershipVerified, isaMatch, isLive, isActive, isTrusted] =
      verification_results;

    logger.debug("RODiT Verification Results:", {
      ownershipVerified,
      isaMatch,
      isLive,
      isActive,
      isTrusted,
    });

    if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
      throw new Error("Error 037: Peer RODiT verification failed");
    }

    logger.info("Peer Account ID:", peer_rodit.owner_id);

    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    logger.error(
      `Error in verify_peerrodit_getrodit_withnep413: ${error.message}`
    );

    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error in verify_peerrodit_getrodit_withnep413: ${error.message}`,
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
    logger.debug("Starting NEP-413 signature verification");

    // Ensure nonce is correctly formatted
    let nonceArray;
    if (typeof nonce === "string") {
      // Handle base64url encoded nonce
      nonceArray = new Uint8Array(Buffer.from(nonce, "base64url"));
    } else if (Array.isArray(nonce)) {
      nonceArray = new Uint8Array(nonce);
    } else if (typeof nonce === "object" && nonce !== null) {
      nonceArray = new Uint8Array(Object.values(nonce));
    } else {
      throw new Error(`Invalid nonce format: ${typeof nonce}`);
    }

    if (nonceArray.length !== 32) {
      logger.error(`Invalid nonce length: ${nonceArray.length}`);
      throw new Error(
        `Invalid nonce length: ${nonceArray.length}, expected 32`
      );
    }

    const payload = new PayloadNEP413({
      tag: 2147484061,
      message,
      nonce: nonceArray,
      recipient,
      callbackUrl,
    });

    const serializedPayload = borsh.serialize(PayloadNEP413Schema, payload);
    const payloadHash = crypto
      .createHash("sha256")
      .update(serializedPayload)
      .digest();

    // Convert base64url signature to standard base64
    const standardBase64 = signature
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(signature.length + ((4 - (signature.length % 4)) % 4), "=");
    const signatureBytes = nacl.util.decodeBase64(standardBase64);

    // Get public key bytes
    const publicKeyBytes = await nearorg_rpc_fetchpublickeybytes(
      peer_rodit.owner_id
    );

    // Perform verification
    const isaMatch = nacl.sign.detached.verify(
      payloadHash,
      signatureBytes,
      publicKeyBytes
    );

    if (isaMatch) {
      logger.info("Peer RODiT possession check passed");
      return true;
    } else {
      logger.error("Peer RODiT possession check failed");
      throw new Error("PeerEd25519SignatureVerificationFailure");
    }
  } catch (error) {
    logger.error(
      `Error in verify_rodit_ownership_withnep413: ${error.message}`
    );
    throw error;
  }
}

async function verify_rodit_ownership(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature,
  peer_rodit
) {
  try {
    // DO NOT DELETE THE FOLLOWING COMMENT
    /* Maybe for NEP413 compatibility, the following line added "NEAR" before peerroditid */
    const roditidandtimestamp = new TextEncoder().encode(
      peerroditid + (await unixTimeToDateString(peertimestamp))
    );

    const bytes_ed25519_signature = new Uint8Array(
      Buffer.from(peerroditid_base64url_signature, "base64url")
    );

    const peer_bytes_ed25519_public_key = await nearorg_rpc_fetchpublickeybytes(
      peer_rodit.owner_id
    );

    const isaMatch = nacl.sign.detached.verify(
      roditidandtimestamp,
      bytes_ed25519_signature,
      peer_bytes_ed25519_public_key
    );

    if (isaMatch) {
      logger.info("Peer RODiT possession check passed");
      return true;
    } else {
      logger.error("Peer RODiT possession check failed");
      throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
    }
  } catch (error) {
    logger.error(`Error in verify_rodit_ownership: ${error.message}`);
    throw new Error("Error A33:");
  }
}

async function verify_rodit_isamatch(own_service_provider_id, peer_rodit) {
  try {
    logger.debug("Starting RODiT match verification", {
      own_service_provider_id,
      peer_rodit_id: peer_rodit.token_id,
    });

    const own_provider_components = own_service_provider_id.split(";");
    logger.debug("Split provider components", {
      own_provider_components,
      count: own_provider_components.length,
    });

    // Get blockchain and contract parts
    const bcPart = own_provider_components.find((part) =>
      part.startsWith("bc=")
    );
    const scPart = own_provider_components.find((part) =>
      part.startsWith("sc=")
    );

    // Find all ID components
    const idComponents = own_provider_components.filter(
      (part) =>
        part.startsWith("id=") &&
        !part.startsWith("bc=") &&
        !part.startsWith("sc=")
    );

    if (!bcPart || !scPart || idComponents.length < 1) {
      logger.error("Invalid provider ID format", {
        providerId: own_service_provider_id,
        components: own_provider_components,
      });
      return false;
    }

    // Construct the base prefix
    const base_prefix = `${bcPart};${scPart}`;

    // Try verification with each ID component
    for (let i = 0; i < idComponents.length; i++) {
      const signing_token_id = `${base_prefix};${idComponents[i]}`;
      logger.debug(
        `Trying verification with ID [${i + 1}/${idComponents.length}]`,
        { signing_token_id }
      );

      const signing_rodit = await nearorg_rpc_tokenfromroditid(
        signing_token_id
      );
      logger.debug("Retrieved signing RODiT", {
        token_id: signing_rodit?.token_id,
        owner_id: signing_rodit?.owner_id,
      });

      // Rest of the verification process with this signing_rodit
      try {
        // Process the owner ID
        const bytes_signing_owner_id = new Uint8Array(
          Buffer.from(signing_rodit.owner_id, "hex")
        );

        if (bytes_signing_owner_id.length !== CONSTANTS.RODIT_ID_PK_SZ) {
          logger.warn(`Invalid signing key length for ID ${i + 1}`, {
            actual: bytes_signing_owner_id.length,
            expected: CONSTANTS.RODIT_ID_PK_SZ,
          });
          continue; // Try the next ID
        }

        // Process the signature
        const base64urlSignature =
          peer_rodit.metadata.serviceprovider_signature;
        const base64Signature = base64urlSignature
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(
            base64urlSignature.length +
              ((4 - (base64urlSignature.length % 4)) % 4),
            "="
          );

        const bytes_signature = new Uint8Array(
          Buffer.from(base64Signature, "base64")
        );

        if (bytes_signature.length !== CONSTANTS.RODIT_ID_SIGNATURE_SZ) {
          logger.warn(`Invalid signature length for ID ${i + 1}`);
          continue; // Try the next ID
        }

        // Prepare the hash input
        const hashInput = {
          token_id: peer_rodit.token_id,
          openapijson_url: peer_rodit.metadata.openapijson_url,
          not_after: peer_rodit.metadata.not_after,
          not_before: peer_rodit.metadata.not_before,
          max_requests: peer_rodit.metadata.max_requests,
          maxrq_window: peer_rodit.metadata.maxrq_window,
          allowed_cidr: peer_rodit.metadata.allowed_cidr,
          allowed_iso3166list: peer_rodit.metadata.allowed_iso3166list,
          jwt_duration: peer_rodit.metadata.jwt_duration,
          permissioned_routes: peer_rodit.metadata.permissioned_routes,
          serviceprovider_id: peer_rodit.metadata.serviceprovider_id,
          subjectuniqueidentifier_url:
            peer_rodit.metadata.subjectuniqueidentifier_url,
        };

        const hashHex = calculateCanonicalHash(hashInput);
        const hashBytes = new Uint8Array(Buffer.from(hashHex, "hex"));

        // Verify the signature
        const is_valid = nacl.sign.detached.verify(
          hashBytes,
          bytes_signature,
          bytes_signing_owner_id
        );

        if (is_valid) {
          // Log based on which ID worked
          if (i === 0) {
            logger.info("Partner login verified successfully");
          } else {
            logger.info("Peer login verified successfully");
          }
          return true;
        }

        logger.debug(`Verification with ID ${i + 1} failed`);
      } catch (verifyError) {
        logger.warn(`Error during verification with ID ${i + 1}`, {
          error: verifyError.message,
        });
      }
    }

    // If we get here, all verification attempts failed
    logger.error("All verification attempts failed");
    return false;
  } catch (error) {
    logger.error("Verification failed:", {
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

async function verify_rodit_isactive(tokenId, ownsubjectuniqueidentifier_url) {
  const domainandextensionRegex =
    /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

  logger.debug(`Checking RODiT activity status for token: ${tokenId}`);

  const match = ownsubjectuniqueidentifier_url.match(domainandextensionRegex);

  if (match) {
    const domainandextension = match[1];
    const revokingDnsEntry = `${tokenId}.revoked.${domainandextension}`;

    try {
      await resolver.resolveTxt(revokingDnsEntry);
      logger.info(`RODiT ${tokenId} is revoked by ${domainandextension}`);
      return false;
    } catch (error) {
      logger.debug(`No revocation found for RODiT ${tokenId}`);
      return true;
    }
  } else {
    logger.warn(
      `Unable to parse domain from URL: ${ownsubjectuniqueidentifier_url}`
    );
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

    logger.debug(
      `Verifying smart contract trust for URL: ${ownsubjectuniqueidentifier_url}`
    );

    const domainRegex =
      /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

    const maindomainmatch = domainRegex.exec(ownsubjectuniqueidentifier_url);

    if (!maindomainmatch) {
      logger.error(
        `Failed to parse domain from URL: ${ownsubjectuniqueidentifier_url}`
      );
      throw new Error(
        `Domain can't be parsed from URL: ${ownsubjectuniqueidentifier_url}`
      );
    }

    const extractedDomain = maindomainmatch[1];
    const enablingdnsentry = `${smartontractnonear}.smartcontract.${extractedDomain}`;

    try {
      const cfgresponse = await resolver.resolveTxt(enablingdnsentry);
      if (cfgresponse.length > 0) {
        logger.info(
          `Smart contract ${smartcontracturl} is trusted by ${extractedDomain}`
        );
        return true;
      } else {
        logger.warn(
          `Smart contract ${smartcontracturl} not trusted - empty DNS record from ${extractedDomain}`
        );
        return false;
      }
    } catch (error) {
      logger.warn(
        `Smart contract ${smartcontracturl} not trusted - DNS lookup failed for ${extractedDomain}`
      );
      return false;
    }
  } catch (error) {
    logger.error(`Trust verification failed: ${error.message}`);
    return false;
  }
}

async function verify_rodit_islive(peer_rodit_notafter, peer_rodit_notbefore) {
  function parseDate(datestring) {
    const date = new Date(datestring);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  logger.debug(
    `Checking RODiT validity with not_after: ${peer_rodit_notafter}, not_before: ${peer_rodit_notbefore}`
  );

  const datetimenul = new Date(0);
  const datetimenotafter = parseDate(peer_rodit_notafter);
  const datetimenotbefore = parseDate(peer_rodit_notbefore);

  try {
    const stringtimenow = await nearorg_rpc_timestamp();
    const timestamp = parseInt(stringtimenow, 10);

    if (isNaN(timestamp)) {
      logger.error(`Failed to parse blockchain timestamp: ${stringtimenow}`);
      return false;
    }

    const datetimetimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds
    logger.debug(`Current blockchain time: ${datetimetimestamp.toISOString()}`);

    if (
      (datetimetimestamp <= datetimenotafter ||
        datetimenotafter.getTime() === datetimenul.getTime()) &&
      (datetimetimestamp >= datetimenotbefore ||
        datetimenotbefore.getTime() === datetimenul.getTime())
    ) {
      logger.debug(`RODiT is within valid time period`);
      return true;
    } else {
      logger.warn(`RODiT is not live - outside valid time period`);
      return false;
    }
  } catch (error) {
    logger.error(`Failed to check RODiT time validity: ${error.message}`);
    return false;
  }
}

/**
 * JWT Token Management
 */
async function generate_jwt_token(
  peer_rodit,
  peer_timestamp,
  own_rodit,
  own_rodit_bytes_private_key
) {
  try {
    logger.debug(`Generating JWT token for peer RODiT: ${peer_rodit.token_id}`);

    const now = peer_timestamp;
    const notafter = await dateStringToUnixTime(peer_rodit.metadata.not_after);
    const duration = parseInt(peer_rodit.metadata.jwt_duration, 10);
    let expiresat = now;

    if (now + duration < notafter) {
      expiresat = parseInt(now) + parseInt(peer_rodit.metadata.jwt_duration);
      logger.debug(`Token will expire at: ${expiresat}`);
    } else {
      logger.error(
        `RODiT duration check failed - Now: ${now}, Duration: ${duration}, NotAfter: ${notafter}`
      );
      throw new Error("RODiT duration check failed");
    }

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

    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });

    logger.debug(`Preparing to sign JWT token with EdDSA algorithm`);

    const token = await new SignJWT({
      iss: peer_rodit.metadata.subjectuniqueidentifier_url,
      sub:
        peer_rodit.metadata.serviceprovider_id + ";sub=" + peer_rodit.token_id,
      aud: peer_rodit.owner_id,
      exp: expiresat,
      nbf: notbefore,
      iat: peer_timestamp,
      jti: "jti" + ulid(),
      rodit_id: own_rodit.token_id,
      rodit_owner: own_rodit.owner_id,
      rodit_idsignature: own_roditid_base64url_signature,
      rodit_maxrequests: peer_rodit.metadata.max_requests,
      rodit_maxrqwindow: peer_rodit.metadata.maxrq_window,
      rodit_permissionedroutes: peer_rodit.metadata.permissioned_routes,
      rodit_webhookcidr: peer_rodit.metadata.webhook_cidr,
      rodit_allowedcidr: peer_rodit.metadata.allowed_cidr,
      rodit_allowediso3166list: peer_rodit.metadata.allowed_iso3166list,
      rodit_webhookurl: peer_rodit.metadata.webhook_url,
      config_iso639: null,
      config_iso3166: null,
      config_iso15924: null,
      config_timeoptions: null,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(own_rodit_keyobject_private_key);

    logger.debug(`Successfully generated JWT token`);
    return token;
  } catch (error) {
    logger.error(`Failed to generate JWT token: ${error.message}`);
    throw error;
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

    return {
      isValid,
      notAfter: peer_rodit.metadata.not_after,
    };
  } catch (error) {
    logger.error(`Brief token validation failed: ${error.message}`);
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

    const [isaMatch, isLive, isActive, isTrusted] = await Promise.all([
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

    if (!isaMatch || !isLive || !isActive || !isTrusted) {
      logger.warn(`Comprehensive RODiT verification failed`);
      return {
        isValid: false,
        notAfter: peer_rodit.metadata.not_after,
      };
    }

    const subParts = token.sub.split(";sub=");
    const extractedSub = subParts.length > 1 ? subParts[1] : "";

    const isValid =
      peer_rodit.token_id === extractedSub && peer_rodit.owner_id === token.aud;

    return {
      isValid,
      notAfter: peer_rodit.metadata.not_after,
    };
  } catch (error) {
    logger.error(`Thorough token validation failed: ${error.message}`);
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
    logger.debug(`Starting token renewal process for token: ${token.jti}`);

    const now = Math.floor(Date.now() / 1000);
    const tokenexpiration = duration + now;
    const notafterunixtime = await dateStringToUnixTime(notafter);

    if (tokenexpiration <= notafterunixtime) {
      logger.debug(
        `Token expiration time valid - will expire at: ${tokenexpiration}`
      );
    } else {
      logger.warn(
        `Token renewal failed - RODiT expired at: ${notafterunixtime}`
      );
      throw new Error("RODiT has expired");
    }

    const config_own_rodit = await stateManager.getConfigOwnRodit();

    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        config_own_rodit.own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });

    logger.debug(`Preparing to sign new JWT token with EdDSA algorithm`);

    const newtoken = await new SignJWT({
      iss: token.iss,
      sub: token.sub,
      aud: token.aud,
      exp: tokenexpiration,
      nbf: token.nbf,
      iat: now,
      jti: "jti" + ulid(),
      rodit_id: token.rodit_id,
      rodit_owner: token.rodit_owner,
      rodit_allowediso3166list: token.rodit_allowediso3166list,
      rodit_idsignature: token.rodit_idsignature,
      rodit_maxrequests: token.rodit_maxrequests,
      rodit_maxrqwindow: token.rodit_maxrqwindow,
      rodit_permissionedroutes: token.rodit_permissionedroutes,
      rodit_webhookcidr: token.rodit_webhookcidr,
      rodit_allowedcidr: token.rodit_allowedcidr,
      rodit_allowediso3166list: token.rodit_allowediso3166list,
      rodit_webhookurl: token.rodit_webhookurl,
      config_iso639: null,
      config_iso3166: null,
      config_iso15924: null,
      config_timeoptions: null,
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(own_rodit_keyobject_private_key);

    logger.debug(
      `Successfully generated new JWT token with expiration: ${tokenexpiration}`
    );
    return newtoken;
  } catch (error) {
    logger.error(`Failed to generate new JWT token: ${error.message}`);
    throw error;
  }
}

/**
 * API Authentication Middleware
 */
async function authenticate_apicall(req, res, next) {
  const requestId = ulid();
  logger.debug(`Starting API call authentication - Request ID: ${requestId}`);

  try {
    const token = extractTokenFromHeader(req.headers["authorization"]);
    if (token == null) {
      logger.warn(`No authorization token provided - Request ID: ${requestId}`);
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
        const renewalResult = await checkAndRenewToken(
          payload,
          req.headers["x-timestamp"],
          requestId
        );
        if (renewalResult.newToken) {
          res.setHeader("New-Token", renewalResult.newToken);
          logger.info(`Token proactively renewed - Request ID: ${requestId}`);
        }
      }

      if (tokenrenewaloptions.SERVERORCLIENT === "CLIENT-INITIATED") {
        res.setHeader("Token-Expiration", payload.exp);
        logger.debug(
          `Set token expiration header for client-initiated renewal - Request ID: ${requestId}`
        );
      }

      req.user = payload;
      logger.debug(`Authentication successful - Request ID: ${requestId}`);
      next();
    } catch (error) {
      logger.error(
        `Token verification failed - Request ID: ${requestId} - Error: ${error.message}`
      );
      try {
        handleTokenError(error, res, requestId);
      } catch (handlerError) {
        logger.error(
          `Error handler failed - Request ID: ${requestId} - Error: ${handlerError.message}`
        );
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Internal server error",
            requestId,
          },
        });
      }
      return;
    }
  } catch (error) {
    logger.error(
      `Unexpected authentication error - Request ID: ${requestId} - Error: ${error.message}`
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
    const token = parts.length > 1 ? parts[1] : null;
    return token;
  }
  return null;
}

async function verifyToken(token, jwk_public_key, timestamp, requestId) {
  try {
    logger.debug(`Verifying token - Request ID: ${requestId}`);

    const result = await jwtVerify(token, jwk_public_key, {
      algorithms: ["EdDSA"],
    });
    logger.debug(`Token verified successfully - Request ID: ${requestId}`);
    return result;
  } catch (jwtError) {
    if (jwtError.code === "ERR_JWT_EXPIRED") {
      logger.warn(
        `Token expired, attempting renewal - Request ID: ${requestId}`
      );

      const config_own_rodit = await stateManager.getConfigOwnRodit();
      const unverifiedpayload = decodeJwt(token);

      logger.debug(
        `Validating expired token for renewal - Request ID: ${requestId}`
      );
      const { isValid, notAfter } = await thorough_validate_jwt_token_be(
        unverifiedpayload,
        requestId
      );

      if (isValid) {
        logger.info(
          `Generating new token for expired but valid token - Request ID: ${requestId}`
        );
        const newToken = await generate_jwt_token_fromtoken(
          unverifiedpayload,
          config_own_rodit.own_rodit.metadata.jwt_duration,
          notAfter,
          timestamp
        );
        logger.debug(
          `Successfully generated renewal token - Request ID: ${requestId}`
        );
        return { payload: unverifiedpayload, protectedHeader: null, newToken };
      }

      logger.error(
        `Token renewal failed - invalid token - Request ID: ${requestId}`
      );
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
    `Token renewal check - Request ID: ${requestId} - Time left: ${durationLeftpct.toFixed(
      1
    )}%`
  );

  if (durationLeftpct < 100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE) {
    const randomNumber = generateRandomNumber();
    const shouldDoFullVerification =
      randomNumber < tokenrenewaloptions.THRESHOLD_VALIDATION_TYPE ||
      newduration <
        (payload.rodit_maxrqwindow *
          (100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE)) /
          100;

    if (shouldDoFullVerification) {
      logger.debug(`Performing full verification - Request ID: ${requestId}`);
      const { isValid, notAfter } = await thorough_validate_jwt_token_be(
        payload,
        requestId
      );
      if (isValid) {
        logger.debug(
          `Full verification successful, generating new token - Request ID: ${requestId}`
        );
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
      logger.debug(`Performing light verification - Request ID: ${requestId}`);
      const { isValid, notAfter } = await brief_validate_jwt_token_be(
        payload,
        requestId
      );
      if (isValid) {
        logger.debug(
          `Light verification successful, generating new token - Request ID: ${requestId}`
        );
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
    logger.warn(`Token renewal verification failed - Request ID: ${requestId}`);
  }

  logger.debug(`No token renewal needed - Request ID: ${requestId}`);
  return { newToken: null };
}

function handleTokenError(error, res, requestId) {
  logger.error(
    `Token error occurred - Request ID: ${requestId} - Error: ${error.message}`
  );

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
 * Webhook Functions
 */
const send_webhook = async (event, data, isError = false) => {
  const requestId = ulid();
  logger.debug(
    `Starting webhook delivery - Event: ${event}, Request ID: ${requestId}`
  );

  try {
    const config_own_rodit = stateManager.getConfigOwnRodit();
    if (!config_own_rodit || !config_own_rodit.own_rodit.metadata.webhook_url) {
      logger.warn(`Webhook configuration missing - Request ID: ${requestId}`);
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

    logger.debug(`Preparing webhook payload - Request ID: ${requestId}`);

    const sha256_ofpayload = crypto
      .createHash("sha256")
      .update(payload)
      .digest();

    // This is a dubious comversion, isn't the hey already in bytes?
    const own_rodit_private_key = new Uint8Array(
      Buffer.from(config_own_rodit.own_rodit_bytes_private_key, "hex")
    );

    const signature_ofpayload = nacl.sign.detached(
      sha256_ofpayload,
      own_rodit_private_key
    );
    const signature_hex_ofpayload =
      Buffer.from(signature_ofpayload).toString("hex");

    logger.debug(
      `Sending webhook to: ${config_own_rodit.own_rodit.metadata.webhook_url}`
    );

    const response = await fetch(
      `https://${config_own_rodit.own_rodit.metadata.webhook_url}/webhook`,
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
      logger.error(
        `Webhook delivery failed with status: ${response.status} - Request ID: ${requestId}`
      );
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await response.text();
    logger.info(
      `Webhook delivered successfully - Event: ${event}, Request ID: ${requestId}`
    );

    return {
      isValid: true,
      message: "Webhook sent successfully",
      requestId,
    };
  } catch (error) {
    logger.error(
      `Webhook delivery failed - Request ID: ${requestId}, Error: ${error.message}`
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

async function authenticate_webhook(
  payload,
  signature_hex_ofpayload,
  timestamp,
  peer_rodit_owner_id
) {
  const requestId = ulid();
  logger.debug(`Starting webhook authentication - Request ID: ${requestId}`);

  try {
    const currentTime = Date.now();
    const timeThreshold = 5 * 60 * 1000;

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

    logger.debug(`Calculating payload hash - Request ID: ${requestId}`);
    const sha256_ofpayload = crypto
      .createHash("sha256")
      .update(payload)
      .digest();

    const buffer_signature_ofpayload = Buffer.from(
      signature_hex_ofpayload,
      "hex"
    );

    logger.debug(
      `Fetching public key for verification - Request ID: ${requestId}`
    );
    const peer_bytes_public_key = new Uint8Array(
      Buffer.from(peer_rodit_owner_id, "hex")
    );

    const isValid = nacl.sign.detached.verify(
      sha256_ofpayload,
      buffer_signature_ofpayload,
      peer_bytes_public_key
    );

    if (!isValid) {
      logger.warn(`Invalid webhook signature - Request ID: ${requestId}`);
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
      `Webhook authentication failed - Request ID: ${requestId}, Error: ${error.message}`
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
  login_portal,
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
  AuthStateManager,
  roditManager,
  stateManager,
  logServerBufferState,
};
