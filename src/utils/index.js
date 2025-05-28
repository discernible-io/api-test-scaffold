/**
 * Utility functions for RODiT authentication
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
nacl.util = require("tweetnacl-util");
const { decodeUTF8 } = require("tweetnacl-util");

/**
 * Debug utility that logs the type and value of a variable
 * 
 * @param {string} name - Name of the variable
 * @param {any} value - Value to log
 */
function debugWithType(name, value) {
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
}

/**
 * Logs the state of a buffer at a given stage
 *
 * @param {string} stage - Current processing stage
 * @param {Buffer|Uint8Array|any} data - Data to log
 * @param {Object} logger - Logger instance
 * @param {string} requestId - Request ID for tracking
 */
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

/**
 * Sets a value on an object if the object exists
 *
 * @param {Object} obj - Target object
 * @param {string} field - Field to set
 * @param {any} value - Value to set
 * @returns {any} The value
 */
const setValue = (obj, field, value) => {
  if (obj && typeof obj === "object") {
    obj[field] = value;
  }
  return value;
};

/**
 * Converts a date string to Unix timestamp
 *
 * @param {string} datestring - Date string in ISO format
 * @returns {Promise<number>} Unix timestamp in seconds
 */
async function dateStringToUnixTime(datestring) {
  const date = new Date(datestring);
  const unixTimeMs = date.getTime();
  const unixTimeSec = Math.floor(unixTimeMs / 1000);
  return unixTimeSec;
}

/**
 * Converts a Unix timestamp to a date string
 * This function is used by both the API and test suite
 *
 * @param {number|string} unixTimeSec - Unix timestamp in seconds
 * @returns {Promise<string>} Date string in ISO format
 */
async function unixTimeToDateString(unixTimeSec) {
  const unixTimeMs = unixTimeSec * 1000;
  const date = new Date(unixTimeMs);
  return date.toISOString();
}

// ensureDateIsSet function has been removed in favor of validateAndSetDate

/**
 * Converts base64 to base64url format
 *
 * @param {string} base64 - Base64 string
 * @returns {string} Base64url string
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

/**
 * Canonicalizes an object for consistent hash generation
 *
 * @param {Object|Array|any} obj - Object to canonicalize
 * @returns {Object|Array|any} Canonicalized object
 */
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

/**
 * Calculates a canonical hash for an object
 *
 * @param {Object|Array|any} variable - Variable to hash
 * @returns {string} Hex hash string
 */
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


/**
 * Validates and sets a URL value
 * 
 * @param {string} value - URL to validate
 * @param {string} field - Field name for error messages
 * @param {Object} obj - Object to set the value on
 * @returns {string|null} Validated URL or null if invalid
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

    if (obj && typeof obj === "object") {
      obj[field] = result;
    }
    return result;
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

/**
 * Validates and sets a date value
 * 
 * @param {string} value - Date to validate
 * @param {string} field - Field name for error messages
 * @param {Object} obj - Object to set the value on
 * @returns {string} Validated date string
 */
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
    const defaultDate = "1970-01-01";
    
    if (obj && typeof obj === "object") {
      obj[field] = defaultDate;
    }
    return defaultDate;
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

  if (obj && typeof obj === "object") {
    obj[field] = value;
  }
  return value;
};

/**
 * Validates and sets a JSON value
 * 
 * @param {string|Object} value - JSON string or object to validate
 * @param {string} field - Field name for error messages
 * @param {Object} obj - Object to set the value on
 * @returns {string|null} Validated JSON string or null
 */
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

  if (obj && typeof obj === "object") {
    obj[field] = jsonString;
  }
  return jsonString;
};

/**
 * Validates and sets a signature value
 * 
 * @param {string} value - Signature to validate
 * @param {string} field - Field name for error messages
 * @param {Object} obj - Object to set the value on
 * @returns {string|null} Validated signature or null
 */
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

  if (obj && typeof obj === "object") {
    obj[field] = value;
  }
  return value;
};

/**
 * Validates signature format
 * 
 * @param {string} signature - Signature to validate
 * @param {string} requestId - Request ID for tracking
 * @returns {Object} Validation result
 */
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

/**
 * Validates public key format
 * 
 * @param {string} publicKey - Public key to validate
 * @param {string} requestId - Request ID for tracking
 * @returns {Object} Validation result
 */
function validatePublicKeyFormat(publicKey, requestId) {
  const result = {
    isValid: false,
    reason: null,
    publicKey: null,
  };

  if (!publicKey) {
    result.reason = "Public key is null or undefined";
    return result;
  }

  if (typeof publicKey !== "string") {
    result.reason = `Public key is not a string, got ${typeof publicKey}`;
    return result;
  }

  // Minimum length for a valid public key in any format
  if (publicKey.length < 32) {
    result.reason = `Public key too short: ${publicKey.length} chars`;
    return result;
  }

  try {
    // Normalize the public key format
    let normalizedPublicKey = publicKey;

    // Remove ed25519: prefix if present
    if (normalizedPublicKey.startsWith("ed25519:")) {
      normalizedPublicKey = normalizedPublicKey.substring(8);
    }

    // Try to decode the public key to validate it
    let publicKeyBytes;

    // Try base64 decoding
    try {
      publicKeyBytes = Buffer.from(normalizedPublicKey, "base64");
      if (publicKeyBytes.length === 32) {
        result.isValid = true;
        result.publicKey = normalizedPublicKey;
        return result;
      }
    } catch (e) {
      // Not base64, continue to other formats
    }

    // Try hex decoding
    try {
      if (/^[0-9a-fA-F]{64}$/.test(normalizedPublicKey)) {
        publicKeyBytes = Buffer.from(normalizedPublicKey, "hex");
        if (publicKeyBytes.length === 32) {
          result.isValid = true;
          result.publicKey = normalizedPublicKey;
          return result;
        }
      }
    } catch (e) {
      // Not hex, continue to other formats
    }

    // Try base58 decoding (common for blockchain keys)
    try {
      const bs58 = require("bs58");
      publicKeyBytes = bs58.decode(normalizedPublicKey);
      if (publicKeyBytes.length === 32) {
        result.isValid = true;
        result.publicKey = normalizedPublicKey;
        return result;
      }
    } catch (e) {
      // Not base58
    }

    result.reason = "Public key format not recognized";
    return result;
  } catch (error) {
    logger.error("Error validating public key format", {
      component: "Validator",
      method: "validatePublicKeyFormat",
      requestId,
      error: error.message,
      stack: error.stack,
    });

    result.reason = `Error validating: ${error.message}`;
    
    logger.metric("public_key_validation_errors_total", 1, {
      reason: "exception",
      component: "Validator",
      errorType: error.constructor.name,
    });

    return result;
  }
}

/**
 * Validates and extracts credentials from parsed data
 * 
 * @param {Object} parsedData - Parsed credential data
 * @returns {Object} Validated and extracted credentials
 */
function validateAndExtractCredentials(parsedData) {
  const bs58 = require("bs58");
  
  const stripEd25519Prefix = (key) => key.replace("ed25519:", "");
  
  const publicKeyToImplicitId = (publicKey) => {
    const publicKeyBase58 = stripEd25519Prefix(publicKey);
    const publicKeyBytes = bs58.decode(publicKeyBase58);
    return Buffer.from(publicKeyBytes.buffer).toString('hex');
  };

  if (parsedData.implicit_account_id) {
    const { implicit_account_id, private_key, public_key } = parsedData;
    
    if (!implicit_account_id || typeof implicit_account_id !== "string") {
      throw new Error("Error 244: Invalid or missing implicit_account_id value");
    }
    
    if (!private_key || typeof private_key !== "string") {
      throw new Error("Error 043: Invalid or missing private_key value");
    }

    if (public_key) {
      const calculatedImplicitId = publicKeyToImplicitId(public_key);
      if (implicit_account_id !== calculatedImplicitId) {
        throw new Error("Error 246: implicit_account_id does not match public_key");
      }
    }

    return {
      account_id: implicit_account_id, // Use implicit_account_id as account_id
      implicit_account_id,
      private_key: stripEd25519Prefix(private_key),
      public_key: public_key ? stripEd25519Prefix(public_key) : null
    };
  }

  const { account_id, public_key, private_key } = parsedData;
  
  if (!account_id || typeof account_id !== "string") {
    throw new Error("Error 244: Invalid or missing account_id value");
  }
  
  if (!public_key || typeof public_key !== "string") {
    throw new Error("Error 245: Invalid or missing public_key value");
  }
  
  if (!private_key || typeof private_key !== "string") {
    throw new Error("Error 043: Invalid or missing private_key value");
  }

  return {
    account_id,
    implicit_account_id: publicKeyToImplicitId(public_key),
    private_key: stripEd25519Prefix(private_key),
    public_key: stripEd25519Prefix(public_key)
  };
}

/**
 * Validates credential parameters
 * 
 * @param {string} configPath - Path to credentials file
 * @param {string} credentialType - Type of credentials
 * @returns {void} Throws error if parameters are invalid
 */
function validateCredentialParameters(configPath, credentialType) {
  if (!configPath || typeof configPath !== "string") {
    throw new Error("Error 047: Invalid or missing configPath parameter");
  }
  
  if (!credentialType || typeof credentialType !== "string") {
    throw new Error("Error 047: Invalid or missing credentialType parameter");
  }
}

/**
 * Generate signature for authentication
 * @param {string} roditId - RODiT ID
 * @param {number} timestamp - Unix timestamp
 * @param {Uint8Array} privateKey - Private key as bytes
 * @param {string} requestId - Request ID
 * @returns {string} Base64url signature
 */
function generateSignature(roditId, timestamp, privateKey, requestId) {
  const nacl = require('tweetnacl');
  const bs58 = require('bs58');
  
  // Generate timestamp string for signature
  const date = new Date(timestamp * 1000);
  const timeString = date.toISOString();
  
  // Create message to sign
  const message = new TextEncoder().encode(roditId + timeString);
  
  // Ensure privateKey is a Uint8Array
  let privateKeyBytes;
  if (privateKey instanceof Uint8Array) {
    privateKeyBytes = privateKey;
  } else if (typeof privateKey === 'string') {
    // If it's a base58 encoded string, decode it
    try {
      privateKeyBytes = new Uint8Array(bs58.decode(privateKey));
    } catch (error) {
      // If not base58, try to decode as base64
      try {
        privateKeyBytes = new Uint8Array(Buffer.from(privateKey, 'base64'));
      } catch (error) {
        throw new Error(`Unable to convert privateKey to Uint8Array: ${error.message}`);
      }
    }
  } else if (Buffer.isBuffer(privateKey)) {
    privateKeyBytes = new Uint8Array(privateKey);
  } else {
    throw new Error('privateKey must be a Uint8Array, Buffer, or string');
  }
  
  // Generate signature using the private key
  const signature = nacl.sign.detached(message, privateKeyBytes);
  
  // Convert to base64url format
  const base64UrlSignature = Buffer.from(signature).toString('base64url');
  
  logger.debug(`Generated signature for request ${requestId}`, {
    component: "Authentication",
    method: "generateSignature",
    roditId,
    timestamp,
    timeString,
    signatureLength: base64UrlSignature.length
  });
  
  return base64UrlSignature;
}

module.exports = {
  // Original utils functions
  debugWithType,
  logServerBufferState,
  setValue,
  dateStringToUnixTime,
  unixTimeToDateString,
  base64ToBase64Url,
  canonicalizeObject,
  calculateCanonicalHash,
  hex2base64url,
  
  // Validation functions from validateandset
  validateAndSetUrl,
  validateAndSetDate,
  validateAndSetJson,
  validateAndSetSignature,
  validateSignatureFormat,
  validatePublicKeyFormat,
  
  // Functions transferred from indexb.js
  validateAndExtractCredentials,
  validateCredentialParameters,
  generateSignature
};