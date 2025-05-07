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

    // Separate variables for own key and peer key
    this.ownBase64urlJwkPublicKey = null;
    this.peerBase64urlJwkPublicKey = null;
        
    // Other existing properties
    this.configOwnRodit = null;
    this.currentToken = null;
    this.jwtToken = null;

    AuthStateManager.instance = this;
  }

  // Methods for own public key
  async setOwnBase64urlJwkPublicKey(key) {
    this.ownBase64urlJwkPublicKey = key;
    return key;
  }

  getOwnBase64urlJwkPublicKey() {
    return this.ownBase64urlJwkPublicKey;
  }

  // Methods for peer public key
  async setPeerBase64urlJwkPublicKey(key) {
    this.peerBase64urlJwkPublicKey = key;
    return key;
  }

  getPeerBase64urlJwkPublicKey() {
    return this.peerBase64urlJwkPublicKey;
  }

  getOwnBase64urlJwkPublicKey() {
    console.warn("Deprecated: Use getOwnBase64urlJwkPublicKey or getPeerBase64urlJwkPublicKey instead");
    return this.ownBase64urlJwkPublicKey;
  }

  // Existing methods remain unchanged
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

  async setJwtToken(token) {
    this.jwtToken = token;
    return token;
  }

  getJwtToken() {
    return this.jwtToken;
  }

  getPortalUrl(serviceProviderId, port) {
    // Existing implementation remains unchanged
    // ...
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
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Starting vault initialization", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
    });

    if (this.vaultInitialized) {
      logger.debug("Vault already initialized", {
        component: "RoditManager",
        method: "initializeVault",
        requestId,
      });
      return vault;
    }

    try {
      const vaultInstance = await initializeProductionVault();
      await setupTokenRenewal(vaultInstance);
      this.vaultInitialized = true;
      this.vaultPath = config.get("VAULT_RODIT_KEYVALUE_PATH");

      const duration = Date.now() - startTime;
      logger.info("Vault initialized successfully", {
        component: "RoditManager",
        method: "initializeVault",
        requestId,
        duration,
        status: "success",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("vault_initialization_duration_ms", duration, {
        success: true,
        component: "RoditManager",
      });

      return vaultInstance;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Vault initialization failed", {
        component: "RoditManager",
        method: "initializeVault",
        requestId,
        duration,
        status: "error",
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("vault_initialization_duration_ms", duration, {
        success: false,
        component: "RoditManager",
        errorType: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("vault_initialization_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        component: "RoditManager",
      });

      throw error;
    }
  }

  async getCredentials(type) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Retrieving credentials", {
      component: "RoditManager",
      method: "getCredentials",
      requestId,
      credentialType: type,
    });

    if (!this.vaultInitialized) {
      logger.debug("Vault not initialized, initializing now", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
      });
      await this.initializeVault();
    }

    if (this.credentials[type]) {
      logger.debug("Using cached credentials", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
      });
      return this.credentials[type];
    }

    try {
      // Make the accountType consistent with the type parameter
      const accountType = `account_${type}`;

      logger.debug("Fetching credentials from vault", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        vaultPath: `${this.vaultPath}/${type}`,
      });

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

      const duration = Date.now() - startTime;
      logger.info("Credentials retrieved successfully", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        duration,
        accountId: vaultData.account_id, // Safe to log account ID
      });

      // Emit metrics for Grafana dashboards
      logger.metric("credential_retrieval_duration_ms", duration, {
        success: true,
        credentialType: type,
        component: "RoditManager",
      });

      return vaultData;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Failed to retrieve credentials", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("credential_retrieval_duration_ms", duration, {
        success: false,
        credentialType: type,
        component: "RoditManager",
        errorType: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("credential_retrieval_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        credentialType: type,
        component: "RoditManager",
      });

      throw error;
    }
  }

  async initializeRoditConfig(type) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Starting RODiT config initialization", {
      component: "RoditManager",
      method: "initializeRoditConfig",
      requestId,
      configType: type,
    });

    try {
      logger.debug("Getting credentials", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "fetchCredentials",
      });

      const credentials = await this.getCredentials(type);

      if (!credentials) {
        logger.error("Failed to retrieve credentials", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "credentialCheck",
        });
        throw new Error(`Credentials not available for ${type}`);
      }

      const { account_id, implicit_account_id } = credentials;
      logger.info("Using account for initialization", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        accountId: account_id,
        step: "accountSetup",
      });

      logger.debug("Checking account state on blockchain", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        accountId: account_id,
        step: "blockchainCheck",
      });

      const accountState = await nearorg_rpc_state(
        CONSTANTS.SMART_CONTRACT,
        account_id
      );

      if (!accountState) {
        logger.warn("Account has no balance in network", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          accountId: account_id,
          step: "blockchainCheck",
        });
      } else {
        logger.info("Account state verified on blockchain", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          accountId: account_id,
          step: "blockchainCheck",
        });
      }

      logger.debug("Fetching RODiT tokens for account", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        accountId: account_id,
        step: "tokenFetch",
      });

      const own_rodit = await nearorg_rpc_tokensfromaccountid(
        CONSTANTS.SMART_CONTRACT,
        account_id
      );

      // Check if we have a real RODiT token
      if (!own_rodit || !own_rodit.token_id) {
        logger.warn(
          "No RODiT instances found, proceeding with partial initialization",
          {
            component: "RoditManager",
            method: "initializeRoditConfig",
            requestId,
            accountId: account_id,
            step: "tokenCheck",
          }
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
          "Created minimal config object for partial initialization",
          {
            component: "RoditManager",
            method: "initializeRoditConfig",
            requestId,
            configType: type,
            configObject: configCopy,
            step: "minimalConfig",
          }
        );

        logger.debug("Storing minimal configuration in state manager", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "storeConfig",
        });

        await this.stateManager.setConfigOwnRodit(minimalConfig);

        logger.debug("Converting implicit account ID to base64url", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "keyConversion",
        });

        const session_base64url_jwk_public_key = Buffer.from(
          implicit_account_id,
          "hex"
        ).toString("base64url");

        logger.debug("Setting session base64url JWK public key", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "setSessionKey",
        });

        await this.stateManager.setOwnBase64urlJwkPublicKey(
          session_base64url_jwk_public_key
        );

        const duration = Date.now() - startTime;
        logger.info("Partial RODiT configuration completed successfully", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          duration,
          configLevel: "partial",
          step: "complete",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("rodit_initialization_duration_ms", duration, {
          success: true,
          configType: type,
          configLevel: "partial",
          component: "RoditManager",
        });

        return minimalConfig;
      }

      logger.info("Successfully retrieved RODiT token", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        tokenId: own_rodit.token_id,
        step: "tokenRetrieved",
      });

      const SERVERPORT = config.get("SERVERPORT");

      if (
        !own_rodit.metadata ||
        !own_rodit.metadata.subjectuniqueidentifier_url
      ) {
        logger.error("Missing required metadata in RODiT", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          missingField: "subjectuniqueidentifier_url",
          step: "metadataCheck",
        });

        throw new Error(
          "Missing required metadata: subjectuniqueidentifier_url"
        );
      }

      const apiendpoint =
        own_rodit.metadata.subjectuniqueidentifier_url + ":" + SERVERPORT;

      logger.debug("Constructed API endpoint", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        apiEndpoint: apiendpoint,
        step: "apiEndpointCreation",
      });

      logger.info("Building full configuration object", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "fullConfigCreation",
      });

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

      logger.info("Created full config object", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        configObject: configCopy,
        step: "fullConfig",
      });

      logger.debug("Storing configuration in state manager", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "storeConfig",
      });

      await this.stateManager.setConfigOwnRodit(configObject);

      logger.info("Configuration stored successfully", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "configStored",
      });

      logger.debug("Converting implicit account ID to base64url", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "keyConversion",
      });

      const session_base64url_jwk_public_key = Buffer.from(
        implicit_account_id,
        "hex"
      ).toString("base64url");

      logger.debug("Setting session base64url JWK public key", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "setSessionKey",
      });

      stateManager.setPeerBase64urlJwkPublicKey(
        serviceprovider_base64_public_key
      );

      const duration = Date.now() - startTime;
      logger.info("RODiT configuration completed successfully", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        duration,
        configLevel: "full",
        step: "complete",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_initialization_duration_ms", duration, {
        success: true,
        configType: type,
        configLevel: "full",
        component: "RoditManager",
      });

      return configObject;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Error initializing RODiT config", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
        step: error.step || "unknown",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_initialization_duration_ms", duration, {
        success: false,
        configType: type,
        component: "RoditManager",
        errorType: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("rodit_initialization_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        configType: type,
        component: "RoditManager",
        step: error.step || "unknown",
      });

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
  logger.debug(`Buffer state at ${stage}`, {
    component: "BufferManager",
    method: "logServerBufferState",
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
const validateAndSetUrl = (value, field, obj = null) => {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Validating URL", {
    component: "Validator",
    method: "validateAndSetUrl",
    requestId,
    field,
  });

  if (value == null) {
    logger.debug("URL validation skipped, value is null", {
      component: "Validator",
      method: "validateAndSetUrl",
      requestId,
      field,
    });
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
    const result = `https://${normalizedUrl}`;

    const duration = Date.now() - startTime;
    logger.debug("URL validation successful", {
      component: "Validator",
      method: "validateAndSetUrl",
      requestId,
      field,
      duration,
      isValid: true,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("validation_duration_ms", duration, {
      validationType: "url",
      field,
      success: true,
      component: "Validator",
    });

    return setValue(obj, field, result);
  }

  const duration = Date.now() - startTime;
  logger.warn("URL validation failed", {
    component: "Validator",
    method: "validateAndSetUrl",
    requestId,
    field,
    duration,
    isValid: false,
    value,
  });

  // Emit metrics for Grafana dashboards
  logger.metric("validation_duration_ms", duration, {
    validationType: "url",
    field,
    success: false,
    component: "Validator",
  });
  logger.metric("validation_errors_total", 1, {
    validationType: "url",
    field,
    component: "Validator",
  });

  throw new Error(`Invalid URL for ${field}: ${value}`);
};

const validateAndSetDate = (value, field, obj = null) => {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Validating date", {
    component: "Validator",
    method: "validateAndSetDate",
    requestId,
    field,
    value,
  });

  if (value == null || value === "0" || value === "") {
    logger.debug("Date validation defaulted to 1970-01-01", {
      component: "Validator",
      method: "validateAndSetDate",
      requestId,
      field,
      reason: "Empty or null value",
    });
    return setValue(obj, field, "1970-01-01");
  }

  const date = new Date(value);
  if (isNaN(date.getTime()) || date < new Date("1970-01-01")) {
    const duration = Date.now() - startTime;
    logger.warn("Date validation failed", {
      component: "Validator",
      method: "validateAndSetDate",
      requestId,
      field,
      duration,
      isValid: false,
      value,
      reason: isNaN(date.getTime())
        ? "Invalid date format"
        : "Date before 1970-01-01",
    });

    // Emit metrics for Grafana dashboards
    logger.metric("validation_duration_ms", duration, {
      validationType: "date",
      field,
      success: false,
      component: "Validator",
    });
    logger.metric("validation_errors_total", 1, {
      validationType: "date",
      field,
      component: "Validator",
      reason: isNaN(date.getTime()) ? "invalid_format" : "before_epoch",
    });

    throw new Error(
      `Invalid date for ${field}: ${value}. Must be YYYY-MM-DD and no earlier than 1970-01-01`
    );
  }

  const duration = Date.now() - startTime;
  logger.debug("Date validation successful", {
    component: "Validator",
    method: "validateAndSetDate",
    requestId,
    field,
    duration,
    isValid: true,
  });

  // Emit metrics for Grafana dashboards
  logger.metric("validation_duration_ms", duration, {
    validationType: "date",
    field,
    success: true,
    component: "Validator",
  });

  return setValue(obj, field, value);
};

const validateAndSetJson = (value, field, obj = null) => {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Validating JSON", {
    component: "Validator",
    method: "validateAndSetJson",
    requestId,
    field,
  });

  if (value == null) {
    logger.debug("JSON validation skipped, value is null", {
      component: "Validator",
      method: "validateAndSetJson",
      requestId,
      field,
    });
    return null;
  }

  let jsonString;
  try {
    if (typeof value === "object") {
      jsonString = JSON.stringify(value);
      logger.debug("Converted object to JSON string", {
        component: "Validator",
        method: "validateAndSetJson",
        requestId,
        field,
        objectType: value.constructor.name,
      });
    } else if (typeof value === "string") {
      JSON.parse(value); // Just to validate, we don't use the result
      jsonString = value;
      logger.debug("Validated JSON string", {
        component: "Validator",
        method: "validateAndSetJson",
        requestId,
        field,
      });
    } else {
      const duration = Date.now() - startTime;
      logger.warn("JSON validation failed - invalid type", {
        component: "Validator",
        method: "validateAndSetJson",
        requestId,
        field,
        duration,
        actualType: typeof value,
        isValid: false,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("validation_duration_ms", duration, {
        validationType: "json",
        field,
        success: false,
        component: "Validator",
        reason: "invalid_type",
      });
      logger.metric("validation_errors_total", 1, {
        validationType: "json",
        field,
        component: "Validator",
        reason: "invalid_type",
      });

      throw new Error(`Invalid type for ${field}: ${typeof value}`);
    }
  } catch (e) {
    const duration = Date.now() - startTime;
    logger.warn("JSON validation failed - parsing error", {
      component: "Validator",
      method: "validateAndSetJson",
      requestId,
      field,
      duration,
      errorMessage: e.message,
      isValid: false,
      valuePreview: typeof value === "string" ? value.substring(0, 100) : null,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("validation_duration_ms", duration, {
      validationType: "json",
      field,
      success: false,
      component: "Validator",
      reason: "parse_error",
    });
    logger.metric("validation_errors_total", 1, {
      validationType: "json",
      field,
      component: "Validator",
      reason: "parse_error",
    });

    throw new Error(`Invalid JSON for ${field}: ${e.message}`);
  }

  const duration = Date.now() - startTime;
  logger.debug("JSON validation successful", {
    component: "Validator",
    method: "validateAndSetJson",
    requestId,
    field,
    duration,
    isValid: true,
    jsonLength: jsonString.length,
  });

  // Emit metrics for Grafana dashboards
  logger.metric("validation_duration_ms", duration, {
    validationType: "json",
    field,
    success: true,
    component: "Validator",
  });

  return setValue(obj, field, jsonString);
};

const validateAndSetSignature = (value, field, obj = null) => {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Validating signature", {
    component: "Validator",
    method: "validateAndSetSignature",
    requestId,
    field,
  });

  if (value == null) {
    logger.debug("Signature validation skipped, value is null", {
      component: "Validator",
      method: "validateAndSetSignature",
      requestId,
      field,
    });
    return null;
  }

  const base64urlPattern = /^[A-Za-z0-9_-]+$/;

  if (!base64urlPattern.test(value)) {
    const duration = Date.now() - startTime;
    logger.warn("Signature validation failed - invalid encoding", {
      component: "Validator",
      method: "validateAndSetSignature",
      requestId,
      field,
      duration,
      isValid: false,
      valueLength: value.length,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("validation_duration_ms", duration, {
      validationType: "signature",
      field,
      success: false,
      component: "Validator",
      reason: "invalid_encoding",
    });
    logger.metric("validation_errors_total", 1, {
      validationType: "signature",
      field,
      component: "Validator",
      reason: "invalid_encoding",
    });

    throw new Error(`Invalid base64url encoding for ${field}: ${value}`);
  }

  if (value.length !== 86) {
    const duration = Date.now() - startTime;
    logger.warn("Signature validation failed - invalid length", {
      component: "Validator",
      method: "validateAndSetSignature",
      requestId,
      field,
      duration,
      isValid: false,
      actualLength: value.length,
      expectedLength: 86,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("validation_duration_ms", duration, {
      validationType: "signature",
      field,
      success: false,
      component: "Validator",
      reason: "invalid_length",
    });
    logger.metric("validation_errors_total", 1, {
      validationType: "signature",
      field,
      component: "Validator",
      reason: "invalid_length",
    });

    throw new Error(
      `Invalid signature length for ${field}: ${value}. Expected 86 characters for base64url encoded Ed25519 signature.`
    );
  }

  const duration = Date.now() - startTime;
  logger.debug("Signature validation successful", {
    component: "Validator",
    method: "validateAndSetSignature",
    requestId,
    field,
    duration,
    isValid: true,
  });

  // Emit metrics for Grafana dashboards
  logger.metric("validation_duration_ms", duration, {
    validationType: "signature",
    field,
    success: true,
    component: "Validator",
  });

  return setValue(obj, field, value);
};

function ensureDateIsSet(dateVar, defaultValue) {
  const requestId = ulid();

  if (!dateVar) {
    logger.debug("Date variable not set, using default", {
      component: "DateUtil",
      method: "ensureDateIsSet",
      requestId,
      defaultValue,
    });
    return defaultValue;
  }

  logger.debug("Using provided date value", {
    component: "DateUtil",
    method: "ensureDateIsSet",
    requestId,
    providedValue: dateVar,
  });

  return dateVar;
}

function validateSignatureFormat(signature, requestId) {
  const startTime = Date.now();

  logger.debug("Validating signature format", {
    component: "Validator",
    method: "validateSignatureFormat",
    requestId,
    signatureLength: signature.length,
  });

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

    const duration = Date.now() - startTime;
    logger.debug("Signature format validation complete", {
      component: "Validator",
      method: "validateSignatureFormat",
      requestId,
      duration,
      isValid: result.isValid,
      format: result.format,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("signature_validation_duration_ms", duration, {
      success: result.isValid,
      component: "Validator",
      signatureLength: signature.length,
    });

    if (!result.isValid) {
      logger.metric("signature_validation_errors_total", 1, {
        reason: "invalid_format",
        component: "Validator",
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    result.error = error.message;

    logger.error("Signature validation error", {
      component: "Validator",
      method: "validateSignatureFormat",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("signature_validation_duration_ms", duration, {
      success: false,
      component: "Validator",
      signatureLength: signature.length,
    });
    logger.metric("signature_validation_errors_total", 1, {
      reason: "exception",
      component: "Validator",
      errorType: error.constructor.name,
    });

    return result;
  }
}

function validatePublicKeyFormat(publicKey, requestId) {
  const startTime = Date.now();

  logger.debug("Validating public key format", {
    component: "Validator",
    method: "validatePublicKeyFormat",
    requestId,
    keyLength: publicKey.length,
  });

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

    const duration = Date.now() - startTime;
    logger.debug("Public key format validation complete", {
      component: "Validator",
      method: "validatePublicKeyFormat",
      requestId,
      duration,
      isValid: result.isValid,
      format: result.format,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("public_key_validation_duration_ms", duration, {
      success: result.isValid,
      component: "Validator",
      keyLength: publicKey.length,
    });

    if (!result.isValid) {
      logger.metric("public_key_validation_errors_total", 1, {
        reason: "invalid_format",
        component: "Validator",
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    result.error = error.message;

    logger.error("Public key validation error", {
      component: "Validator",
      method: "validatePublicKeyFormat",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("public_key_validation_duration_ms", duration, {
      success: false,
      component: "Validator",
      keyLength: publicKey.length,
    });
    logger.metric("public_key_validation_errors_total", 1, {
      reason: "exception",
      component: "Validator",
      errorType: error.constructor.name,
    });

    return result;
  }
}

/**
 * Data Transformation Functions
 */
function base64ToBase64Url(base64) {
  const result = base64
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  logger.debug("Converting base64 to base64url", {
    component: "Transformer",
    method: "base64ToBase64Url",
    inputLength: base64.length,
    outputLength: result.length,
  });

  return result;
}

function canonicalizeObject(obj) {
  const startTime = Date.now();
  const requestId = ulid();

  logger.debug("Starting object canonicalization", {
    component: "Transformer",
    method: "canonicalizeObject",
    requestId,
    objectType:
      obj === null ? "null" : Array.isArray(obj) ? "array" : typeof obj,
  });

  if (typeof obj !== "object" || obj === null) {
    logger.debug("Skipping canonicalization for non-object", {
      component: "Transformer",
      method: "canonicalizeObject",
      requestId,
      valueType: typeof obj,
    });
    return obj;
  }

  let result;
  if (Array.isArray(obj)) {
    logger.debug("Canonicalizing array", {
      component: "Transformer",
      method: "canonicalizeObject",
      requestId,
      arrayLength: obj.length,
    });
    result = obj.map(canonicalizeObject);
  } else {
    logger.debug("Canonicalizing object", {
      component: "Transformer",
      method: "canonicalizeObject",
      requestId,
      keyCount: Object.keys(obj).length,
    });
    result = Object.fromEntries(
      Object.entries(obj)
        .sort()
        .map(([key, value]) => [key, canonicalizeObject(value)])
    );
  }

  const duration = Date.now() - startTime;
  logger.debug("Object canonicalization complete", {
    component: "Transformer",
    method: "canonicalizeObject",
    requestId,
    duration,
  });

  // Emit metrics for Grafana dashboards if operation took significant time
  if (duration > 50) {
    logger.metric("canonicalization_duration_ms", duration, {
      component: "Transformer",
      objectType: Array.isArray(obj) ? "array" : "object",
      size: Array.isArray(obj) ? obj.length : Object.keys(obj).length,
    });
  }

  return result;
}

function calculateCanonicalHash(variable) {
  const startTime = Date.now();
  const requestId = ulid();

  logger.debug("Calculating canonical hash", {
    component: "Transformer",
    method: "calculateCanonicalHash",
    requestId,
    variableType: typeof variable,
  });

  try {
    const canonicalObj = canonicalizeObject(variable);
    const canonicalJson = JSON.stringify(canonicalObj);

    logger.debug("Canonicalized JSON created", {
      component: "Transformer",
      method: "calculateCanonicalHash",
      requestId,
      jsonLength: canonicalJson.length,
    });

    const messageUint8 = decodeUTF8(canonicalJson);

    logger.debug("Decoded to Uint8Array for hashing", {
      component: "Transformer",
      method: "calculateCanonicalHash",
      requestId,
      bytesLength: messageUint8.length,
    });

    const hashUint8 = nacl.hash(messageUint8);

    logger.debug("Hash calculated", {
      component: "Transformer",
      method: "calculateCanonicalHash",
      requestId,
      hashLength: hashUint8.length,
    });

    const hexResult = Array.from(hashUint8)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const duration = Date.now() - startTime;
    logger.debug("Canonical hash calculation complete", {
      component: "Transformer",
      method: "calculateCanonicalHash",
      requestId,
      duration,
      hashLength: hexResult.length,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("hash_calculation_duration_ms", duration, {
      component: "Transformer",
      jsonLength: canonicalJson.length,
    });

    return hexResult;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Hash calculation failed", {
      component: "Transformer",
      method: "calculateCanonicalHash",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("hash_calculation_duration_ms", duration, {
      component: "Transformer",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("hash_calculation_errors_total", 1, {
      component: "Transformer",
      errorType: error.constructor.name,
    });

    throw error;
  }
}

async function base64url2jwk_public_key(base64url_public_key) {
  const startTime = Date.now();
  const requestId = ulid();

  logger.debug("Converting base64url to JWK public key", {
    component: "Transformer",
    method: "base64url2jwk_public_key",
    requestId,
  });

  try {
    const jwk_public_key = {
      kty: "OKP",
      crv: "Ed25519",
      x: base64url_public_key,
      use: "sig",
    };

    logger.debug("JWK public key structure created", {
      component: "Transformer",
      method: "base64url2jwk_public_key",
      requestId,
      jwk: {
        kty: jwk_public_key.kty,
        crv: jwk_public_key.crv,
        use: jwk_public_key.use,
        xLength: jwk_public_key.x.length,
      },
    });

    const session_jwk_public_key = await importJWK(jwk_public_key, "EdDSA");

    const duration = Date.now() - startTime;
    logger.debug("JWK public key import successful", {
      component: "Transformer",
      method: "base64url2jwk_public_key",
      requestId,
      duration,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("jwk_import_duration_ms", duration, {
      component: "Transformer",
      success: true,
    });

    return session_jwk_public_key;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("JWK public key import failed", {
      component: "Transformer",
      method: "base64url2jwk_public_key",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("jwk_import_duration_ms", duration, {
      component: "Transformer",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("jwk_import_errors_total", 1, {
      component: "Transformer",
      errorType: error.constructor.name,
    });

    throw error;
  }
}

function hex2base64url(hexString) {
  const startTime = Date.now();
  const requestId = ulid();

  logger.debug("Converting hex to base64url", {
    component: "Transformer",
    method: "hex2base64url",
    requestId,
    hexLength: hexString.length,
  });

  try {
    // Step 1: Convert hex to Uint8Array
    const bytes = new Uint8Array(
      hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16))
    );

    logger.debug("Converted hex to bytes", {
      component: "Transformer",
      method: "hex2base64url",
      requestId,
      bytesLength: bytes.length,
    });

    // Step 2: Convert Uint8Array to base64
    const base64 = btoa(String.fromCharCode.apply(null, bytes));

    logger.debug("Converted bytes to base64", {
      component: "Transformer",
      method: "hex2base64url",
      requestId,
      base64Length: base64.length,
    });

    // Step 3: Convert base64 to base64url
    const base64url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const duration = Date.now() - startTime;
    logger.debug("Conversion to base64url complete", {
      component: "Transformer",
      method: "hex2base64url",
      requestId,
      duration,
      base64urlLength: base64url.length,
    });

    // Emit metrics for Grafana dashboards if operation took significant time or was on large input
    if (duration > 20 || hexString.length > 500) {
      logger.metric("hex_to_base64url_duration_ms", duration, {
        component: "Transformer",
        hexLength: hexString.length,
      });
    }

    return base64url;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Hex to base64url conversion failed", {
      component: "Transformer",
      method: "hex2base64url",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
      hexPreview:
        hexString.substring(0, 30) + (hexString.length > 30 ? "..." : ""),
    });

    // Emit metrics for Grafana dashboards
    logger.metric("hex_to_base64url_duration_ms", duration, {
      component: "Transformer",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("hex_to_base64url_errors_total", 1, {
      component: "Transformer",
      errorType: error.constructor.name,
    });

    throw error;
  }
}

async function verify_rodit_ownership(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature,
  peer_rodit
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting RODiT ownership verification", {
    component: "RoditAuth",
    method: "verify_rodit_ownership",
    requestId,
    peerRoditId: peerroditid,
    timestamp: peertimestamp,
    signatureLength: peerroditid_base64url_signature?.length,
  });

  try {
    // DO NOT DELETE THE FOLLOWING COMMENT
    /* Maybe for NEP413 compatibility, the following line added "NEAR" before peerroditid */
    const timeString = await unixTimeToDateString(peertimestamp);
    const roditidandtimestamp = new TextEncoder().encode(
      peerroditid + timeString
    );

    logger.debug("Encoded roditid and timestamp", {
      requestId,
      timeString,
      bufferLength: roditidandtimestamp.length,
    });

    const bytes_ed25519_signature = new Uint8Array(
      Buffer.from(peerroditid_base64url_signature, "base64url")
    );

    logger.debug("Decoded signature", {
      requestId,
      signatureLength: bytes_ed25519_signature.length,
    });

    const peer_bytes_ed25519_public_key = await nearorg_rpc_fetchpublickeybytes(
      peer_rodit.owner_id
    );

    logger.debug("Retrieved public key", {
      requestId,
      ownerId: peer_rodit.owner_id,
      keyLength: peer_bytes_ed25519_public_key.length,
    });

    const isaMatch = nacl.sign.detached.verify(
      roditidandtimestamp,
      bytes_ed25519_signature,
      peer_bytes_ed25519_public_key
    );

    const duration = Date.now() - startTime;

    if (isaMatch) {
      logger.info("Peer RODiT ownership check passed", {
        component: "RoditAuth",
        requestId,
        duration,
        peerRoditId: peerroditid,
        ownerId: peer_rodit.owner_id,
        outcome: "success",
      });

      // Add metric for successful verification
      logger.metric &&
        logger.metric("rodit_ownership_verification", duration, {
          result: "success",
          peer_rodit_id: peerroditid,
        });

      return true;
    } else {
      logger.error("Peer RODiT ownership check failed", {
        component: "RoditAuth",
        requestId,
        duration,
        peerRoditId: peerroditid,
        ownerId: peer_rodit.owner_id,
        outcome: "failed",
      });

      // Add metric for failed verification
      logger.metric &&
        logger.metric("rodit_ownership_verification", duration, {
          result: "failure",
          peer_rodit_id: peerroditid,
        });

      throw new Error("Error 035: PeerEd25519SignatureVerificationFailure");
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("RODiT ownership verification failed", {
      component: "RoditAuth",
      method: "verify_rodit_ownership",
      requestId,
      duration,
      peerRoditId: peerroditid,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metric for verification errors
    logger.metric &&
      logger.metric("rodit_ownership_verification_errors", 1, {
        error_type: error.name || "Unknown",
        peer_rodit_id: peerroditid,
      });

    throw new Error("Error A33: " + error.message);
  }
}

async function validate_jwt_token_be(token, own_rodit) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting JWT token validation", {
    component: "JwtAuth",
    method: "validate_jwt_token_be",
    requestId,
    tokenLength: token?.length,
    hasOwnRodit: !!own_rodit,
    ownRoditId: own_rodit?.token_id,
  });

  try {
    const unverifiedpayload = decodeJwt(token);

    logger.debug("Decoded JWT payload", {
      requestId,
      iss: unverifiedpayload?.iss,
      jti: unverifiedpayload?.jti,
      exp: unverifiedpayload?.exp,
      roditId: unverifiedpayload?.rodit_id,
    });

    const sp_rodit = await nearorg_rpc_tokenfromroditid(
      unverifiedpayload.rodit_id
    );

    logger.debug("Retrieved service provider RODiT", {
      requestId,
      spRoditId: sp_rodit?.token_id,
      spOwnerId: sp_rodit?.owner_id,
    });

    const publicKeyBytes = await nearorg_rpc_fetchpublickeybytes(
      sp_rodit.owner_id
    );

    const serviceprovider_base64_public_key =
      Buffer.from(publicKeyBytes).toString("base64url");

    logger.debug("Converted public key to base64url", {
      requestId,
      keyLength: serviceprovider_base64_public_key?.length,
    });

    const sp_public_key = await base64url2jwk_public_key(
      serviceprovider_base64_public_key
    );

    logger.debug("Converted to JWK public key", { requestId });

    const jwtVerifyStartTime = Date.now();
    const { payload, _ } = await jwtVerify(token, sp_public_key, {
      algorithms: ["EdDSA"],
    });

    logger.debug("JWT signature verified", {
      requestId,
      jwtVerifyDuration: Date.now() - jwtVerifyStartTime,
    });

    stateManager.setOwnBase64urlJwkPublicKey(
      serviceprovider_base64_public_key
    );

    const verifyStartTime = Date.now();
    let { peer_rodit, goodrodit } = await verify_peerrodit_getrodit(
      payload.rodit_id,
      payload.iat,
      payload.rodit_idsignature,
      own_rodit
    );

    logger.debug("Verified peer RODiT", {
      requestId,
      verifyPeerDuration: Date.now() - verifyStartTime,
      goodRodit: goodrodit,
    });

    if (goodrodit) {
      const now = Math.floor(Date.now() / 1000);

      // Token expiration check
      if (payload.exp <= now) {
        logger.warn("Token validation failed - Token expired", {
          component: "JwtAuth",
          requestId,
          exp: payload.exp,
          now,
          difference: now - payload.exp,
        });

        throw new Error("Error 007: Token has expired");
      }

      // Token not-before check
      if (payload.nbf > now) {
        logger.warn("Token validation failed - Token not yet valid", {
          component: "JwtAuth",
          requestId,
          nbf: payload.nbf,
          now,
          difference: payload.nbf - now,
        });

        throw new Error("Error 006: Token is not yet valid");
      }

      // Issuer check
      if (payload.iss !== own_rodit.metadata.subjectuniqueidentifier_url) {
        logger.warn("Token validation failed - Invalid issuer", {
          component: "JwtAuth",
          requestId,
          tokenIssuer: payload.iss,
          expectedIssuer: own_rodit.metadata.subjectuniqueidentifier_url,
        });

        throw new Error("Error 005: Invalid issuer");
      }

      // Audience check
      if (payload.aud !== own_rodit.owner_id) {
        logger.warn("Token validation failed - Invalid audience", {
          component: "JwtAuth",
          requestId,
          tokenAudience: payload.aud,
          expectedAudience: own_rodit.owner_id,
        });

        throw new Error("Error 004: Invalid audience");
      }

      const totalDuration = Date.now() - startTime;

      logger.info("JWT token validation successful", {
        component: "JwtAuth",
        method: "validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        jti: payload.jti,
        roditId: payload.rodit_id,
      });

      // Add metric for successful validations
      logger.metric &&
        logger.metric("jwt_token_validation", totalDuration, {
          result: "success",
          rodit_id: payload.rodit_id,
        });

      return { payload, peer_rodit };
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("JWT token validation failed", {
      component: "JwtAuth",
      method: "validate_jwt_token_be",
      requestId,
      duration,
      errorCode: error.code,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for validation errors
    logger.metric &&
      logger.metric("jwt_token_validation_errors", 1, {
        error_type: error.name || "Unknown",
        error_code: error.code || "none",
      });

    logger.metric &&
      logger.metric("jwt_token_validation", duration, {
        result: "failure",
        error_type: error.name || "Unknown",
      });

    throw new Error(`JWT token validation failed: ${error.message}`);
  }
}

async function nearorg_rpc_timestamp() {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching blockchain timestamp", {
    component: "NearRPC",
    method: "nearorg_rpc_timestamp",
    requestId,
    rpcUrl: NEAR_RPC_URL,
  });

  try {
    const jsonData = {
      jsonrpc: "2.0",
      id: "dontcare",
      method: "block",
      params: {
        finality: "final",
      },
    };

    const fetchStartTime = Date.now();
    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });
    const fetchDuration = Date.now() - fetchStartTime;

    logger.debug("RPC response received", {
      requestId,
      statusCode: response.status,
      fetchDuration,
    });

    if (!response.ok) {
      logger.error("HTTP error from blockchain RPC", {
        component: "NearRPC",
        requestId,
        statusCode: response.status,
        statusText: response.statusText,
        duration: Date.now() - startTime,
      });

      // Add metric for failed RPC calls
      logger.metric &&
        logger.metric("near_rpc_calls", fetchDuration, {
          result: "http_error",
          status_code: response.status,
          method: "block",
        });

      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const parseStartTime = Date.now();
    const parsedJson = await response.json();
    const parseDuration = Date.now() - parseStartTime;

    logger.debug("RPC response parsed", {
      requestId,
      parseDuration,
    });

    if (parsedJson.error) {
      logger.error("RPC error response", {
        component: "NearRPC",
        requestId,
        rpcError: parsedJson.error.message,
        rpcErrorCode: parsedJson.error.code,
        duration: Date.now() - startTime,
      });

      // Add metric for RPC errors
      logger.metric &&
        logger.metric("near_rpc_errors", 1, {
          error_code: parsedJson.error.code || "unknown",
          method: "block",
        });

      throw new Error(`Error 017: ${parsedJson.error.message}`);
    }

    const timestamp = parsedJson.result?.header?.timestamp;
    const totalDuration = Date.now() - startTime;

    logger.info("Blockchain timestamp fetched successfully", {
      component: "NearRPC",
      method: "nearorg_rpc_timestamp",
      requestId,
      duration: totalDuration,
      fetchDuration,
      parseDuration,
      timestamp: timestamp || "0",
    });

    // Add metric for successful RPC calls
    logger.metric &&
      logger.metric("near_rpc_calls", totalDuration, {
        result: "success",
        method: "block",
      });

    return timestamp ? timestamp.toString() : "0";
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Error fetching blockchain timestamp", {
      component: "NearRPC",
      method: "nearorg_rpc_timestamp",
      requestId,
      duration,
      rpcUrl: NEAR_RPC_URL,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for timestamp errors
    logger.metric &&
      logger.metric("near_rpc_timestamp_errors", 1, {
        error_type: error.name || "Unknown",
      });

    throw error;
  }
}

async function nearorg_rpc_tokenfromroditid(roditid) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching RODiT token from blockchain", {
    component: "NearRPC",
    method: "nearorg_rpc_tokenfromroditid",
    requestId,
    roditId: roditid,
    smartContract: CONSTANTS.SMART_CONTRACT,
  });

  try {
    const args = { token_id: roditid };
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");

    const json_data = {
      jsonrpc: "2.0",
      id: CONSTANTS.SMART_CONTRACT,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: CONSTANTS.SMART_CONTRACT,
        method_name: "rodit_token",
        args_base64: argsBase64,
      },
    };

    const fetchStartTime = Date.now();
    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json_data),
    });
    const fetchDuration = Date.now() - fetchStartTime;

    logger.debug("RPC response received", {
      requestId,
      statusCode: response.status,
      fetchDuration,
    });

    if (!response.ok) {
      logger.error("HTTP error from blockchain RPC", {
        component: "NearRPC",
        requestId,
        roditId: roditid,
        statusCode: response.status,
        duration: Date.now() - startTime,
      });

      // Add metric for failed RPC calls
      logger.metric &&
        logger.metric("near_rpc_calls", fetchDuration, {
          result: "http_error",
          status_code: response.status,
          method: "rodit_token",
        });

      return new RODiT();
    }

    const parseStartTime = Date.now();
    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);
    const parseDuration = Date.now() - parseStartTime;

    logger.debug("RPC response parsed", {
      requestId,
      parseDuration,
      hasResult: !!parsedJson.result,
    });

    if (parsedJson.result && parsedJson.result.error) {
      logger.error("WASM execution error", {
        component: "NearRPC",
        requestId,
        roditId: roditid,
        wasmError: parsedJson.result.error,
        duration: Date.now() - startTime,
      });

      // Add metric for WASM errors
      logger.metric &&
        logger.metric("near_rpc_wasm_errors", 1, {
          method: "rodit_token",
          rodit_id: roditid,
        });

      return new RODiT();
    }

    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      logger.error("Invalid result format", {
        component: "NearRPC",
        requestId,
        roditId: roditid,
        resultType: typeof resultArray,
        duration: Date.now() - startTime,
      });

      // Add metric for format errors
      logger.metric &&
        logger.metric("near_rpc_format_errors", 1, {
          method: "rodit_token",
          rodit_id: roditid,
          error_type: "invalid_array",
        });

      return new RODiT();
    }

    const decodeStartTime = Date.now();
    const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
    const parsed = JSON.parse(resultString);
    const decodeDuration = Date.now() - decodeStartTime;

    logger.debug("RODiT data decoded", {
      requestId,
      decodeDuration,
      hasTokenId: !!parsed.token_id,
    });

    const rodit = new RODiT();
    Object.assign(rodit, parsed);

    const totalDuration = Date.now() - startTime;
    const hasValidData = !!rodit.token_id && !!rodit.owner_id;

    logger.info("RODiT token fetched", {
      component: "NearRPC",
      method: "nearorg_rpc_tokenfromroditid",
      requestId,
      duration: totalDuration,
      roditId: roditid,
      retrieved: hasValidData,
      fetchDuration,
      parseDuration,
      decodeDuration,
    });

    // Add metrics for successful RPC calls
    logger.metric &&
      logger.metric("near_rpc_calls", totalDuration, {
        result: "success",
        method: "rodit_token",
        data_found: hasValidData ? "true" : "false",
      });

    return rodit;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to fetch RODiT token", {
      component: "NearRPC",
      method: "nearorg_rpc_tokenfromroditid",
      requestId,
      duration,
      roditId: roditid,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for token fetch errors
    logger.metric &&
      logger.metric("near_rpc_token_errors", 1, {
        error_type: error.name || "Unknown",
        rodit_id: roditid,
      });

    return new RODiT();
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
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting NEP-413 RODiT verification", {
    component: "RoditAuth",
    method: "verify_peerrodit_getrodit_withnep413",
    requestId,
    message,
    nonceType: typeof nonce,
    nonceLength: Array.isArray(nonce) ? nonce.length : nonce?.length || 0,
    recipient,
    hasCallback: !!callbackUrl,
    signatureLength: signature?.length,
  });

  try {
    logger.debug("Fetching peer RODiT", {
      requestId,
      message,
    });

    const tokenFetchStart = Date.now();
    let peer_rodit = await nearorg_rpc_tokenfromroditid(message);
    const tokenFetchDuration = Date.now() - tokenFetchStart;

    logger.debug("Peer RODiT retrieved", {
      requestId,
      tokenFetchDuration,
      peerRoditId: peer_rodit?.token_id,
      peerOwnerId: peer_rodit?.owner_id,
    });

    // Correctly access serviceprovider_id
    const serviceprovider_id =
      config_own_rodit &&
      config_own_rodit.own_rodit &&
      config_own_rodit.own_rodit.metadata
        ? config_own_rodit.own_rodit.metadata.serviceprovider_id
        : null;

    if (!serviceprovider_id) {
      logger.error("Missing serviceprovider_id in configuration", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
      });

      throw new Error("Missing serviceprovider_id in configuration");
    }

    // Execute verification steps
    logger.debug("Starting verification checks", {
      requestId,
      checks: ["ownership", "match", "live", "active", "trusted"],
    });

    const verificationStart = Date.now();
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
    const verificationDuration = Date.now() - verificationStart;

    const [ownershipVerified, isaMatch, isLive, isActive, isTrusted] =
      verification_results;

    logger.debug("RODiT Verification Results", {
      requestId,
      verificationDuration,
      ownershipVerified,
      isaMatch,
      isLive,
      isActive,
      isTrusted,
    });

    if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
      const failedChecks = [];
      if (!ownershipVerified) failedChecks.push("ownership");
      if (!isaMatch) failedChecks.push("match");
      if (!isLive) failedChecks.push("live");
      if (!isActive) failedChecks.push("active");
      if (!isTrusted) failedChecks.push("trusted");

      logger.error("Peer RODiT NEP-413 verification failed", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        failedChecks,
        message,
        peerRoditId: peer_rodit?.token_id,
      });

      // Add metrics for verification failures
      logger.metric &&
        logger.metric("rodit_nep413_verification_failures", 1, {
          failed_checks: failedChecks.join(","),
          message,
        });

      throw new Error("Error 037: Peer RODiT verification failed");
    }

    const totalDuration = Date.now() - startTime;

    logger.info("NEP-413 RODiT verification successful", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit_withnep413",
      requestId,
      duration: totalDuration,
      message,
      peerRoditId: peer_rodit?.token_id,
      peerOwnerId: peer_rodit?.owner_id,
      tokenFetchDuration,
      verificationDuration,
    });

    // Add metrics for successful verifications
    logger.metric &&
      logger.metric("rodit_nep413_verification", totalDuration, {
        result: "success",
        message,
      });

    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Error in NEP-413 RODiT verification", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit_withnep413",
      requestId,
      duration,
      message,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for verification errors
    logger.metric &&
      logger.metric("rodit_nep413_verification_errors", 1, {
        error_type: error.name || "Unknown",
        message,
      });

    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error in verify_peerrodit_getrodit_withnep413: ${error.message}`,
    };
  }
}

async function verify_peerrodit_getrodit(
  peerroditid,
  peertimestamp,
  peerroditid_base64url_signature,
  own_rodit
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting peer RODiT verification", {
    component: "RoditAuth",
    method: "verify_peerrodit_getrodit",
    requestId,
    peerRoditId: peerroditid,
    timestamp: peertimestamp,
    signatureLength: peerroditid_base64url_signature?.length,
    hasOwnRodit: !!own_rodit,
    ownRoditId: own_rodit?.token_id,
  });

  try {
    logger.debug("Fetching peer RODiT from blockchain", {
      requestId,
      peerRoditId: peerroditid,
    });

    const tokenFetchStart = Date.now();
    const peer_rodit = await nearorg_rpc_tokenfromroditid(peerroditid);
    const tokenFetchDuration = Date.now() - tokenFetchStart;

    logger.debug("Received peer RODiT from blockchain", {
      requestId,
      tokenFetchDuration,
      hasPeerRodit: !!peer_rodit,
      peerRoditId: peer_rodit?.token_id,
      peerRoditOwnerId: peer_rodit?.owner_id,
      hasPeerRoditMetadata: peer_rodit && !!peer_rodit.metadata,
      metadataKeys:
        peer_rodit && peer_rodit.metadata
          ? Object.keys(peer_rodit.metadata)
          : [],
    });

    if (!peer_rodit) {
      logger.error("Failed to retrieve peer RODiT data", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        peerRoditId: peerroditid,
      });

      throw new Error("Failed to retrieve peer RODiT data");
    }

    if (!peer_rodit.metadata) {
      logger.error("Peer RODiT missing metadata", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        peerRoditId: peerroditid,
        peerRoditOwnerId: peer_rodit.owner_id,
      });

      throw new Error("Peer RODiT missing metadata");
    }

    logger.debug("Starting verification checks", {
      requestId,
      checks: ["ownership", "match", "live", "active", "trusted"],
    });

    // Initialize verification results
    let ownershipVerified, isaMatch, isLive, isActive, isTrusted;
    let verificationDetails = {};

    try {
      logger.debug("Verifying RODiT ownership", { requestId });
      const ownershipStart = Date.now();
      ownershipVerified = await verify_rodit_ownership(
        peerroditid,
        peertimestamp,
        peerroditid_base64url_signature,
        peer_rodit
      );
      verificationDetails.ownershipDuration = Date.now() - ownershipStart;
      logger.debug("Ownership verification result", {
        requestId,
        ownershipVerified,
        duration: verificationDetails.ownershipDuration,
      });
    } catch (ownershipError) {
      logger.error("Error during ownership verification", {
        requestId,
        error: ownershipError.message,
        stack: ownershipError.stack,
      });
      ownershipVerified = false;
      verificationDetails.ownershipError = ownershipError.message;
    }

    try {
      logger.debug("Verifying RODiT match", {
        requestId,
        serviceProviderId: own_rodit.metadata.serviceprovider_id,
      });
      const matchStart = Date.now();
      isaMatch = await verify_rodit_isamatch(
        own_rodit.metadata.serviceprovider_id,
        peer_rodit
      );
      verificationDetails.matchDuration = Date.now() - matchStart;
      logger.debug("Match verification result", {
        requestId,
        isaMatch,
        duration: verificationDetails.matchDuration,
      });
    } catch (matchError) {
      logger.error("Error during match verification", {
        requestId,
        error: matchError.message,
        stack: matchError.stack,
      });
      isaMatch = false;
      verificationDetails.matchError = matchError.message;
    }

    try {
      logger.debug("Verifying RODiT is live", {
        requestId,
        notAfter: peer_rodit.metadata.not_after,
        notBefore: peer_rodit.metadata.not_before,
      });

      const liveStart = Date.now();
      isLive = await verify_rodit_islive(
        peer_rodit.metadata.not_after,
        peer_rodit.metadata.not_before
      );
      verificationDetails.liveDuration = Date.now() - liveStart;
      logger.debug("Live verification result", {
        requestId,
        isLive,
        duration: verificationDetails.liveDuration,
      });
    } catch (liveError) {
      logger.error("Error during live verification", {
        requestId,
        error: liveError.message,
        stack: liveError.stack,
      });
      isLive = false;
      verificationDetails.liveError = liveError.message;
    }

    try {
      logger.debug("Verifying RODiT is active", {
        requestId,
        tokenId: peer_rodit.token_id,
        url: own_rodit.metadata.subjectuniqueidentifier_url,
      });
      const activeStart = Date.now();
      isActive = await verify_rodit_isactive(
        peer_rodit.token_id,
        own_rodit.metadata.subjectuniqueidentifier_url
      );
      verificationDetails.activeDuration = Date.now() - activeStart;
      logger.debug("Active verification result", {
        requestId,
        isActive,
        duration: verificationDetails.activeDuration,
      });
    } catch (activeError) {
      logger.error("Error during active verification", {
        requestId,
        error: activeError.message,
        stack: activeError.stack,
      });
      isActive = false;
      verificationDetails.activeError = activeError.message;
    }

    try {
      logger.debug("Verifying RODiT issuing smart contract is trusted", {
        requestId,
        url: own_rodit.metadata.subjectuniqueidentifier_url,
      });
      const trustedStart = Date.now();
      isTrusted = await verify_rodit_istrusted_issuingsmartcontract(
        own_rodit.metadata.subjectuniqueidentifier_url
      );
      verificationDetails.trustedDuration = Date.now() - trustedStart;
      logger.debug("Trust verification result", {
        requestId,
        isTrusted,
        duration: verificationDetails.trustedDuration,
      });
    } catch (trustError) {
      logger.error("Error during trust verification", {
        requestId,
        error: trustError.message,
        stack: trustError.stack,
      });
      isTrusted = false;
      verificationDetails.trustError = trustError.message;
    }

    // Log all verification results
    logger.debug("All verification results", {
      requestId,
      ownershipVerified,
      isaMatch,
      isLive,
      isActive,
      isTrusted,
      verificationDetails,
    });

    if (!ownershipVerified || !isaMatch || !isLive || !isActive || !isTrusted) {
      const failedChecks = [];
      if (!ownershipVerified) failedChecks.push("ownership");
      if (!isaMatch) failedChecks.push("match");
      if (!isLive) failedChecks.push("live");
      if (!isActive) failedChecks.push("active");
      if (!isTrusted) failedChecks.push("trusted");

      const duration = Date.now() - startTime;
      logger.error("Peer RODiT verification failed", {
        component: "RoditAuth",
        method: "verify_peerrodit_getrodit",
        requestId,
        duration,
        peerRoditId: peerroditid,
        failedChecks,
        verificationDetails,
      });

      // Add metrics for verification failures
      logger.metric &&
        logger.metric("rodit_verification_failures", 1, {
          failed_checks: failedChecks.join(","),
          peer_rodit_id: peerroditid,
        });

      logger.metric &&
        logger.metric("rodit_verification", duration, {
          result: "failure",
          peer_rodit_id: peerroditid,
        });

      throw new Error(
        `Error 037: Peer RODiT verification failed on: ${failedChecks.join(
          ", "
        )}`
      );
    }

    const totalDuration = Date.now() - startTime;

    logger.info("Peer RODiT verification successful", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit",
      requestId,
      duration: totalDuration,
      peerRoditId: peerroditid,
      peerOwnerId: peer_rodit.owner_id,
      verificationDetails,
    });

    // Add metrics for successful verifications
    logger.metric &&
      logger.metric("rodit_verification", totalDuration, {
        result: "success",
        peer_rodit_id: peerroditid,
      });

    return {
      peer_rodit,
      goodrodit: true,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Error in verify_peerrodit_getrodit", {
      component: "RoditAuth",
      method: "verify_peerrodit_getrodit",
      requestId,
      duration,
      peerRoditId: peerroditid,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for verification errors
    logger.metric &&
      logger.metric("rodit_verification_errors", 1, {
        error_type: error.name || "Unknown",
        peer_rodit_id: peerroditid,
      });

    return {
      peer_rodit: null,
      goodrodit: false,
      error: `Error in verify_peerrodit_getrodit: ${error.message}`,
    };
  }
}

async function verify_rodit_isamatch(own_service_provider_id, peer_rodit) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting RODiT match verification", {
    component: "RoditAuth",
    method: "verify_rodit_isamatch",
    requestId,
    ownServiceProviderId: own_service_provider_id,
    peerRoditId: peer_rodit?.token_id,
  });

  try {
    const own_provider_components = own_service_provider_id.split(";");

    logger.debug("Split provider components", {
      requestId,
      componentCount: own_provider_components.length,
      components: own_provider_components,
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
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        providerId: own_service_provider_id,
        components: own_provider_components,
        hasBlockchain: !!bcPart,
        hasSmartContract: !!scPart,
        idCount: idComponents.length,
      });

      // Add metrics for format errors
      logger.metric &&
        logger.metric("rodit_match_format_errors", 1, {
          error_type: "invalid_provider_id",
          bc_part_present: !!bcPart,
          sc_part_present: !!scPart,
          id_count: idComponents.length,
        });

      return false;
    }

    // Construct the base prefix
    const base_prefix = `${bcPart};${scPart}`;
    logger.debug("Constructed base prefix", {
      requestId,
      basePrefix: base_prefix,
    });

    // Try verification with each ID component
    for (let i = 0; i < idComponents.length; i++) {
      const idIndex = i + 1;
      const signing_token_id = `${base_prefix};${idComponents[i]}`;

      logger.debug(
        `Trying verification with ID [${idIndex}/${idComponents.length}]`,
        {
          requestId,
          idIndex,
          totalIds: idComponents.length,
          signingTokenId: signing_token_id,
        }
      );

      const tokenFetchStart = Date.now();
      const signing_rodit = await nearorg_rpc_tokenfromroditid(
        signing_token_id
      );
      const tokenFetchDuration = Date.now() - tokenFetchStart;

      logger.debug("Retrieved signing RODiT", {
        requestId,
        idIndex,
        tokenFetchDuration,
        tokenId: signing_rodit?.token_id,
        ownerId: signing_rodit?.owner_id,
      });

      // Process the owner ID
      try {
        const bytes_signing_owner_id = new Uint8Array(
          Buffer.from(signing_rodit.owner_id, "hex")
        );

        if (bytes_signing_owner_id.length !== CONSTANTS.RODIT_ID_PK_SZ) {
          logger.warn(`Invalid signing key length for ID ${idIndex}`, {
            requestId,
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
          logger.warn(`Invalid signature length for ID ${idIndex}`, {
            requestId,
            actual: bytes_signature.length,
            expected: CONSTANTS.RODIT_ID_SIGNATURE_SZ,
          });
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
          webhook_cidr: peer_rodit.metadata.webhook_cidr,
          allowed_cidr: peer_rodit.metadata.allowed_cidr,
          allowed_iso3166list: peer_rodit.metadata.allowed_iso3166list,
          jwt_duration: peer_rodit.metadata.jwt_duration,
          permissioned_routes: peer_rodit.metadata.permissioned_routes,
          serviceprovider_id: peer_rodit.metadata.serviceprovider_id,
          subjectuniqueidentifier_url:
            peer_rodit.metadata.subjectuniqueidentifier_url,
        };

        const hashStart = Date.now();
        const hashHex = calculateCanonicalHash(hashInput);
        const hashBytes = new Uint8Array(Buffer.from(hashHex, "hex"));
        const hashDuration = Date.now() - hashStart;

        logger.debug("Calculated hash for verification", {
          requestId,
          idIndex,
          hashDuration,
          hashLength: hashBytes.length,
        });

        // Verify the signature
        const verifyStart = Date.now();
        const is_valid = nacl.sign.detached.verify(
          hashBytes,
          bytes_signature,
          bytes_signing_owner_id
        );
        const verifyDuration = Date.now() - verifyStart;

        logger.debug("Signature verification result", {
          requestId,
          idIndex,
          verifyDuration,
          isValid: is_valid,
        });

        if (is_valid) {
          const totalDuration = Date.now() - startTime;

          // Log based on which ID worked
          if (i === 0) {
            logger.info("Partner login verified successfully", {
              component: "RoditAuth",
              method: "verify_rodit_isamatch",
              requestId,
              duration: totalDuration,
              partnerVerification: true,
              idIndex,
            });
          } else {
            logger.info("Peer login verified successfully", {
              component: "RoditAuth",
              method: "verify_rodit_isamatch",
              requestId,
              duration: totalDuration,
              peerVerification: true,
              idIndex,
            });
          }

          // Add metrics for successful matching
          logger.metric &&
            logger.metric("rodit_match_verification", totalDuration, {
              result: "success",
              id_index: idIndex,
              verification_type: i === 0 ? "partner" : "peer",
            });

          return true;
        }

        logger.debug(`Verification with ID ${idIndex} failed`, {
          requestId,
        });
      } catch (verifyError) {
        logger.warn(`Error during verification with ID ${idIndex}`, {
          requestId,
          error: verifyError.message,
          stack: verifyError.stack,
        });
      }
    }

    // If we get here, all verification attempts failed
    const totalDuration = Date.now() - startTime;

    logger.error("All verification attempts failed", {
      component: "RoditAuth",
      method: "verify_rodit_isamatch",
      requestId,
      duration: totalDuration,
      ownServiceProviderId: own_service_provider_id,
      peerRoditId: peer_rodit?.token_id,
      attemptCount: idComponents.length,
    });

    // Add metrics for failed matching
    logger.metric &&
      logger.metric("rodit_match_verification", totalDuration, {
        result: "failure",
        attempts: idComponents.length,
      });

    return false;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("RODiT match verification failed", {
      component: "RoditAuth",
      method: "verify_rodit_isamatch",
      requestId,
      duration,
      ownServiceProviderId: own_service_provider_id,
      peerRoditId: peer_rodit?.token_id,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for verification errors
    logger.metric &&
      logger.metric("rodit_match_errors", 1, {
        error_type: error.name || "Unknown",
      });

    return false;
  }
}

async function verify_rodit_isactive(tokenId, ownsubjectuniqueidentifier_url) {
  const requestId = ulid();
  const startTime = Date.now();

  // WHILE DEBUGGING TEMPORARY FIX DO NOT REMOVE THIS LINE EVER WITHOUT PERMISSION
  return true;

  logger.debug("Checking RODiT activity status", {
    component: "RoditAuth",
    method: "verify_rodit_isactive",
    requestId,
    tokenId,
    subjectUrl: ownsubjectuniqueidentifier_url,
  });

  const domainandextensionRegex =
    /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

  const match = ownsubjectuniqueidentifier_url.match(domainandextensionRegex);

  if (match) {
    const domainandextension = match[1];
    const revokingDnsEntry = `${tokenId}.revoked.${domainandextension}`;

    logger.debug("Checking DNS revocation entry", {
      requestId,
      domain: domainandextension,
      revokingDnsEntry,
    });

    try {
      const dnsStart = Date.now();
      await resolver.resolveTxt(revokingDnsEntry);
      const dnsDuration = Date.now() - dnsStart;
      const totalDuration = Date.now() - startTime;

      logger.info("RODiT revocation found", {
        component: "RoditAuth",
        method: "verify_rodit_isactive",
        requestId,
        duration: totalDuration,
        dnsDuration,
        tokenId,
        domain: domainandextension,
        revokingDnsEntry,
        isActive: false,
      });

      // Add metrics for revoked tokens
      logger.metric &&
        logger.metric("rodit_revocation_checks", totalDuration, {
          result: "revoked",
          token_id: tokenId,
        });

      return false;
    } catch (error) {
      // DNS error usually means no revocation entry found, which is good
      const dnsDuration = Date.now() - dnsStart || 0;
      const totalDuration = Date.now() - startTime;

      logger.debug("No revocation found for RODiT", {
        requestId,
        dnsDuration,
        tokenId,
        error: error.code,
      });

      logger.info("RODiT is active", {
        component: "RoditAuth",
        method: "verify_rodit_isactive",
        requestId,
        duration: totalDuration,
        dnsDuration,
        tokenId,
        domain: domainandextension,
        isActive: true,
      });

      // Add metrics for active tokens
      logger.metric &&
        logger.metric("rodit_revocation_checks", totalDuration, {
          result: "active",
          token_id: tokenId,
        });

      return true;
    }
  } else {
    const duration = Date.now() - startTime;

    logger.warn("Unable to parse domain from URL", {
      component: "RoditAuth",
      method: "verify_rodit_isactive",
      requestId,
      duration,
      tokenId,
      subjectUrl: ownsubjectuniqueidentifier_url,
    });

    // Add metrics for parsing errors
    logger.metric &&
      logger.metric("rodit_revocation_checks", duration, {
        result: "parse_error",
        token_id: tokenId,
      });

    // Default to allowing the token if domain parsing fails
    return true;
  }
}

async function verify_rodit_istrusted_issuingsmartcontract(
  ownsubjectuniqueidentifier_url
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Verifying smart contract trust", {
    component: "RoditAuth",
    method: "verify_rodit_istrusted_issuingsmartcontract",
    requestId,
    url: ownsubjectuniqueidentifier_url,
    smartContract: CONSTANTS.SMART_CONTRACT,
  });

  try {
    const smartcontract = CONSTANTS.SMART_CONTRACT;
    const smartontractnonear = smartcontract.replace(".testnet", "");
    const smartcontracturl = smartontractnonear.replace("-", ".");

    logger.debug("Prepared smart contract identifiers", {
      requestId,
      originalContract: smartcontract,
      nonearContract: smartontractnonear,
      urlContract: smartcontracturl,
    });

    const domainRegex =
      /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/i;

    const maindomainmatch = domainRegex.exec(ownsubjectuniqueidentifier_url);

    if (!maindomainmatch) {
      logger.error("Failed to parse domain from URL", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        url: ownsubjectuniqueidentifier_url,
      });

      // Add metrics for domain parsing failures
      logger.metric &&
        logger.metric("rodit_trust_errors", 1, {
          error_type: "domain_parse_error",
          url: ownsubjectuniqueidentifier_url,
        });

      throw new Error(
        `Domain can't be parsed from URL: ${ownsubjectuniqueidentifier_url}`
      );
    }

    const extractedDomain = maindomainmatch[1];
    const enablingdnsentry = `${smartontractnonear}.smartcontract.${extractedDomain}`;

    logger.debug("Checking DNS trust entry", {
      requestId,
      extractedDomain,
      enablingDnsEntry: enablingdnsentry,
    });

    try {
      const dnsStart = Date.now();
      const cfgresponse = await resolver.resolveTxt(enablingdnsentry);
      const dnsDuration = Date.now() - dnsStart;

      logger.debug("DNS response received", {
        requestId,
        dnsDuration,
        recordCount: cfgresponse?.length || 0,
      });

      if (cfgresponse.length > 0) {
        const totalDuration = Date.now() - startTime;

        logger.info("Smart contract is trusted", {
          component: "RoditAuth",
          method: "verify_rodit_istrusted_issuingsmartcontract",
          requestId,
          duration: totalDuration,
          dnsDuration,
          smartContract: smartcontracturl,
          domain: extractedDomain,
          dnsEntry: enablingdnsentry,
          recordCount: cfgresponse.length,
          isTrusted: true,
        });

        // Add metrics for trusted contracts
        logger.metric &&
          logger.metric("rodit_trust_checks", totalDuration, {
            result: "trusted",
            domain: extractedDomain,
          });

        return true;
      } else {
        const totalDuration = Date.now() - startTime;

        logger.warn("Smart contract not trusted - empty DNS record", {
          component: "RoditAuth",
          method: "verify_rodit_istrusted_issuingsmartcontract",
          requestId,
          duration: totalDuration,
          dnsDuration,
          smartContract: smartcontracturl,
          domain: extractedDomain,
          dnsEntry: enablingdnsentry,
          isTrusted: false,
        });

        // Add metrics for untrusted contracts
        logger.metric &&
          logger.metric("rodit_trust_checks", totalDuration, {
            result: "empty_dns",
            domain: extractedDomain,
          });

        return false;
      }
    } catch (error) {
      const totalDuration = Date.now() - startTime;

      logger.warn("Smart contract not trusted - DNS lookup failed", {
        component: "RoditAuth",
        method: "verify_rodit_istrusted_issuingsmartcontract",
        requestId,
        duration: totalDuration,
        smartContract: smartcontracturl,
        domain: extractedDomain,
        dnsEntry: enablingdnsentry,
        dnsError: error.code,
        isTrusted: false,
      });

      // Add metrics for DNS errors
      logger.metric &&
        logger.metric("rodit_trust_checks", totalDuration, {
          result: "dns_error",
          domain: extractedDomain,
          error_code: error.code,
        });

      return false;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Trust verification failed", {
      component: "RoditAuth",
      method: "verify_rodit_istrusted_issuingsmartcontract",
      requestId,
      duration,
      url: ownsubjectuniqueidentifier_url,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for verification errors
    logger.metric &&
      logger.metric("rodit_trust_errors", 1, {
        error_type: error.name || "Unknown",
        message: error.message,
      });

    return false;
  }
}

async function verify_rodit_islive(peer_rodit_notafter, peer_rodit_notbefore) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Checking RODiT time validity", {
    component: "RoditAuth",
    method: "verify_rodit_islive",
    requestId,
    notAfter: peer_rodit_notafter,
    notBefore: peer_rodit_notbefore,
  });

  function parseDate(datestring) {
    const date = new Date(datestring);
    return isNaN(date.getTime()) ? new Date(0) : date;
  }

  const datetimenul = new Date(0);
  const datetimenotafter = parseDate(peer_rodit_notafter);
  const datetimenotbefore = parseDate(peer_rodit_notbefore);

  logger.debug("Parsed validity dates", {
    requestId,
    parsedNotAfter: datetimenotafter.toISOString(),
    parsedNotBefore: datetimenotbefore.toISOString(),
    isNotAfterNull: datetimenotafter.getTime() === datetimenul.getTime(),
    isNotBeforeNull: datetimenotbefore.getTime() === datetimenul.getTime(),
  });

  try {
    const rpcStart = Date.now();
    const stringtimenow = await nearorg_rpc_timestamp();
    const rpcDuration = Date.now() - rpcStart;

    logger.debug("Retrieved blockchain timestamp", {
      requestId,
      rpcDuration,
      blockchainTimestamp: stringtimenow,
    });

    const timestamp = parseInt(stringtimenow, 10);

    if (isNaN(timestamp)) {
      logger.error("Failed to parse blockchain timestamp", {
        component: "RoditAuth",
        requestId,
        duration: Date.now() - startTime,
        blockchainTimestamp: stringtimenow,
      });

      // Add metrics for timestamp parsing errors
      logger.metric &&
        logger.metric("rodit_islive_errors", 1, {
          error_type: "timestamp_parse_error",
          blockchain_timestamp: stringtimenow,
        });

      return false;
    }

    const datetimetimestamp = new Date(timestamp / 1000000); // Convert nanoseconds to milliseconds

    logger.debug("Converted blockchain time", {
      requestId,
      blockchainTime: datetimetimestamp.toISOString(),
      originalTimestamp: timestamp,
    });

    const isAfterNotBefore =
      datetimetimestamp >= datetimenotbefore ||
      datetimenotbefore.getTime() === datetimenul.getTime();

    const isBeforeNotAfter =
      datetimetimestamp <= datetimenotafter ||
      datetimenotafter.getTime() === datetimenul.getTime();

    const isLive = isAfterNotBefore && isBeforeNotAfter;

    const totalDuration = Date.now() - startTime;

    if (isLive) {
      logger.info("RODiT is live", {
        component: "RoditAuth",
        method: "verify_rodit_islive",
        requestId,
        duration: totalDuration,
        rpcDuration,
        currentTime: datetimetimestamp.toISOString(),
        notBefore: datetimenotbefore.toISOString(),
        notAfter: datetimenotafter.toISOString(),
        isLive: true,
      });

      // Add metrics for live tokens
      logger.metric &&
        logger.metric("rodit_time_checks", totalDuration, {
          result: "live",
        });

      return true;
    } else {
      logger.warn("RODiT is not live - outside valid time period", {
        component: "RoditAuth",
        method: "verify_rodit_islive",
        requestId,
        duration: totalDuration,
        rpcDuration,
        currentTime: datetimetimestamp.toISOString(),
        notBefore: datetimenotbefore.toISOString(),
        notAfter: datetimenotafter.toISOString(),
        isBeforeExpiry: isBeforeNotAfter,
        isAfterStart: isAfterNotBefore,
        isLive: false,
      });

      // Add metrics for expired or not-yet-valid tokens
      logger.metric &&
        logger.metric("rodit_time_checks", totalDuration, {
          result: "not_live",
          not_before_valid: isAfterNotBefore,
          not_after_valid: isBeforeNotAfter,
        });

      return false;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to check RODiT time validity", {
      component: "RoditAuth",
      method: "verify_rodit_islive",
      requestId,
      duration,
      notAfter: peer_rodit_notafter,
      notBefore: peer_rodit_notbefore,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for validation errors
    logger.metric &&
      logger.metric("rodit_islive_errors", 1, {
        error_type: error.name || "Unknown",
      });

    return false;
  }
}

async function brief_validate_jwt_token_be(token) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting brief JWT token validation", {
    component: "JwtAuth",
    method: "brief_validate_jwt_token_be",
    requestId,
    tokenAud: token?.aud,
    tokenJti: token?.jti,
  });

  try {
    const tokenFetchStart = Date.now();
    const peer_rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      token.aud
    );
    const tokenFetchDuration = Date.now() - tokenFetchStart;

    logger.debug("Retrieved peer RODiT", {
      requestId,
      tokenFetchDuration,
      peerRoditId: peer_rodit?.token_id,
      peerRoditOwnerId: peer_rodit?.owner_id,
    });

    const subParts = token.sub.split(";sub=");
    const extractedSub = subParts.length > 1 ? subParts[1] : "";

    logger.debug("Extracted subject from token", {
      requestId,
      extractedSub,
      tokenSub: token.sub,
    });

    const isValid =
      peer_rodit.token_id === extractedSub && peer_rodit.owner_id === token.aud;

    const totalDuration = Date.now() - startTime;

    if (isValid) {
      logger.info("Brief token validation successful", {
        component: "JwtAuth",
        method: "brief_validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        tokenFetchDuration,
        tokenJti: token.jti,
        peerRoditId: peer_rodit.token_id,
        notAfter: peer_rodit.metadata.not_after,
      });

      // Add metrics for successful brief validations
      logger.metric &&
        logger.metric("jwt_brief_validation", totalDuration, {
          result: "success",
          token_jti: token.jti || "unknown",
        });
    } else {
      logger.warn("Brief token validation failed", {
        component: "JwtAuth",
        method: "brief_validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        tokenFetchDuration,
        tokenJti: token.jti,
        peerRoditId: peer_rodit.token_id,
        extractedSub,
        tokenAud: token.aud,
        peerRoditOwnerId: peer_rodit.owner_id,
        idMatch: peer_rodit.token_id === extractedSub,
        ownerMatch: peer_rodit.owner_id === token.aud,
      });

      // Add metrics for failed brief validations
      logger.metric &&
        logger.metric("jwt_brief_validation", totalDuration, {
          result: "failure",
          token_jti: token.jti || "unknown",
          id_match: peer_rodit.token_id === extractedSub ? "true" : "false",
          owner_match: peer_rodit.owner_id === token.aud ? "true" : "false",
        });
    }

    return {
      isValid,
      notAfter: peer_rodit.metadata.not_after,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Brief token validation failed with error", {
      component: "JwtAuth",
      method: "brief_validate_jwt_token_be",
      requestId,
      duration,
      tokenAud: token?.aud,
      tokenJti: token?.jti,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for brief validation errors
    logger.metric &&
      logger.metric("jwt_brief_validation_errors", 1, {
        error_type: error.name || "Unknown",
        token_jti: token.jti || "unknown",
      });

    return {
      isValid: false,
      notAfter: null,
    };
  }
}

async function thorough_validate_jwt_token_be(token) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting thorough JWT token validation", {
    component: "JwtAuth",
    method: "thorough_validate_jwt_token_be",
    requestId,
    tokenAud: token?.aud,
    tokenJti: token?.jti,
  });

  try {
    const configStart = Date.now();
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    const configDuration = Date.now() - configStart;

    logger.debug("Retrieved configuration", {
      requestId,
      configDuration,
      hasConfig: !!config_own_rodit,
    });

    const tokenFetchStart = Date.now();
    const peer_rodit = await nearorg_rpc_tokenfromroditid(token.aud);
    const tokenFetchDuration = Date.now() - tokenFetchStart;

    logger.debug("Retrieved peer RODiT", {
      requestId,
      tokenFetchDuration,
      peerRoditId: peer_rodit?.token_id,
      peerRoditOwnerId: peer_rodit?.owner_id,
    });

    logger.debug("Starting comprehensive verification checks", {
      requestId,
      checks: ["match", "live", "active", "trusted"],
    });

    const verificationStart = Date.now();
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
    const verificationDuration = Date.now() - verificationStart;

    logger.debug("Verification results", {
      requestId,
      verificationDuration,
      isaMatch,
      isLive,
      isActive,
      isTrusted,
    });

    if (!isaMatch || !isLive || !isActive || !isTrusted) {
      const failedChecks = [];
      if (!isaMatch) failedChecks.push("match");
      if (!isLive) failedChecks.push("live");
      if (!isActive) failedChecks.push("active");
      if (!isTrusted) failedChecks.push("trusted");

      const totalDuration = Date.now() - startTime;

      logger.warn("Comprehensive RODiT verification failed", {
        component: "JwtAuth",
        method: "thorough_validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        tokenJti: token.jti,
        failedChecks,
        peerRoditId: peer_rodit.token_id,
      });

      // Add metrics for failed thorough validations
      logger.metric &&
        logger.metric("jwt_thorough_validation", totalDuration, {
          result: "verification_failed",
          token_jti: token.jti || "unknown",
          failed_checks: failedChecks.join(","),
        });

      return {
        isValid: false,
        notAfter: peer_rodit.metadata.not_after,
      };
    }

    const subParts = token.sub.split(";sub=");
    const extractedSub = subParts.length > 1 ? subParts[1] : "";

    logger.debug("Extracted subject from token", {
      requestId,
      extractedSub,
      tokenSub: token.sub,
    });

    const isValid =
      peer_rodit.token_id === extractedSub && peer_rodit.owner_id === token.aud;

    const totalDuration = Date.now() - startTime;

    if (isValid) {
      logger.info("Thorough token validation successful", {
        component: "JwtAuth",
        method: "thorough_validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        configDuration,
        tokenFetchDuration,
        verificationDuration,
        tokenJti: token.jti,
        peerRoditId: peer_rodit.token_id,
        notAfter: peer_rodit.metadata.not_after,
      });

      // Add metrics for successful thorough validations
      logger.metric &&
        logger.metric("jwt_thorough_validation", totalDuration, {
          result: "success",
          token_jti: token.jti || "unknown",
        });
    } else {
      logger.warn("Token identity verification failed", {
        component: "JwtAuth",
        method: "thorough_validate_jwt_token_be",
        requestId,
        duration: totalDuration,
        tokenJti: token.jti,
        extractedSub,
        peerRoditId: peer_rodit.token_id,
        tokenAud: token.aud,
        peerRoditOwnerId: peer_rodit.owner_id,
        idMatch: peer_rodit.token_id === extractedSub,
        ownerMatch: peer_rodit.owner_id === token.aud,
      });

      // Add metrics for identity mismatch
      logger.metric &&
        logger.metric("jwt_thorough_validation", totalDuration, {
          result: "identity_mismatch",
          token_jti: token.jti || "unknown",
          id_match: peer_rodit.token_id === extractedSub ? "true" : "false",
          owner_match: peer_rodit.owner_id === token.aud ? "true" : "false",
        });
    }

    return {
      isValid,
      notAfter: peer_rodit.metadata.not_after,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Thorough token validation failed with error", {
      component: "JwtAuth",
      method: "thorough_validate_jwt_token_be",
      requestId,
      duration,
      tokenAud: token?.aud,
      tokenJti: token?.jti,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for thorough validation errors
    logger.metric &&
      logger.metric("jwt_thorough_validation_errors", 1, {
        error_type: error.name || "Unknown",
        token_jti: token.jti || "unknown",
      });

    return {
      isValid: false,
      notAfter: null,
    };
  }
}

function hex2base64url(hexString) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Converting hex to base64url", {
    component: "Conversion",
    method: "hex2base64url",
    requestId,
    hexStringLength: hexString?.length,
  });

  try {
    if (!hexString || typeof hexString !== "string") {
      logger.warn("Invalid input for hex2base64url", {
        component: "Conversion",
        requestId,
        inputType: typeof hexString,
        input: hexString,
      });

      // Add metrics for invalid inputs
      logger.metric &&
        logger.metric("hex_conversion_errors", 1, {
          error_type: "invalid_input",
        });

      return "";
    }

    // Validate hex format
    const hexPattern = /^[0-9a-f]+$/i;
    if (!hexPattern.test(hexString)) {
      logger.warn("Input is not valid hex", {
        component: "Conversion",
        requestId,
        hexStringLength: hexString.length,
      });

      // Add metrics for invalid hex
      logger.metric &&
        logger.metric("hex_conversion_errors", 1, {
          error_type: "invalid_hex",
        });

      return "";
    }

    // Step 1: Convert hex to Uint8Array
    const matchStart = Date.now();
    const hexChunks = hexString.match(/.{1,2}/g);
    const matchDuration = Date.now() - matchStart;

    const arrayStart = Date.now();
    const bytes = new Uint8Array(hexChunks.map((byte) => parseInt(byte, 16)));
    const arrayDuration = Date.now() - arrayStart;

    logger.debug("Converted hex to bytes", {
      requestId,
      matchDuration,
      arrayDuration,
      bytesLength: bytes.length,
    });

    // Step 2: Convert Uint8Array to base64
    const base64Start = Date.now();
    const base64 = btoa(String.fromCharCode.apply(null, bytes));
    const base64Duration = Date.now() - base64Start;

    logger.debug("Converted bytes to base64", {
      requestId,
      base64Duration,
      base64Length: base64.length,
    });

    // Step 3: Convert base64 to base64url
    const urlStart = Date.now();
    const base64url = base64
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const urlDuration = Date.now() - urlStart;

    const totalDuration = Date.now() - startTime;

    logger.info("Hex to base64url conversion complete", {
      component: "Conversion",
      method: "hex2base64url",
      requestId,
      duration: totalDuration,
      matchDuration,
      arrayDuration,
      base64Duration,
      urlDuration,
      inputLength: hexString.length,
      outputLength: base64url.length,
    });

    // Add metrics for successful conversions
    logger.metric &&
      logger.metric("hex_conversions", totalDuration, {
        result: "success",
        input_size: hexString.length,
      });

    return base64url;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Error in hex2base64url conversion", {
      component: "Conversion",
      method: "hex2base64url",
      requestId,
      duration,
      hexStringLength: hexString?.length,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for conversion errors
    logger.metric &&
      logger.metric("hex_conversion_errors", 1, {
        error_type: error.name || "Unknown",
      });

    return "";
  }
}

async function generate_jwt_token(
  peer_rodit,
  peer_timestamp,
  own_rodit,
  own_rodit_bytes_private_key
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting JWT token generation", {
    component: "JwtAuth",
    method: "generate_jwt_token",
    requestId,
    peerRoditId: peer_rodit?.token_id,
    peerTimestamp: peer_timestamp,
    ownRoditId: own_rodit?.token_id,
  });

  try {
    const now = peer_timestamp;

    const notafterStart = Date.now();
    const notafter = await dateStringToUnixTime(peer_rodit.metadata.not_after);
    const notafterDuration = Date.now() - notafterStart;

    const duration = parseInt(peer_rodit.metadata.jwt_duration, 10);
    let expiresat = now;

    logger.debug("Calculated token parameters", {
      requestId,
      now,
      notafter,
      duration,
      notafterDuration,
    });

    if (now + duration < notafter) {
      // FOR TESTING PURPOSES, expiration /100
      expiresat = parseInt(now) + parseInt(peer_rodit.metadata.jwt_duration);

      logger.debug("Token expiration time valid", {
        requestId,
        expiresat,
        validFor: expiresat - now,
      });
    } else {
      logger.error("RODiT duration check failed", {
        component: "JwtAuth",
        requestId,
        duration: Date.now() - startTime,
        now,
        duration,
        notafter,
        calculatedExpiry: now + duration,
        difference: now + duration - notafter,
      });

      // Add metrics for duration validation failures
      logger.metric &&
        logger.metric("jwt_token_generation_failures", 1, {
          reason: "duration_check_failed",
          peer_rodit_id: peer_rodit.token_id,
        });

      throw new Error("RODiT duration check failed");
    }

    const notbeforeStart = Date.now();
    const notbefore = await dateStringToUnixTime(own_rodit.metadata.not_before);
    const notbeforeDuration = Date.now() - notbeforeStart;

    logger.debug("Retrieved not-before time", {
      requestId,
      notbefore,
      notbeforeDuration,
    });

    const encodeStart = Date.now();
    const timeString = await unixTimeToDateString(peer_timestamp);
    const roditidandtimestamp = new TextEncoder().encode(
      own_rodit.token_id + timeString
    );
    const encodeDuration = Date.now() - encodeStart;

    logger.debug("Encoded RODiT ID and timestamp", {
      requestId,
      encodeDuration,
      roditIdLength: own_rodit.token_id.length,
      timestampLength: timeString.length,
      totalLength: roditidandtimestamp.length,
    });

    const signatureStart = Date.now();
    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      own_rodit_bytes_private_key
    );
    const signatureDuration = Date.now() - signatureStart;

    logger.debug("Created signature", {
      requestId,
      signatureDuration,
      signatureLength: own_rodit_bytes_signature.length,
    });

    const base64Start = Date.now();
    const own_roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");
    const base64Duration = Date.now() - base64Start;

    logger.debug("Converted signature to base64url", {
      requestId,
      base64Duration,
      base64Length: own_roditid_base64url_signature.length,
    });

    const keyStart = Date.now();
    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const keyDuration = Date.now() - keyStart;

    logger.debug("Created private key object", {
      requestId,
      keyDuration,
    });

    logger.debug("Preparing JWT payload", {
      requestId,
      issuer: peer_rodit.metadata.subjectuniqueidentifier_url,
      audience: peer_rodit.owner_id,
      notBefore: notbefore,
      expiration: expiresat,
      issuedAt: peer_timestamp,
    });

    const jwtId = "jti" + ulid();
    const jwtSignStart = Date.now();
    const token = await new SignJWT({
      iss: peer_rodit.metadata.subjectuniqueidentifier_url,
      sub:
        peer_rodit.metadata.serviceprovider_id + ";sub=" + peer_rodit.token_id,
      aud: peer_rodit.owner_id,
      exp: expiresat,
      nbf: notbefore,
      iat: peer_timestamp,
      jti: jwtId,
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
    const jwtSignDuration = Date.now() - jwtSignStart;

    const totalDuration = Date.now() - startTime;

    logger.info("JWT token generation successful", {
      component: "JwtAuth",
      method: "generate_jwt_token",
      requestId,
      duration: totalDuration,
      notafterDuration,
      notbeforeDuration,
      encodeDuration,
      signatureDuration,
      base64Duration,
      keyDuration,
      jwtSignDuration,
      peerRoditId: peer_rodit.token_id,
      ownRoditId: own_rodit.token_id,
      jwtId,
      validFor: expiresat - peer_timestamp,
    });

    // Add metrics for successful token generation
    logger.metric &&
      logger.metric("jwt_token_generation", totalDuration, {
        result: "success",
        peer_rodit_id: peer_rodit.token_id,
        valid_seconds: expiresat - peer_timestamp,
      });

    return token;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to generate JWT token", {
      component: "JwtAuth",
      method: "generate_jwt_token",
      requestId,
      duration,
      peerRoditId: peer_rodit?.token_id,
      ownRoditId: own_rodit?.token_id,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for token generation errors
    logger.metric &&
      logger.metric("jwt_token_generation_errors", 1, {
        error_type: error.name || "Unknown",
        peer_rodit_id: peer_rodit?.token_id || "unknown",
      });

    throw error;
  }
}

async function generate_jwt_token_fromtoken(
  token,
  duration,
  notafter,
  timestamp
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting token renewal process", {
    component: "JwtAuth",
    method: "generate_jwt_token_fromtoken",
    requestId,
    tokenJti: token?.jti,
    duration,
    notAfter: notafter,
    timestamp,
  });

  try {
    const now = Math.floor(Date.now() / 1000);
    const tokenexpiration = duration + now;
    const notafterunixtime = await dateStringToUnixTime(notafter);

    logger.debug("Calculated expiration times", {
      requestId,
      now,
      tokenExpiration: tokenexpiration,
      notAfterUnixTime: notafterunixtime,
      willExpireBefore: tokenexpiration <= notafterunixtime,
    });

    if (tokenexpiration <= notafterunixtime) {
      logger.debug("Token expiration time valid", {
        requestId,
        tokenExpiration: tokenexpiration,
        expiresIn: tokenexpiration - now,
      });
    } else {
      logger.warn("Token renewal failed - RODiT expired", {
        component: "JwtAuth",
        requestId,
        duration: Date.now() - startTime,
        notAfterUnixTime: notafterunixtime,
        tokenExpiration: tokenexpiration,
        difference: tokenexpiration - notafterunixtime,
      });

      // Add metrics for expired RODiT renewal attempts
      logger.metric &&
        logger.metric("jwt_token_renewal_failures", 1, {
          reason: "rodit_expired",
          token_jti: token.jti || "unknown",
        });

      throw new Error("RODiT has expired");
    }

    const configStart = Date.now();
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    const configDuration = Date.now() - configStart;

    logger.debug("Retrieved configuration", {
      requestId,
      configDuration,
      hasConfig: !!config_own_rodit,
    });

    const keyCreationStart = Date.now();
    const own_rodit_keyobject_private_key = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        config_own_rodit.own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const keyCreationDuration = Date.now() - keyCreationStart;

    logger.debug("Created private key object", {
      requestId,
      keyCreationDuration,
    });

    const jwtCreateStart = Date.now();
    const jwtId = "jti" + ulid();
    const newtoken = await new SignJWT({
      iss: token.iss,
      sub: token.sub,
      aud: token.aud,
      exp: tokenexpiration,
      nbf: token.nbf,
      iat: now,
      jti: jwtId,
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
    const jwtCreateDuration = Date.now() - jwtCreateStart;

    const totalDuration = Date.now() - startTime;

    logger.info("JWT token renewal successful", {
      component: "JwtAuth",
      method: "generate_jwt_token_fromtoken",
      requestId,
      duration: totalDuration,
      configDuration,
      keyCreationDuration,
      jwtCreateDuration,
      tokenJti: token.jti,
      newTokenJti: jwtId,
      newTokenExpiration: tokenexpiration,
      validFor: tokenexpiration - now,
    });

    // Add metrics for successful token renewals
    logger.metric &&
      logger.metric("jwt_token_renewals", totalDuration, {
        result: "success",
        valid_seconds: tokenexpiration - now,
      });

    return newtoken;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to generate new JWT token", {
      component: "JwtAuth",
      method: "generate_jwt_token_fromtoken",
      requestId,
      duration,
      tokenJti: token.jti,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });

    // Add metrics for token generation errors
    logger.metric &&
      logger.metric("jwt_token_renewal_errors", 1, {
        error_type: error.name || "Unknown",
        token_jti: token.jti || "unknown",
      });

    throw error;
  }
}

/**
 * NEAR Blockchain Functions
 */
async function nearorg_rpc_fetchpublickeybytes(accountId) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching public key bytes", {
    component: "BlockchainService",
    method: "nearorg_rpc_fetchpublickeybytes",
    requestId,
    accountId,
  });

  try {
    const isImplicitAccount = /^[0-9a-f]{64}$/.test(accountId);

    if (isImplicitAccount) {
      logger.debug("Account is implicit, using direct hex encoding", {
        component: "BlockchainService",
        method: "nearorg_rpc_fetchpublickeybytes",
        requestId,
        accountId,
      });

      const result = new Uint8Array(Buffer.from(accountId, "hex"));

      const duration = Date.now() - startTime;
      logger.debug(
        "Successfully retrieved public key bytes from implicit account",
        {
          component: "BlockchainService",
          method: "nearorg_rpc_fetchpublickeybytes",
          requestId,
          accountId,
          duration,
          keyLength: result.length,
        }
      );

      // Emit metrics for Grafana dashboards
      logger.metric("public_key_fetch_duration_ms", duration, {
        method: "direct_hex",
        component: "BlockchainService",
        success: true,
      });

      return result;
    }

    logger.debug("Account is named, fetching RODiT token", {
      component: "BlockchainService",
      method: "nearorg_rpc_fetchpublickeybytes",
      requestId,
      accountId,
    });

    const rodit = await nearorg_rpc_tokensfromaccountid(
      CONSTANTS.SMART_CONTRACT,
      accountId
    );

    if (!rodit || !rodit.owner_id) {
      const duration = Date.now() - startTime;
      logger.error("No valid RODiT found for account", {
        component: "BlockchainService",
        method: "nearorg_rpc_fetchpublickeybytes",
        requestId,
        accountId,
        duration,
        error: "NO_VALID_RODIT",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("public_key_fetch_duration_ms", duration, {
        method: "rodit_lookup",
        component: "BlockchainService",
        success: false,
        error: "NO_VALID_RODIT",
      });
      logger.metric("public_key_fetch_errors_total", 1, {
        method: "rodit_lookup",
        component: "BlockchainService",
        error: "NO_VALID_RODIT",
      });

      throw new Error(`No valid RODiT found for account: ${accountId}`);
    }

    const result = new Uint8Array(Buffer.from(rodit.owner_id, "hex"));

    const duration = Date.now() - startTime;
    logger.debug("Successfully retrieved public key bytes from RODiT", {
      component: "BlockchainService",
      method: "nearorg_rpc_fetchpublickeybytes",
      requestId,
      accountId,
      duration,
      keyLength: result.length,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("public_key_fetch_duration_ms", duration, {
      method: "rodit_lookup",
      component: "BlockchainService",
      success: true,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to fetch public key bytes", {
      component: "BlockchainService",
      method: "nearorg_rpc_fetchpublickeybytes",
      requestId,
      accountId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("public_key_fetch_duration_ms", duration, {
      component: "BlockchainService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("public_key_fetch_errors_total", 1, {
      component: "BlockchainService",
      error: error.constructor.name,
    });

    throw new Error(`Error retrieving public key: ${error.message}`);
  }
}

async function nearorg_rpc_timestamp() {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching blockchain timestamp", {
    component: "BlockchainService",
    method: "nearorg_rpc_timestamp",
    requestId,
  });

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
    logger.debug("Sending RPC request for blockchain timestamp", {
      component: "BlockchainService",
      method: "nearorg_rpc_timestamp",
      requestId,
      rpcUrl: url,
      rpcMethod: "block",
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;

      logger.error("HTTP error from blockchain RPC", {
        component: "BlockchainService",
        method: "nearorg_rpc_timestamp",
        requestId,
        duration,
        status: response.status,
        statusText: response.statusText,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("blockchain_timestamp_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "HTTP_ERROR",
        status: response.status,
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "timestamp",
        error: "HTTP_ERROR",
        status: response.status,
      });

      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const parsedJson = await response.json();

    if (parsedJson.error) {
      const duration = Date.now() - startTime;

      logger.error("RPC error in blockchain response", {
        component: "BlockchainService",
        method: "nearorg_rpc_timestamp",
        requestId,
        duration,
        rpcError: parsedJson.error.message,
        rpcCode: parsedJson.error.code || "UNKNOWN",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("blockchain_timestamp_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "RPC_ERROR",
        rpcCode: parsedJson.error.code || "UNKNOWN",
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "timestamp",
        error: "RPC_ERROR",
        rpcCode: parsedJson.error.code || "UNKNOWN",
      });

      throw new Error(`Error 017: ${parsedJson.error.message}`);
    }

    const timestamp = parsedJson.result?.header?.timestamp;
    const result = timestamp ? timestamp.toString() : "0";

    const duration = Date.now() - startTime;
    logger.debug("Successfully retrieved blockchain timestamp", {
      component: "BlockchainService",
      method: "nearorg_rpc_timestamp",
      requestId,
      duration,
      timestamp: result,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("blockchain_timestamp_duration_ms", duration, {
      component: "BlockchainService",
      success: true,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to retrieve blockchain timestamp", {
      component: "BlockchainService",
      method: "nearorg_rpc_timestamp",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("blockchain_timestamp_duration_ms", duration, {
      component: "BlockchainService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("blockchain_rpc_errors_total", 1, {
      component: "BlockchainService",
      method: "timestamp",
      error: error.constructor.name,
    });

    throw error;
  }
}

async function nearorg_rpc_tokenfromroditid(roditid) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching RODiT token by ID", {
    component: "BlockchainService",
    method: "nearorg_rpc_tokenfromroditid",
    requestId,
    roditId: roditid,
  });

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

    logger.debug("Sending RPC request for RODiT token", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokenfromroditid",
      requestId,
      smartContract: CONSTANTS.SMART_CONTRACT,
      contractMethod: "rodit_token",
    });

    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(json_data),
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;

      logger.error("HTTP error from RPC endpoint", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokenfromroditid",
        requestId,
        duration,
        status: response.status,
        statusText: response.statusText,
        roditId: roditid,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_token_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "HTTP_ERROR",
        status: response.status,
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "token_from_id",
        error: "HTTP_ERROR",
        status: response.status,
      });

      return new RODiT();
    }

    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);

    if (parsedJson.result && parsedJson.result.error) {
      const duration = Date.now() - startTime;

      logger.error("WASM execution error from blockchain", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokenfromroditid",
        requestId,
        duration,
        wasmError: parsedJson.result.error,
        roditId: roditid,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_token_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "WASM_ERROR",
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "token_from_id",
        error: "WASM_ERROR",
      });

      return new RODiT();
    }

    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      const duration = Date.now() - startTime;

      logger.error("Invalid result format from blockchain", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokenfromroditid",
        requestId,
        duration,
        resultType: typeof resultArray,
        roditId: roditid,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_token_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "INVALID_RESULT_FORMAT",
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "token_from_id",
        error: "INVALID_RESULT_FORMAT",
      });

      return new RODiT();
    }

    const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
    const parsed = JSON.parse(resultString);

    const rodit = new RODiT();
    Object.assign(rodit, parsed);

    const duration = Date.now() - startTime;
    logger.debug("Successfully retrieved RODiT token", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokenfromroditid",
      requestId,
      duration,
      roditId: rodit.token_id,
      ownerId: rodit.owner_id,
      hasMetadata: !!rodit.metadata,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("rodit_token_fetch_duration_ms", duration, {
      component: "BlockchainService",
      success: true,
    });

    return rodit;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to fetch RODiT token", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokenfromroditid",
      requestId,
      duration,
      roditId: roditid,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("rodit_token_fetch_duration_ms", duration, {
      component: "BlockchainService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("blockchain_rpc_errors_total", 1, {
      component: "BlockchainService",
      method: "token_from_id",
      error: error.constructor.name,
    });

    return new RODiT();
  }
}

async function nearorg_rpc_state(id, accountId) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Checking account state on blockchain", {
    component: "BlockchainService",
    method: "nearorg_rpc_state",
    requestId,
    accountId,
    contractId: id,
  });

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

    logger.debug("Sending RPC request for account state", {
      component: "BlockchainService",
      method: "nearorg_rpc_state",
      requestId,
      rpcMethod: "view_account",
    });

    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.json();

    if (JSON.stringify(responseText).includes("does not exist while viewing")) {
      const duration = Date.now() - startTime;

      logger.warn("Account does not exist in blockchain", {
        component: "BlockchainService",
        method: "nearorg_rpc_state",
        requestId,
        duration,
        accountId,
        needsFunding: true,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("account_state_check_duration_ms", duration, {
        component: "BlockchainService",
        success: true,
        accountExists: false,
      });
      logger.metric("non_existent_accounts_total", 1, {
        component: "BlockchainService",
        accountId,
      });

      return false;
    }

    const duration = Date.now() - startTime;
    logger.debug("Account state verification complete", {
      component: "BlockchainService",
      method: "nearorg_rpc_state",
      requestId,
      duration,
      accountId,
      accountExists: true,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("account_state_check_duration_ms", duration, {
      component: "BlockchainService",
      success: true,
      accountExists: true,
    });

    return true;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to check account state", {
      component: "BlockchainService",
      method: "nearorg_rpc_state",
      requestId,
      duration,
      accountId,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("account_state_check_duration_ms", duration, {
      component: "BlockchainService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("blockchain_rpc_errors_total", 1, {
      component: "BlockchainService",
      method: "account_state",
      error: error.constructor.name,
    });

    throw error;
  }
}

async function nearorg_rpc_tokensfromaccountid(id, account_id) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Fetching RODiT tokens for account", {
    component: "BlockchainService",
    method: "nearorg_rpc_tokensfromaccountid",
    requestId,
    accountId: account_id,
    contractId: id,
  });

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

    logger.debug("Sending RPC request for account tokens", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokensfromaccountid",
      requestId,
      rpcMethod: "rodit_tokens_for_owner",
    });

    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(jsonData),
    });

    const responseText = await response.text();
    const parsedJson = JSON.parse(responseText);

    if (parsedJson.result && parsedJson.result.error) {
      const duration = Date.now() - startTime;

      logger.error("WASM execution error", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokensfromaccountid",
        requestId,
        duration,
        accountId: account_id,
        wasmError: parsedJson.result.error,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("account_tokens_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "WASM_ERROR",
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "tokens_from_account",
        error: "WASM_ERROR",
      });

      throw new Error(
        `Smart contract execution failed: ${parsedJson.result.error}`
      );
    }

    const resultArray = parsedJson.result.result;
    if (!Array.isArray(resultArray)) {
      const duration = Date.now() - startTime;

      logger.error("Invalid result format from blockchain", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokensfromaccountid",
        requestId,
        duration,
        accountId: account_id,
        resultType: typeof resultArray,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("account_tokens_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: "INVALID_RESULT_FORMAT",
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "tokens_from_account",
        error: "INVALID_RESULT_FORMAT",
      });

      throw new Error("Result is not an array");
    }

    const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
    const resultStruct = JSON.parse(resultString);

    if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
      const duration = Date.now() - startTime;

      logger.warn("No RODiT instances found for account", {
        component: "BlockchainService",
        method: "nearorg_rpc_tokensfromaccountid",
        requestId,
        duration,
        accountId: account_id,
        tokenCount: 0,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("account_tokens_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: true,
        tokenCount: 0,
      });
      logger.metric("empty_account_tokens_total", 1, {
        component: "BlockchainService",
        accountId: account_id,
      });

      const emptyRodit = new RODiT();
      return emptyRodit;
    }

    const rodit = new RODiT();
    Object.assign(rodit, resultStruct[0]);

    const duration = Date.now() - startTime;
    logger.debug("Successfully retrieved RODiT tokens", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokensfromaccountid",
      requestId,
      duration,
      accountId: account_id,
      tokenCount: resultStruct.length,
      firstTokenId: rodit.token_id,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("account_tokens_fetch_duration_ms", duration, {
      component: "BlockchainService",
      success: true,
      tokenCount: resultStruct.length,
    });

    return rodit;
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Failed to fetch RODiT tokens", {
      component: "BlockchainService",
      method: "nearorg_rpc_tokensfromaccountid",
      requestId,
      duration,
      accountId: account_id,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("account_tokens_fetch_duration_ms", duration, {
      component: "BlockchainService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("blockchain_rpc_errors_total", 1, {
      component: "BlockchainService",
      method: "tokens_from_account",
      error: error.constructor.name,
    });

    throw error;
  }
}

async function login_client(req, res) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("Client login request received", {
    component: "AuthenticationService",
    method: "login_client",
    requestId,
  });

  try {
    const {
      roditid: peer_roditid,
      timestamp: peer_timestamp,
      roditid_base64url_signature,
    } = req.body;

    logger.debug("Received login credentials", {
      component: "AuthenticationService",
      method: "login_client",
      requestId,
      roditId: peer_roditid,
      hasTimestamp: !!peer_timestamp,
      hasSignature: !!roditid_base64url_signature,
    });

    if (!peer_roditid || !peer_timestamp || !roditid_base64url_signature) {
      const duration = Date.now() - startTime;

      logger.warn("Missing required login parameters", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        duration,
        missingParams: {
          roditId: !peer_roditid,
          timestamp: !peer_timestamp,
          signature: !roditid_base64url_signature,
        },
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "MISSING_PARAMETERS",
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "AuthenticationService",
        reason: "MISSING_PARAMETERS",
      });

      return res.status(400).json({
        message: "Error 100: Missing RODiT ID, Signature or Timestamp",
        requestId,
      });
    }

    try {
      logger.debug("Retrieving server configuration", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
      });

      const config_own_rodit = await stateManager.getConfigOwnRodit();

      if (!config_own_rodit) {
        const duration = Date.now() - startTime;

        logger.error("Server configuration not initialized", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          duration,
          errorCode: "CONFIG_NOT_INITIALIZED",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_attempt_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "CONFIG_NOT_INITIALIZED",
        });
        logger.metric("failed_login_attempts_total", 1, {
          component: "AuthenticationService",
          reason: "CONFIG_NOT_INITIALIZED",
        });

        throw new Error("Error 0112: Server configuration not initialized");
      }

      logger.debug("Verifying peer RODiT credentials", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        roditId: peer_roditid,
      });

      const { peer_rodit, goodrodit: isRoditValid } =
        await verify_peerrodit_getrodit(
          peer_roditid,
          peer_timestamp,
          roditid_base64url_signature,
          config_own_rodit.own_rodit
        );

      if (!isRoditValid) {
        const duration = Date.now() - startTime;

        logger.warn("Invalid RODiT credentials", {
          component: "AuthenticationService",
          method: "login_client",
          requestId,
          duration,
          roditId: peer_roditid,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("login_attempt_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "INVALID_CREDENTIALS",
        });
        logger.metric("failed_login_attempts_total", 1, {
          component: "AuthenticationService",
          reason: "INVALID_CREDENTIALS",
        });

        return res.status(401).json({
          message:
            "Error 102: Login attempt failed: Invalid RODiT ID or Signature",
          requestId,
        });
      }

      logger.debug("Generating JWT token", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        roditId: peer_rodit.token_id,
      });

      const token = await generate_jwt_token(
        peer_rodit,
        peer_timestamp,
        config_own_rodit.own_rodit,
        config_own_rodit.own_rodit_bytes_private_key
      );

      const duration = Date.now() - startTime;
      logger.info("Login successful", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        duration,
        roditId: peer_rodit.token_id,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "AuthenticationService",
        success: true,
      });
      logger.metric("successful_logins_total", 1, {
        component: "AuthenticationService",
      });

      return res.json({
        token,
        requestId,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Login authentication failed", {
        component: "AuthenticationService",
        method: "login_client",
        requestId,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_attempt_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("failed_login_attempts_total", 1, {
        component: "AuthenticationService",
        reason: error.code || "UNKNOWN_ERROR",
      });

      return res.status(401).json({
        message: `Error 105: Login attempt failed: ${error.message}`,
        requestId,
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Internal server error during login", {
      component: "AuthenticationService",
      method: "login_client",
      requestId,
      duration,
      errorMessage: error.message,
      errorCode: error.code || "INTERNAL_SERVER_ERROR",
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("login_attempt_duration_ms", duration, {
      component: "AuthenticationService",
      success: false,
      error: "INTERNAL_SERVER_ERROR",
    });
    logger.metric("failed_login_attempts_total", 1, {
      component: "AuthenticationService",
      reason: "INTERNAL_SERVER_ERROR",
    });

    return res.status(500).json({
      message: "Internal server error during login",
      requestId,
    });
  }
}

async function login_client_withnep413(req, res, config_own_rodit = null) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("NEP-413 login request received", {
    component: "AuthenticationService",
    method: "login_client_withnep413",
    requestId,
  });

  try {
    const { signature, message, nonce, recipient, callbackUrl } = req.body;

    logger.debug("Received NEP-413 login parameters", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
      message,
      recipient,
      hasSignature: !!signature,
      hasNonce: !!nonce,
      hasCallbackUrl: !!callbackUrl,
    });

    if (!config_own_rodit) {
      const duration = Date.now() - startTime;

      logger.error("Server configuration not initialized for NEP-413 login", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        duration,
        errorCode: "CONFIG_NOT_INITIALIZED",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("nep413_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "CONFIG_NOT_INITIALIZED",
      });
      logger.metric("failed_nep413_logins_total", 1, {
        component: "AuthenticationService",
        reason: "CONFIG_NOT_INITIALIZED",
      });

      throw new Error("Error 0114: Server configuration not initialized");
    }

    logger.debug("Verifying NEP-413 RODiT credentials", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
      message,
    });

    const { peer_rodit, goodrodit: isRoditValid } =
      await verify_peerrodit_getrodit_withnep413(
        message,
        nonce,
        recipient,
        callbackUrl,
        signature,
        config_own_rodit
      );

    if (!isRoditValid) {
      const duration = Date.now() - startTime;

      logger.warn("NEP-413 login failed - Invalid RODiT credentials", {
        component: "AuthenticationService",
        method: "login_client_withnep413",
        requestId,
        duration,
        message,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("nep413_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "INVALID_CREDENTIALS",
      });
      logger.metric("failed_nep413_logins_total", 1, {
        component: "AuthenticationService",
        reason: "INVALID_CREDENTIALS",
      });

      return res.status(401).json({
        message:
          "Error 106: Login attempt failed: Invalid RODiT ID or Signature",
        requestId,
      });
    }

    logger.debug("Generating JWT token for validated NEP-413 login", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
      roditId: peer_rodit.token_id,
    });

    const token = await generate_jwt_token(
      peer_rodit,
      Math.floor(Date.now() / 1000),
      config_own_rodit.own_rodit,
      config_own_rodit.own_rodit_bytes_private_key
    );

    const duration = Date.now() - startTime;
    logger.info("NEP-413 login successful", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
      duration,
      roditId: peer_rodit.token_id,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("nep413_login_duration_ms", duration, {
      component: "AuthenticationService",
      success: true,
    });
    logger.metric("successful_nep413_logins_total", 1, {
      component: "AuthenticationService",
    });

    return res.json({
      token,
      requestId,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("NEP-413 login failed", {
      component: "AuthenticationService",
      method: "login_client_withnep413",
      requestId,
      duration,
      errorMessage: error.message,
      errorCode: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("nep413_login_duration_ms", duration, {
      component: "AuthenticationService",
      success: false,
      error: error.code || "UNKNOWN_ERROR",
    });
    logger.metric("failed_nep413_logins_total", 1, {
      component: "AuthenticationService",
      reason: error.code || "UNKNOWN_ERROR",
    });

    return res.status(500).json({
      message: `Error 175c: Login attempt failed: ${error.message}`,
      requestId,
    });
  }
}

async function login_portal(own_rodit, port) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("Starting portal login process", {
    component: "AuthenticationService",
    method: "login_portal",
    requestId,
    roditId: own_rodit?.token_id,
  });

  try {
    // Get configuration from state manager
    const config_own_rodit = await stateManager.getConfigOwnRodit();

    logger.debug("Retrieved configuration from state manager", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      hasConfig: !!config_own_rodit,
    });

    if (!config_own_rodit) {
      const duration = Date.now() - startTime;

      logger.error("Client configuration not initialized", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        duration,
        errorCode: "CONFIG_NOT_INITIALIZED",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("portal_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "CONFIG_NOT_INITIALIZED",
      });
      logger.metric("portal_login_errors_total", 1, {
        component: "AuthenticationService",
        error: "CONFIG_NOT_INITIALIZED",
      });

      return {
        error: "Client configuration not initialized",
        requestId,
      };
    }

    // Check RODiT metadata
    if (!own_rodit.metadata || !own_rodit.metadata.serviceprovider_id) {
      const duration = Date.now() - startTime;

      logger.error("Missing serviceprovider_id in RODiT", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        duration,
        roditId: own_rodit?.token_id,
        hasMetadata: !!own_rodit?.metadata,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("portal_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "MISSING_METADATA",
      });
      logger.metric("portal_login_errors_total", 1, {
        component: "AuthenticationService",
        error: "MISSING_METADATA",
      });

      return {
        error: "Missing serviceprovider_id in RODiT",
        requestId,
      };
    }

    // Use stateManager's getPortalUrl method to get API endpoint
    const serviceProviderId = own_rodit.metadata.serviceprovider_id;
    const apiendpoint = stateManager.getPortalUrl(serviceProviderId, port);

    logger.info("Using portal endpoint", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      apiEndpoint: apiendpoint,
    });

    // Prepare authentication data
    let roditid = own_rodit.token_id;
    const timestamp = Math.floor(Date.now() / 1000);
    const timeString = await unixTimeToDateString(timestamp);
    const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);

    logger.debug("Generating authentication signature", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      roditId: roditid,
      timestamp,
    });

    // Create signature
    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      config_own_rodit.own_rodit_bytes_private_key
    );
    const roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");

    // Send login request
    const fetchUrl = `${apiendpoint}/login`;

    logger.debug("Sending login request to portal", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      endpoint: fetchUrl,
    });

    try {
      const response = await fetch(fetchUrl, {
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

      if (!response.ok) {
        const duration = Date.now() - startTime;

        logger.error("Portal login request failed", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          status: response.status,
          statusText: response.statusText,
          endpoint: fetchUrl,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "HTTP_ERROR",
          status: response.status,
        });
        logger.metric("portal_login_errors_total", 1, {
          component: "AuthenticationService",
          error: "HTTP_ERROR",
          status: response.status,
        });

        throw new Error(
          `Error 040: Portal login failed with status ${response.status}`
        );
      }

      const data = await response.json();
      let jwt_token = data.token;

      logger.debug("Received JWT token from portal, validating", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        hasToken: !!jwt_token,
      });

      // Validate JWT token
      try {
        const validationResult = await validate_jwt_token_be(
          jwt_token,
          own_rodit
        );
        const peer_rodit = validationResult.peer_rodit;

        logger.debug("JWT token validation successful", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          peerRoditId: peer_rodit.token_id,
        });
      } catch (validationError) {
        const duration = Date.now() - startTime;

        logger.error("JWT token validation failed", {
          component: "AuthenticationService",
          method: "login_portal",
          requestId,
          duration,
          errorMessage: validationError.message,
          stack: validationError.stack,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("portal_login_duration_ms", duration, {
          component: "AuthenticationService",
          success: false,
          error: "JWT_VALIDATION_FAILED",
        });
        logger.metric("portal_login_errors_total", 1, {
          component: "AuthenticationService",
          error: "JWT_VALIDATION_FAILED",
        });

        throw new Error(
          `Error 039: Portal server validation failed: ${validationError.message}`
        );
      }

      const duration = Date.now() - startTime;
      logger.info("Portal login successful", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        duration,
        apiEndpoint: apiendpoint,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("portal_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: true,
      });
      logger.metric("successful_portal_logins_total", 1, {
        component: "AuthenticationService",
        endpoint: apiendpoint,
      });

      return {
        jwt_token,
        apiendpoint,
        requestId,
      };
    } catch (fetchError) {
      const duration = Date.now() - startTime;

      logger.error("Portal fetch operation failed", {
        component: "AuthenticationService",
        method: "login_portal",
        requestId,
        duration,
        errorMessage: fetchError.message,
        stack: fetchError.stack,
        endpoint: fetchUrl,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("portal_login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "FETCH_FAILED",
      });
      logger.metric("portal_login_errors_total", 1, {
        component: "AuthenticationService",
        error: "FETCH_FAILED",
        endpoint: fetchUrl,
      });

      throw fetchError;
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Portal login process failed", {
      component: "AuthenticationService",
      method: "login_portal",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
      roditId: own_rodit?.token_id,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("portal_login_duration_ms", duration, {
      component: "AuthenticationService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("portal_login_errors_total", 1, {
      component: "AuthenticationService",
      error: error.constructor.name,
    });

    return {
      error: `Failed to login to portal: ${error.message}`,
      requestId,
    };
  }
}

async function login_server(own_rodit) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("Starting login_server process", {
    component: "AuthenticationService",
    method: "login_server",
    requestId,
    roditId: own_rodit?.token_id,
  });

  try {
    const config_own_rodit = await stateManager.getConfigOwnRodit();

    logger.debug("Retrieved config from state manager", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      hasConfig: !!config_own_rodit,
      apiEndpoint: config_own_rodit?.apiendpoint,
    });

    if (!config_own_rodit) {
      const duration = Date.now() - startTime;

      logger.error("Client configuration not initialized", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        duration,
        errorCode: "CONFIG_NOT_INITIALIZED",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "CONFIG_NOT_INITIALIZED",
      });
      logger.metric("login_errors_total", 1, {
        component: "AuthenticationService",
        error: "CONFIG_NOT_INITIALIZED",
      });

      return { error: "Error 0111: Client configuration not initialized" };
    }

    const apiendpoint = config_own_rodit.apiendpoint;
    let roditid = own_rodit.token_id;
    const timestamp = Math.floor(Date.now() / 1000);

    logger.debug("Preparing authentication data", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      apiEndpoint: apiendpoint,
      roditId: roditid,
      timestamp,
    });

    const timeString = await unixTimeToDateString(timestamp);
    const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);

    logger.debug("Generating signature", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      hasPrivateKey: !!config_own_rodit.own_rodit_bytes_private_key,
    });

    const own_rodit_bytes_signature = nacl.sign.detached(
      roditidandtimestamp,
      config_own_rodit.own_rodit_bytes_private_key
    );

    const roditid_base64url_signature = Buffer.from(
      own_rodit_bytes_signature
    ).toString("base64url");

    logger.debug("Sending login request", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      endpoint: apiendpoint + "/login",
    });

    const response = await fetch(apiendpoint + "/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ roditid, timestamp, roditid_base64url_signature }),
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;

      logger.error("Login request failed", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        duration,
        status: response.status,
        statusText: response.statusText,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "HTTP_ERROR",
        status: response.status,
      });
      logger.metric("login_errors_total", 1, {
        component: "AuthenticationService",
        error: "HTTP_ERROR",
        status: response.status,
      });

      throw new Error("Error 040: Login failed");
    }

    const data = await response.json();
    let jwt_token = data.token;

    logger.debug("JWT token received, starting validation", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      hasToken: !!jwt_token,
    });

    // Validate the server
    let peer_bytes_ed25519_public_key;
    try {
      const validationResult = await validate_jwt_token_be(
        jwt_token,
        own_rodit
      );

      // Assuming the correct property name is peer_rodit
      const peer_rodit = validationResult.peer_rodit;

      logger.debug("Token validation successful", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        peerRoditId: peer_rodit.token_id,
      });

      peer_bytes_ed25519_public_key = new Uint8Array(
        Buffer.from(peer_rodit.owner_id, "hex")
      );
    } catch (validationError) {
      const duration = Date.now() - startTime;

      logger.error("JWT validation failed", {
        component: "AuthenticationService",
        method: "login_server",
        requestId,
        duration,
        errorMessage: validationError.message,
        stack: validationError.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("login_duration_ms", duration, {
        component: "AuthenticationService",
        success: false,
        error: "JWT_VALIDATION_FAILED",
      });
      logger.metric("login_errors_total", 1, {
        component: "AuthenticationService",
        error: "JWT_VALIDATION_FAILED",
      });

      throw new Error(
        `Error 039: Server validation failed: ${validationError.message}`
      );
    }

    const duration = Date.now() - startTime;
    logger.info("Login successful", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      duration,
      apiEndpoint: apiendpoint,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("login_duration_ms", duration, {
      component: "AuthenticationService",
      success: true,
    });
    logger.metric("successful_logins_total", 1, {
      component: "AuthenticationService",
      endpoint: apiendpoint,
    });

    return {
      jwt_token,
      apiendpoint,
      requestId,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Login failed", {
      component: "AuthenticationService",
      method: "login_server",
      requestId,
      duration,
      errorMessage: error.message,
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("login_duration_ms", duration, {
      component: "AuthenticationService",
      success: false,
      error: error.constructor.name,
    });
    logger.metric("login_errors_total", 1, {
      component: "AuthenticationService",
      error: error.constructor.name,
    });

    return {
      error: "Failed to login to server",
      requestId,
    };
  }
}

async function verifyToken(token, jwk_public_key, timestamp, requestId) {
  const startTime = Date.now();

  logger.debug("Starting token verification", {
    component: "TokenVerifier",
    method: "verifyToken",
    requestId,
    hasTimestamp: !!timestamp,
  });

  try {
    const result = await jwtVerify(token, jwk_public_key, {
      algorithms: ["EdDSA"],
    });

    const duration = Date.now() - startTime;
    logger.debug("Token verified successfully", {
      component: "TokenVerifier",
      method: "verifyToken",
      requestId,
      duration,
      subject: result.payload.sub,
      tokenExpiration: new Date(result.payload.exp * 1000).toISOString(),
      timeLeft: Math.floor(result.payload.exp - Date.now() / 1000),
    });

    // Emit metrics for Grafana dashboards
    logger.metric("token_verification_duration_ms", duration, {
      component: "TokenVerifier",
      success: true,
    });
    logger.metric("token_verifications_total", 1, {
      component: "TokenVerifier",
      success: true,
      algorithm: "EdDSA",
    });

    return result;
  } catch (jwtError) {
    const duration = Date.now() - startTime;

    if (jwtError.code === "ERR_JWT_EXPIRED") {
      logger.warn("Token expired, attempting renewal", {
        component: "TokenVerifier",
        method: "verifyToken",
        requestId,
        duration,
        errorCode: jwtError.code,
        errorMessage: jwtError.message,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_verification_duration_ms", duration, {
        component: "TokenVerifier",
        success: false,
        error: "TOKEN_EXPIRED",
      });
      logger.metric("token_verifications_total", 1, {
        component: "TokenVerifier",
        success: false,
        error: "TOKEN_EXPIRED",
      });
      logger.metric("expired_tokens_total", 1, {
        component: "TokenVerifier",
      });

      try {
        const config_own_rodit = await stateManager.getConfigOwnRodit();
        const unverifiedpayload = decodeJwt(token);

        logger.debug("Validating expired token for renewal", {
          component: "TokenVerifier",
          method: "verifyToken",
          requestId,
          subject: unverifiedpayload.sub,
          tokenId: unverifiedpayload.jti || "unknown",
        });

        const renewalStartTime = Date.now();
        const { isValid, notAfter } = await thorough_validate_jwt_token_be(
          unverifiedpayload,
          requestId
        );

        if (isValid) {
          logger.info("Generating new token for expired but valid token", {
            component: "TokenVerifier",
            method: "verifyToken",
            requestId,
            subject: unverifiedpayload.sub,
            notAfter: notAfter,
          });

          const newToken = await generate_jwt_token_fromtoken(
            unverifiedpayload,
            config_own_rodit.own_rodit.metadata.jwt_duration,
            notAfter,
            timestamp
          );

          const renewalDuration = Date.now() - renewalStartTime;
          logger.debug("Successfully generated renewal token", {
            component: "TokenVerifier",
            method: "verifyToken",
            requestId,
            renewalDuration,
            totalDuration: Date.now() - startTime,
          });

          // Emit metrics for Grafana dashboards
          logger.metric("token_renewal_duration_ms", renewalDuration, {
            component: "TokenVerifier",
            success: true,
            reason: "EXPIRED",
          });
          logger.metric("token_renewals_total", 1, {
            component: "TokenVerifier",
            reason: "EXPIRED",
          });

          return {
            payload: unverifiedpayload,
            protectedHeader: null,
            newToken,
          };
        }

        const renewalDuration = Date.now() - renewalStartTime;
        logger.error("Token renewal failed - invalid token", {
          component: "TokenVerifier",
          method: "verifyToken",
          requestId,
          renewalDuration,
          totalDuration: Date.now() - startTime,
          tokenId: unverifiedpayload.jti || "unknown",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("token_renewal_duration_ms", renewalDuration, {
          component: "TokenVerifier",
          success: false,
          error: "VALIDATION_FAILED",
        });
        logger.metric("token_renewal_failures_total", 1, {
          component: "TokenVerifier",
          reason: "VALIDATION_FAILED",
        });
      } catch (renewalError) {
        logger.error("Error during token renewal process", {
          component: "TokenVerifier",
          method: "verifyToken",
          requestId,
          duration: Date.now() - startTime,
          errorMessage: renewalError.message,
          errorCode: renewalError.code || "UNKNOWN_ERROR",
          stack: renewalError.stack,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("token_renewal_errors_total", 1, {
          component: "TokenVerifier",
          error: renewalError.code || "UNKNOWN_ERROR",
        });
      }
    } else {
      // Handle other JWT errors
      logger.error("JWT verification error", {
        component: "TokenVerifier",
        method: "verifyToken",
        requestId,
        duration,
        errorCode: jwtError.code || "UNKNOWN_ERROR",
        errorMessage: jwtError.message,
        stack: jwtError.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_verification_duration_ms", duration, {
        component: "TokenVerifier",
        success: false,
        error: jwtError.code || "UNKNOWN_ERROR",
      });
      logger.metric("token_verifications_total", 1, {
        component: "TokenVerifier",
        success: false,
        error: jwtError.code || "UNKNOWN_ERROR",
      });
    }

    throw jwtError;
  }
}

async function checkAndRenewToken(payload, timestamp, requestId) {
  const startTime = Date.now();

  const currentTime = Math.floor(Date.now() / 1000);
  const timeLeft = payload.exp - currentTime;
  const currentDuration = payload.exp - payload.iat;
  const durationLeftpct = (timeLeft / currentDuration) * 100;
  const newduration = currentDuration * tokenrenewaloptions.DURATIONRAMP;

  logger.debug("Checking token for proactive renewal", {
    component: "TokenRenewalService",
    method: "checkAndRenewToken",
    requestId,
    timeLeftPercent: durationLeftpct.toFixed(1),
    timeLeftSeconds: timeLeft,
    tokenId: payload.jti || "unknown",
    subject: payload.sub,
  });

  // No need for renewal
  if (durationLeftpct >= 100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE) {
    logger.debug("Token has sufficient lifetime remaining, no renewal needed", {
      component: "TokenRenewalService",
      method: "checkAndRenewToken",
      requestId,
      timeLeftPercent: durationLeftpct.toFixed(1),
      renewThreshold: (
        100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE
      ).toFixed(1),
    });

    const duration = Date.now() - startTime;
    logger.metric("token_renewal_check_duration_ms", duration, {
      component: "TokenRenewalService",
      renewalNeeded: false,
    });

    return { newToken: null };
  }

  // Token needs renewal
  logger.info("Token eligible for proactive renewal", {
    component: "TokenRenewalService",
    method: "checkAndRenewToken",
    requestId,
    timeLeftPercent: durationLeftpct.toFixed(1),
    renewThreshold: (100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE).toFixed(
      1
    ),
  });

  // Determine verification method
  const randomNumber = generateRandomNumber();
  const shouldDoFullVerification =
    randomNumber < tokenrenewaloptions.THRESHOLD_VALIDATION_TYPE ||
    newduration <
      (payload.rodit_maxrqwindow *
        (100 - tokenrenewaloptions.MIN_RENEWAL_PERCENTAGE)) /
        100;

  const verificationStartTime = Date.now();

  if (shouldDoFullVerification) {
    logger.debug("Performing full token verification", {
      component: "TokenRenewalService",
      method: "checkAndRenewToken",
      requestId,
      reason:
        randomNumber < tokenrenewaloptions.THRESHOLD_VALIDATION_TYPE
          ? "random_threshold"
          : "duration_threshold",
    });

    try {
      const { isValid, notAfter } = await thorough_validate_jwt_token_be(
        payload,
        requestId
      );

      const verificationDuration = Date.now() - verificationStartTime;
      logger.metric("token_verification_duration_ms", verificationDuration, {
        component: "TokenRenewalService",
        verificationType: "thorough",
        success: isValid,
      });

      if (isValid) {
        logger.debug("Full verification successful, generating new token", {
          component: "TokenRenewalService",
          method: "checkAndRenewToken",
          requestId,
          verificationDuration,
          notAfter,
        });

        const renewalStartTime = Date.now();
        const newToken = await generate_jwt_token_fromtoken(
          payload,
          newduration,
          notAfter,
          timestamp
        );

        const renewalDuration = Date.now() - renewalStartTime;
        const totalDuration = Date.now() - startTime;

        logger.info("Proactive token renewal successful", {
          component: "TokenRenewalService",
          method: "checkAndRenewToken",
          requestId,
          verificationType: "thorough",
          verificationDuration,
          renewalDuration,
          totalDuration,
          newDuration: newduration,
          notAfter,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("token_renewal_duration_ms", renewalDuration, {
          component: "TokenRenewalService",
          success: true,
          verificationType: "thorough",
        });
        logger.metric("token_renewal_check_duration_ms", totalDuration, {
          component: "TokenRenewalService",
          renewalNeeded: true,
          success: true,
          verificationType: "thorough",
        });
        logger.metric("token_renewals_total", 1, {
          component: "TokenRenewalService",
          reason: "PROACTIVE",
          verificationType: "thorough",
        });

        return {
          newToken,
          logInfo: {
            newDuration: newduration,
            reason: "Full verification",
            notAfter: notAfter,
            verificationDuration,
            renewalDuration,
            totalDuration,
          },
        };
      }

      logger.warn("Full verification failed, no token renewal", {
        component: "TokenRenewalService",
        method: "checkAndRenewToken",
        requestId,
        verificationDuration,
        totalDuration: Date.now() - startTime,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_renewal_failures_total", 1, {
        component: "TokenRenewalService",
        reason: "VERIFICATION_FAILED",
        verificationType: "thorough",
      });
    } catch (error) {
      const verificationDuration = Date.now() - verificationStartTime;
      const totalDuration = Date.now() - startTime;

      logger.error("Error during thorough token verification", {
        component: "TokenRenewalService",
        method: "checkAndRenewToken",
        requestId,
        verificationDuration,
        totalDuration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_verification_errors_total", 1, {
        component: "TokenRenewalService",
        verificationType: "thorough",
        error: error.code || "UNKNOWN_ERROR",
      });
    }
  } else {
    // Light verification path
    logger.debug("Performing light token verification", {
      component: "TokenRenewalService",
      method: "checkAndRenewToken",
      requestId,
    });

    try {
      const { isValid, notAfter } = await brief_validate_jwt_token_be(
        payload,
        requestId
      );

      const verificationDuration = Date.now() - verificationStartTime;
      logger.metric("token_verification_duration_ms", verificationDuration, {
        component: "TokenRenewalService",
        verificationType: "brief",
        success: isValid,
      });

      if (isValid) {
        logger.debug("Light verification successful, generating new token", {
          component: "TokenRenewalService",
          method: "checkAndRenewToken",
          requestId,
          verificationDuration,
          notAfter,
        });

        const renewalStartTime = Date.now();
        const newToken = await generate_jwt_token_fromtoken(
          payload,
          newduration,
          notAfter,
          timestamp
        );

        const renewalDuration = Date.now() - renewalStartTime;
        const totalDuration = Date.now() - startTime;

        logger.info("Proactive token renewal successful", {
          component: "TokenRenewalService",
          method: "checkAndRenewToken",
          requestId,
          verificationType: "brief",
          verificationDuration,
          renewalDuration,
          totalDuration,
          newDuration: newduration,
          notAfter,
        });

        // Emit metrics for Grafana dashboards
        logger.metric("token_renewal_duration_ms", renewalDuration, {
          component: "TokenRenewalService",
          success: true,
          verificationType: "brief",
        });
        logger.metric("token_renewal_check_duration_ms", totalDuration, {
          component: "TokenRenewalService",
          renewalNeeded: true,
          success: true,
          verificationType: "brief",
        });
        logger.metric("token_renewals_total", 1, {
          component: "TokenRenewalService",
          reason: "PROACTIVE",
          verificationType: "brief",
        });

        return {
          newToken,
          logInfo: {
            newDuration: newduration,
            reason: "Light verification",
            notAfter: notAfter,
            verificationDuration,
            renewalDuration,
            totalDuration,
          },
        };
      }

      logger.warn("Light verification failed, no token renewal", {
        component: "TokenRenewalService",
        method: "checkAndRenewToken",
        requestId,
        verificationDuration,
        totalDuration: Date.now() - startTime,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_renewal_failures_total", 1, {
        component: "TokenRenewalService",
        reason: "VERIFICATION_FAILED",
        verificationType: "brief",
      });
    } catch (error) {
      const verificationDuration = Date.now() - verificationStartTime;
      const totalDuration = Date.now() - startTime;

      logger.error("Error during brief token verification", {
        component: "TokenRenewalService",
        method: "checkAndRenewToken",
        requestId,
        verificationDuration,
        totalDuration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("token_verification_errors_total", 1, {
        component: "TokenRenewalService",
        verificationType: "brief",
        error: error.code || "UNKNOWN_ERROR",
      });
    }
  }

  // If we get here, token renewal wasn't successful
  const totalDuration = Date.now() - startTime;
  logger.debug("No token renewal performed", {
    component: "TokenRenewalService",
    method: "checkAndRenewToken",
    requestId,
    totalDuration,
  });

  logger.metric("token_renewal_check_duration_ms", totalDuration, {
    component: "TokenRenewalService",
    renewalNeeded: true,
    success: false,
  });

  return { newToken: null };
}

function extractTokenFromHeader(authHeader) {
  const startTime = Date.now();
  const requestId = ulid();

  logger.debug("Extracting token from authorization header", {
    component: "TokenExtractor",
    method: "extractTokenFromHeader",
    requestId,
    hasAuthHeader: !!authHeader,
  });

  if (!authHeader) {
    logger.debug("No authorization header present", {
      component: "TokenExtractor",
      method: "extractTokenFromHeader",
      requestId,
    });

    return null;
  }

  const parts = authHeader.split(" ");

  // Check for proper Bearer token format
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    logger.warn("Invalid authorization header format", {
      component: "TokenExtractor",
      method: "extractTokenFromHeader",
      requestId,
      duration: Date.now() - startTime,
      headerFormat: authHeader.substring(0, 20) + "...", // Log a safe portion
    });

    // Emit metrics for Grafana dashboards
    logger.metric("token_extraction_errors_total", 1, {
      component: "TokenExtractor",
      reason: "INVALID_FORMAT",
    });

    return null;
  }

  const token = parts[1];

  // Additional validation: check for empty token
  if (!token || token.trim() === "") {
    logger.warn("Empty token in authorization header", {
      component: "TokenExtractor",
      method: "extractTokenFromHeader",
      requestId,
      duration: Date.now() - startTime,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("token_extraction_errors_total", 1, {
      component: "TokenExtractor",
      reason: "EMPTY_TOKEN",
    });

    return null;
  }

  const duration = Date.now() - startTime;
  logger.debug("Token successfully extracted", {
    component: "TokenExtractor",
    method: "extractTokenFromHeader",
    requestId,
    duration,
    format: parts[0],
    tokenLength: token.length,
  });

  return token;
}

function handleTokenError(error, res, requestId) {
  const startTime = Date.now();

  logger.error("Token error occurred", {
    component: "TokenErrorHandler",
    method: "handleTokenError",
    requestId,
    errorCode: error.code || "UNKNOWN_ERROR",
    errorMessage: error.message,
    stack: error.stack,
  });

  // Emit metrics for Grafana dashboards
  logger.metric("token_errors_total", 1, {
    component: "TokenErrorHandler",
    errorCode: error.code || "UNKNOWN_ERROR",
  });

  if (error.code === "ERR_JWT_EXPIRED") {
    const duration = Date.now() - startTime;

    logger.debug("Responding with token expired error", {
      component: "TokenErrorHandler",
      method: "handleTokenError",
      requestId,
      duration,
      statusCode: 401,
    });

    return res.status(401).json({
      error: {
        code: "TOKEN_EXPIRED",
        message: "Token has expired",
        requestId,
      },
    });
  } else if (error.code === "ERR_JWT_INVALID") {
    const duration = Date.now() - startTime;

    logger.debug("Responding with invalid token error", {
      component: "TokenErrorHandler",
      method: "handleTokenError",
      requestId,
      duration,
      statusCode: 401,
    });

    return res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid token",
        requestId,
      },
    });
  } else if (error.code === "ERR_JWS_SIGNATURE_VERIFICATION_FAILED") {
    const duration = Date.now() - startTime;

    logger.debug("Responding with signature verification failed error", {
      component: "TokenErrorHandler",
      method: "handleTokenError",
      requestId,
      duration,
      statusCode: 401,
    });

    return res.status(401).json({
      error: {
        code: "INVALID_SIGNATURE",
        message: "Token signature verification failed",
        requestId,
      },
    });
  } else if (error.code === "ERR_JWT_CLAIM_VALIDATION_FAILED") {
    const duration = Date.now() - startTime;

    logger.debug("Responding with claim validation failed error", {
      component: "TokenErrorHandler",
      method: "handleTokenError",
      requestId,
      duration,
      statusCode: 401,
      claim: error.claim,
    });

    return res.status(401).json({
      error: {
        code: "INVALID_CLAIM",
        message: `Token claim validation failed: ${error.claim}`,
        requestId,
      },
    });
  }

  // Default error handling for unspecified errors
  const duration = Date.now() - startTime;

  logger.debug("Responding with generic token verification error", {
    component: "TokenErrorHandler",
    method: "handleTokenError",
    requestId,
    duration,
    statusCode: 403,
  });

  return res.status(403).json({
    error: {
      code: "TOKEN_VERIFICATION_FAILED",
      message: "Token verification failed",
      requestId,
    },
  });
}

async function authenticate_webhook(
  payload,
  signature_hex_ofpayload,
  timestamp,
  peer_rodit_owner_id
) {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting webhook authentication", {
    component: "WebhookAuthenticator",
    method: "authenticate_webhook",
    requestId,
    hasPayload: !!payload,
    hasSignature: !!signature_hex_ofpayload,
    hasTimestamp: !!timestamp,
    hasPeerRoditOwnerId: !!peer_rodit_owner_id,
  });

  try {
    const currentTime = Date.now();
    const parsedTimestamp = parseInt(timestamp);
    const timeThreshold = 5 * 60 * 1000; // 5 minutes

    // Check if timestamp is too old
    if (currentTime - parsedTimestamp > timeThreshold) {
      const duration = Date.now() - startTime;

      logger.warn("Webhook authentication failed - timestamp too old", {
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        duration,
        timestampAge: (currentTime - parsedTimestamp) / 1000,
        threshold: timeThreshold / 1000,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "WebhookAuthenticator",
        success: false,
        reason: "TIMESTAMP_EXPIRED",
      });
      logger.metric("webhook_authentication_failures_total", 1, {
        component: "WebhookAuthenticator",
        reason: "TIMESTAMP_EXPIRED",
      });

      return {
        isValid: false,
        error: {
          code: "TIMESTAMP_EXPIRED",
          message: "Webhook timestamp is too old",
          requestId,
        },
      };
    }

    logger.debug("Calculating payload hash for verification", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      payloadSize: payload.length,
    });

    // Calculate hash of payload
    const sha256_ofpayload = crypto
      .createHash("sha256")
      .update(payload)
      .digest();

    logger.debug("Converting signature to buffer", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      signatureLength: signature_hex_ofpayload.length,
    });

    // Convert signature to buffer
    const buffer_signature_ofpayload = Buffer.from(
      signature_hex_ofpayload,
      "hex"
    );

    logger.debug("Creating public key for verification", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      ownerIdLength: peer_rodit_owner_id.length,
    });

    // Create public key buffer
    const peer_bytes_public_key = new Uint8Array(
      Buffer.from(peer_rodit_owner_id, "hex")
    );

    // Verify signature
    const verificationStartTime = Date.now();
    const isValid = nacl.sign.detached.verify(
      sha256_ofpayload,
      buffer_signature_ofpayload,
      peer_bytes_public_key
    );
    const verificationDuration = Date.now() - verificationStartTime;

    // Log verification metrics
    logger.metric("signature_verification_duration_ms", verificationDuration, {
      component: "WebhookAuthenticator",
      success: isValid,
    });

    if (!isValid) {
      const duration = Date.now() - startTime;

      logger.warn("Webhook authentication failed - invalid signature", {
        component: "WebhookAuthenticator",
        method: "authenticate_webhook",
        requestId,
        duration,
        verificationDuration,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("webhook_authentication_duration_ms", duration, {
        component: "WebhookAuthenticator",
        success: false,
        reason: "INVALID_SIGNATURE",
      });
      logger.metric("webhook_authentication_failures_total", 1, {
        component: "WebhookAuthenticator",
        reason: "INVALID_SIGNATURE",
      });

      return {
        isValid: false,
        error: {
          code: "INVALID_SIGNATURE",
          message: "Invalid webhook signature",
          requestId,
        },
      };
    }

    const duration = Date.now() - startTime;
    logger.info("Webhook authentication successful", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      duration,
      verificationDuration,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("webhook_authentication_duration_ms", duration, {
      component: "WebhookAuthenticator",
      success: true,
    });
    logger.metric("successful_webhook_authentications_total", 1, {
      component: "WebhookAuthenticator",
    });

    return {
      isValid: true,
      message: "Webhook authentication successful",
      requestId,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Webhook authentication error", {
      component: "WebhookAuthenticator",
      method: "authenticate_webhook",
      requestId,
      duration,
      errorMessage: error.message,
      errorCode: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
    });

    // Emit metrics for Grafana dashboards
    logger.metric("webhook_authentication_duration_ms", duration, {
      component: "WebhookAuthenticator",
      success: false,
      error: error.code || "UNKNOWN_ERROR",
    });
    logger.metric("webhook_authentication_errors_total", 1, {
      component: "WebhookAuthenticator",
      error: error.constructor.name,
    });

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

const send_webhook = async (event, data, isError = false, req = null) => {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting webhook delivery", {
    component: "WebhookSender",
    method: "send_webhook",
    requestId,
    event,
    isError,
    dataSize:
      typeof data === "object" ? JSON.stringify(data).length : "unknown",
  });

  try {
    // Get the configuration from state manager
    const config_own_rodit = stateManager.getConfigOwnRodit();
    
    // Check if webhook configuration is available
    if (!config_own_rodit || !config_own_rodit.own_rodit.metadata.webhook_url) {
      const duration = Date.now() - startTime;

      logger.warn("Webhook configuration missing", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        duration,
        hasConfig: !!config_own_rodit,
        hasWebhookUrl: config_own_rodit
          ? !!config_own_rodit.own_rodit.metadata.webhook_url
          : false,
      });

      // Emit metrics for Grafana dashboards
      logger.metric && logger.metric("webhook_delivery_duration_ms", duration, {
        component: "WebhookSender",
        success: false,
        event,
        error: "WEBHOOK_CONFIG_ERROR",
      });
      logger.metric && logger.metric("webhook_delivery_failures_total", 1, {
        component: "WebhookSender",
        reason: "CONFIG_MISSING",
        event,
      });

      return {
        isValid: false,
        error: {
          code: "WEBHOOK_CONFIG_ERROR",
          message: "Webhook URL not available in Rodit configuration",
          requestId,
        },
      };
    }

    // Get the current JWT token or login to get one
    let jwt_token = stateManager.getJwtToken();
    if (!jwt_token) {
      // If there's no token, we need to login first
      logger.debug("No JWT token available, attempting login", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
      });
      
      try {
        // You'll need to implement or use your existing login function
        // This would typically be a call to login_client with the appropriate parameters
        const loginResult = await login_client({
          roditid: config_own_rodit.own_rodit.token_id,
          timestamp: Math.floor(Date.now() / 1000),
          // You'll need to generate a signature here
          // This is just a placeholder - implement according to your authentication flow
          roditid_base64url_signature: "your_signature_here" 
        });
        
        if (loginResult && loginResult.token) {
          jwt_token = loginResult.token;
          await stateManager.setJwtToken(jwt_token);
          
          logger.info("Successfully obtained JWT token for webhook", {
            component: "WebhookSender",
            method: "send_webhook",
            requestId,
          });
        } else {
          logger.error("Failed to obtain JWT token for webhook", {
            component: "WebhookSender",
            method: "send_webhook",
            requestId,
            loginResult,
          });
          throw new Error("Could not obtain authentication token for webhook");
        }
      } catch (loginError) {
        logger.error("Error during login for webhook token", {
          component: "WebhookSender",
          method: "send_webhook",
          requestId,
          error: loginError.message,
          stack: loginError.stack,
        });
        throw new Error(`Failed to authenticate for webhook: ${loginError.message}`);
      }
    }

    // Determine which webhook URL to use
    let webhookUrl;
    
    // Check if request object is available and has user JWT payload
    if (req && req.user && req.user.rodit_webhookurl) {
      // Use the webhook URL from the peer's JWT token
      webhookUrl = req.user.rodit_webhookurl;
      logger.debug("Using webhook URL from peer JWT token", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        webhookSource: "peer_jwt",
        webhookUrl
      });
    } else {
      // Fallback to config
      webhookUrl = config_own_rodit.own_rodit.metadata.webhook_url;
      logger.debug("Using webhook URL from own RODiT config", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        webhookSource: "own_config",
        webhookUrl
      });
    }

    // Ensure the URL has the correct format
    // First remove any existing protocol
    webhookUrl = webhookUrl.replace(/^(https?:\/\/)/, "");
    
    // Then add https:// protocol
    const formattedWebhookUrl = `https://${webhookUrl}/webhook`;

    logger.debug("Webhook URL details", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      rawWebhookUrl: webhookUrl,
      formattedWebhookUrl,
    });

    const timestamp = Date.now();
    const payload = JSON.stringify({
      event,
      data,
      isError,
      timestamp,
      requestId,
    });

    logger.debug("Preparing webhook payload", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      payloadSize: payload.length,
      event,
    });

    // Generate payload hash
    const sha256_ofpayload = crypto
      .createHash("sha256")
      .update(payload)
      .digest();

    logger.debug("Creating signature", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      hasPrivateKey: !!config_own_rodit.own_rodit_bytes_private_key,
    });

    // Convert private key and generate signature
    const own_rodit_private_key = new Uint8Array(
      config_own_rodit.own_rodit_bytes_private_key
    );

    const signatureStartTime = Date.now();
    const signature_ofpayload = nacl.sign.detached(
      sha256_ofpayload,
      own_rodit_private_key
    );
    const signatureDuration = Date.now() - signatureStartTime;

    // Log signature generation metrics
    logger.metric && logger.metric("signature_generation_duration_ms", signatureDuration, {
      component: "WebhookSender",
    });

    const signature_hex_ofpayload =
      Buffer.from(signature_ofpayload).toString("hex");

    logger.debug("Sending webhook request", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      webhookUrl: formattedWebhookUrl,
      event,
    });

    // Send webhook request WITH the JWT token
    const fetchStartTime = Date.now();
    const response = await fetch(formattedWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Signature": signature_hex_ofpayload,
        "X-Timestamp": timestamp.toString(),
        "X-Request-ID": requestId,
        "Authorization": `Bearer ${jwt_token}`  // Include JWT token here
      },
      body: payload,
    });
    const fetchDuration = Date.now() - fetchStartTime;

    // Log fetch duration metrics
    logger.metric && logger.metric("webhook_http_request_duration_ms", fetchDuration, {
      component: "WebhookSender",
      success: response.ok,
      status: response.status,
      event,
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;

      logger.error("Webhook delivery failed", {
        component: "WebhookSender",
        method: "send_webhook",
        requestId,
        duration,
        status: response.status,
        statusText: response.statusText,
        webhookUrl: formattedWebhookUrl,
        event,
      });

      // Emit metrics for Grafana dashboards
      logger.metric && logger.metric("webhook_delivery_duration_ms", duration, {
        component: "WebhookSender",
        success: false,
        event,
        error: "HTTP_ERROR",
        status: response.status,
      });
      logger.metric && logger.metric("webhook_delivery_failures_total", 1, {
        component: "WebhookSender",
        reason: "HTTP_ERROR",
        status: response.status,
        event,
      });

      throw new Error(`HTTP error! status: ${response.status}`);
    }

    await response.text();

    const duration = Date.now() - startTime;
    logger.info("Webhook delivered successfully", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      duration,
      event,
      webhookUrl: formattedWebhookUrl,
      status: response.status,
    });

    // Emit metrics for Grafana dashboards
    logger.metric && logger.metric("webhook_delivery_duration_ms", duration, {
      component: "WebhookSender",
      success: true,
      event,
    });
    logger.metric && logger.metric("successful_webhook_deliveries_total", 1, {
      component: "WebhookSender",
      event,
    });

    return {
      isValid: true,
      message: "Webhook sent successfully",
      requestId,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.error("Webhook send failed", {
      component: "WebhookSender",
      method: "send_webhook",
      requestId,
      duration,
      event,
      errorMessage: error.message,
      errorCode: error.code || "UNKNOWN_ERROR",
      stack: error.stack,
      isError,
      isTest: data && data.test_id ? true : false,
      operation: "webhook",
      status: "failed"
    });

    // Emit metrics for Grafana dashboards
    logger.metric && logger.metric("webhook_delivery_duration_ms", duration, {
      component: "WebhookSender",
      success: false,
      event,
      error: error.constructor.name,
    });
    logger.metric && logger.metric("webhook_delivery_errors_total", 1, {
      component: "WebhookSender",
      error: error.constructor.name,
      event,
    });

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

async function authenticate_apicall(req, res, next) {
  // Don't create a new ulid if it's not available
  const requestId = typeof ulid === "function" ? ulid() : "unknown-request-id";
  const startTime = Date.now();

  try {
    // Safely log with fallback
    try {
      logger.debug("Starting API call authentication", {
        component: "AuthenticationMiddleware",
        method: "authenticate_apicall",
        requestId,
        path: req.path,
        method: req.method,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
    } catch (logError) {
      console.error("Logging error:", logError);
    }

    // Extract token from header - simpler extraction without additional logging
    let token = null;
    try {
      const authHeader = req.headers["authorization"];
      if (authHeader && typeof authHeader === "string") {
        const parts = authHeader.split(" ");
        if (parts.length === 2 && parts[0] === "Bearer") {
          token = parts[1];
          if (token.trim() === "") {
            token = null;
          }
        }
      }
    } catch (extractError) {
      console.error("Token extraction error:", extractError);
      token = null;
    }

    // If no token or invalid token format, reject with 401
    if (!token) {
      try {
        logger.warn("API authentication failed - no token provided", {
          component: "AuthenticationMiddleware",
          method: "authenticate_apicall",
          requestId,
          path: req.path,
          hasAuthHeader: !!req.headers["authorization"],
        });
      } catch (logError) {
        console.error("Logging error:", logError);
      }

      return res.status(401).json({
        error: {
          code: "MISSING_TOKEN",
          message: "No token provided",
          requestId,
        },
      });
    }

    // Get the public key with careful error handling
    let jwk_public_key = null;
    try {
      const base64PublicKey = stateManager.getOwnBase64urlJwkPublicKey();
      if (!base64PublicKey) {
        throw new Error("No session public key available");
      }
      jwk_public_key = await base64url2jwk_public_key(base64PublicKey);
    } catch (keyError) {
      console.error("Key retrieval error:", keyError);
      return res.status(500).json({
        error: {
          code: "KEY_ERROR",
          message: "Error retrieving authentication key",
          requestId,
        },
      });
    }

    // Verify token with careful error handling
    try {
      const verificationResult = await verifyToken(
        token,
        jwk_public_key,
        req.headers["x-timestamp"],
        requestId
      );

      const payload = verificationResult.payload;
      const newToken = verificationResult.newToken;

      // Handle token renewal if needed
      if (newToken) {
        res.setHeader("New-Token", newToken);
        try {
          logger.info("Token renewed after expiration", {
            component: "AuthenticationMiddleware",
            method: "authenticate_apicall",
            requestId,
            path: req.path,
          });
        } catch (logError) {
          console.error("Logging error:", logError);
        }
      }

      // Set user from payload
      req.user = payload;

      // Authentication succeeded, proceed to next middleware
      next();
    } catch (verifyError) {
      // Handle token verification errors
      try {
        logger.error("Token verification failed", {
          component: "AuthenticationMiddleware",
          method: "authenticate_apicall",
          requestId,
          path: req.path,
          errorMessage: verifyError.message,
        });
      } catch (logError) {
        console.error("Logging error:", logError);
      }

      // Simplified error handling with fallback
      if (verifyError.code === "ERR_JWT_EXPIRED") {
        return res.status(401).json({
          error: {
            code: "TOKEN_EXPIRED",
            message: "Token has expired",
            requestId,
          },
        });
      } else {
        return res.status(401).json({
          error: {
            code: "INVALID_TOKEN",
            message: "Invalid token",
            requestId,
          },
        });
      }
    }
  } catch (error) {
    // Catch-all error handler
    console.error("Unexpected authentication error:", error);

    return res.status(500).json({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Internal server error during authentication",
        requestId,
      },
    });
  }
}

/**
 * Performs a fetch operation with comprehensive error handling and logging for Grafana monitoring
 *
 * @param {string} url - The URL to fetch from
 * @param {Object} options - Fetch options including method, headers, etc.
 * @returns {Promise<Object>} - The response data or error object
 */
async function fetchWithErrorHandling(url, options) {
  const requestId = ulid();
  const startTime = Date.now();
  const operation = options?.method || "GET";
  const urlObj = new URL(url);
  const endpoint = urlObj.pathname;

  // Log the request initiation for tracking in Grafana
  logger.info("API request initiated", {
    component: "APIClient",
    method: "fetchWithErrorHandling",
    event: "request_start",
    requestId,
    url: endpoint,
    operation,
    timestamp: new Date().toISOString(),
    service: "api-client",
  });

  try {
    // Get the JWT token from the state manager
    const jwt_token = stateManager.getJwtToken();

    // Add the current token to the request headers
    if (jwt_token) {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${jwt_token}`,
        "X-Request-ID": requestId, // Add request ID for correlation
      };
    } else {
      options.headers = {
        ...options.headers,
        "X-Request-ID": requestId,
      };
    }

    // Log token status for auth monitoring in Grafana
    logger.debug("Token status", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      event: "token_check",
      requestId,
      hasToken: !!jwt_token,
      timestamp: new Date().toISOString(),
    });

    const response = await fetch(url, options);

    // Calculate response time for performance monitoring
    const responseTime = Date.now() - startTime;

    // Check for a new token in the response headers
    const newToken = response.headers.get("New-Token");
    if (newToken) {
      // Update JWT token in state manager
      await stateManager.setJwtToken(newToken);

      try {
        // Use state manager to validate the token
        const config = await stateManager.getConfigOwnRodit();
        if (!config) {
          logger.error("Client configuration not initialized", {
            component: "APIClient",
            method: "fetchWithErrorHandling",
            event: "token_validation_error",
            requestId,
            error: "CONFIG_NOT_INITIALIZED",
            duration: Date.now() - startTime,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        // Note: You may need to implement a validate_jwt_token method in your state manager
        // or use an appropriate method from roditManager
        const result = await roditManager.validateJwtToken(newToken);
        if (!result.isValid) {
          throw new Error(`Token validation failed: ${result.error.message}`);
        }

        // Log successful token refresh for auth monitoring
        logger.debug("JWT token refreshed", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          event: "token_refreshed",
          requestId,
          isValid: true,
          timestamp: new Date().toISOString(),
        });
      } catch (validationError) {
        // Log token validation errors for security monitoring
        logger.error("Token validation failed", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          event: "token_validation_error",
          requestId,
          error: validationError.message,
          code: "E139",
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        throw new Error(
          `Error 139: Server validation failed: ${validationError.message}`
        );
      }
    }

    // Emit metrics for response time
    logger.metric("api_request_duration_milliseconds", responseTime, {
      endpoint,
      method: operation,
      status: response.status,
    });

    // Parse the response as JSON
    const responseData = await response.json();

    if (!response.ok) {
      // Check if it's a rate limiting error
      if (
        response.status === 429 &&
        responseData.error === "RateLimitExceeded"
      ) {
        const retryAfter = parseInt(
          response.headers.get("Retry-After") || "60",
          10
        );

        // Log rate limiting for capacity planning in Grafana
        logger.warn("Rate limit exceeded", {
          component: "APIClient",
          method: "fetchWithErrorHandling",
          event: "rate_limit_exceeded",
          requestId,
          retryAfter,
          maxRequests: responseData.maxRequests,
          windowMinutes: responseData.windowMinutes,
          url: endpoint,
          operation,
          statusCode: response.status,
          duration: responseTime,
          timestamp: new Date().toISOString(),
        });

        // Increment rate limit counter for Grafana alerts
        logger.metric("api_rate_limit_exceeded_total", 1, {
          endpoint,
          method: operation,
        });

        return {
          error: "RateLimitExceeded",
          message: responseData.message,
          retryAfter,
          maxRequests: responseData.maxRequests,
          windowMinutes: responseData.windowMinutes,
        };
      }

      // For other errors, log details and throw
      logger.error("API request failed", {
        component: "APIClient",
        method: "fetchWithErrorHandling",
        event: "request_failed",
        requestId,
        url: endpoint,
        operation,
        statusCode: response.status,
        statusText: response.statusText,
        errorDetails: responseData,
        duration: responseTime,
        timestamp: new Date().toISOString(),
      });

      // Increment error counter by type for Grafana alerts
      logger.metric("api_request_errors_total", 1, {
        endpoint,
        method: operation,
        status: response.status,
        errorType: response.status >= 500 ? "server_error" : "client_error",
      });

      throw new Error(
        `Error: Request failed: ${
          response.statusText
        }, Details: ${JSON.stringify(responseData)}`
      );
    }

    // Log successful request for performance monitoring
    logger.info("API request completed successfully", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      event: "request_success",
      requestId,
      url: endpoint,
      operation,
      statusCode: response.status,
      duration: responseTime,
      responseSize: JSON.stringify(responseData).length,
      timestamp: new Date().toISOString(),
    });

    // Increment success counter for Grafana dashboard
    logger.metric("api_requests_total", 1, {
      endpoint,
      method: operation,
      status: response.status,
      outcome: "success",
    });

    return responseData;
  } catch (error) {
    const errorDuration = Date.now() - startTime;

    // Determine if it's a network error
    const isNetworkError =
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.name === "TypeError";

    // Log detailed error for troubleshooting in Grafana
    logger.error("Fetch operation failed", {
      component: "APIClient",
      method: "fetchWithErrorHandling",
      event: "fetch_error",
      requestId,
      url: endpoint,
      operation,
      errorMessage: error.message,
      errorType: isNetworkError
        ? "network_error"
        : error instanceof SyntaxError
        ? "parse_error"
        : "general_error",
      errorStack: error.stack,
      duration: errorDuration,
      timestamp: new Date().toISOString(),
    });

    // Increment error counter by type for Grafana alerts
    logger.metric("api_client_errors_total", 1, {
      endpoint,
      method: operation,
      errorType: isNetworkError
        ? "network_error"
        : error instanceof SyntaxError
        ? "parse_error"
        : "general_error",
    });

    // If the error is due to JSON parsing (i.e., the response wasn't JSON)
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      return {
        error: "Error: InvalidResponse",
        message: "The server returned an invalid response",
      };
    }

    return {
      error: "RequestFailed",
      message: error.message,
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
  fetchWithErrorHandling,
};
