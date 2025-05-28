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
 * Debug function with type information
 * 
 * @param {string} type - Debug type identifier
 * @param {string} message - Debug message
 * @param {Object} data - Optional data to log
 * @returns {void}
 */
function debugWithType(type, message, data = {}) {
  if (process.env.DEBUG && (process.env.DEBUG === '*' || process.env.DEBUG.includes(type))) {
    console.log(`[DEBUG:${type}] ${message}`, data);
  }
}

/**
 * Logs server buffer state
 * 
 * @param {string} message - Log message
 * @param {Buffer} buffer - Buffer to log
 * @returns {void}
 */
function logServerBufferState(message, buffer) {
  if (process.env.DEBUG_BUFFERS) {
    console.log(`[BUFFER] ${message}:`, buffer ? buffer.toString('hex') : 'null');
  }
}

/**
 * Set a value in an object
 * @param {Object} obj - Object to set value in
 * @param {string} key - Key to set
 * @param {any} value - Value to set
 * @returns {void}
 */
function setValue(obj, key, value) {
  obj[key] = value;
}

/**
 * Convert date string to Unix timestamp
 * @param {string} dateString - ISO date string
 * @returns {number} Unix timestamp
 */
function dateStringToUnixTime(dateString) {
  return Math.floor(new Date(dateString).getTime() / 1000);
}

/**
 * Convert Unix timestamp to ISO date string
 * @param {number} unixTime - Unix timestamp
 * @returns {string} ISO date string
 */
function unixTimeToDateString(unixTime) {
  return new Date(unixTime * 1000).toISOString();
}

/**
 * Convert base64 to base64url
 * @param {string} base64 - Base64 string
 * @returns {string} Base64url string
 */
function base64ToBase64Url(base64) {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Canonicalize an object
 * @param {Object} obj - Object to canonicalize
 * @returns {string} Canonicalized string
 */
function canonicalizeObject(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Calculate canonical hash
 * @param {Object} obj - Object to hash
 * @returns {string} Hash
 */
function calculateCanonicalHash(obj) {
  const crypto = require('crypto');
  const canonicalString = canonicalizeObject(obj);
  return crypto.createHash('sha256').update(canonicalString).digest('hex');
}

/**
 * Convert hex to base64url
 * @param {string} hex - Hex string
 * @returns {string} Base64url string
 */
function hex2base64url(hex) {
  return base64ToBase64Url(Buffer.from(hex, 'hex').toString('base64'));
}

/**
 * Validate and set URL
 * @param {Object} obj - Object to set URL in
 * @param {string} key - Key to set
 * @param {string} value - URL to validate and set
 * @returns {boolean} Success
 */
function validateAndSetUrl(obj, key, value) {
  try {
    new URL(value);
    setValue(obj, key, value);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate and set date
 * @param {Object} obj - Object to set date in
 * @param {string} key - Key to set
 * @param {string} value - Date to validate and set
 * @returns {boolean} Success
 */
function validateAndSetDate(obj, key, value) {
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    setValue(obj, key, value);
    return true;
  }
  return false;
}

/**
 * Validate and set JSON
 * @param {Object} obj - Object to set JSON in
 * @param {string} key - Key to set
 * @param {string} value - JSON to validate and set
 * @returns {boolean} Success
 */
function validateAndSetJson(obj, key, value) {
  try {
    const parsed = JSON.parse(value);
    setValue(obj, key, parsed);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validate and set signature
 * @param {Object} obj - Object to set signature in
 * @param {string} key - Key to set
 * @param {string} value - Signature to validate and set
 * @returns {boolean} Success
 */
function validateAndSetSignature(obj, key, value) {
  if (validateSignatureFormat(value)) {
    setValue(obj, key, value);
    return true;
  }
  return false;
}

/**
 * Validate signature format
 * @param {string} signature - Signature to validate
 * @returns {boolean} Valid
 */
function validateSignatureFormat(signature) {
  // Base64url format validation
  return /^[A-Za-z0-9\-_]+$/.test(signature);
}

/**
 * Validate public key format
 * @param {string} publicKey - Public key to validate
 * @returns {boolean} Valid
 */
function validatePublicKeyFormat(publicKey) {
  // Simple format validation for ed25519 public key
  return /^[A-Za-z0-9\-_]{43,44}$/.test(publicKey);
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
  
  debugWithType('auth', `Generated signature for request ${requestId}`, {
    roditId,
    timestamp,
    timeString,
    signatureLength: base64UrlSignature.length
  });
  
  return base64UrlSignature;
}

module.exports = {
  // Debug and logging functions
  debugWithType,
  logServerBufferState,
  
  // Credential validation functions
  validateCredentialParameters,
  validateAndExtractCredentials,
  
  // Data conversion functions
  setValue,
  dateStringToUnixTime,
  unixTimeToDateString,
  base64ToBase64Url,
  canonicalizeObject,
  calculateCanonicalHash,
  hex2base64url,
  
  // Validation functions
  validateAndSetUrl,
  validateAndSetDate,
  validateAndSetJson,
  validateAndSetSignature,
  validateSignatureFormat,
  validatePublicKeyFormat,
  
  // Authentication functions
  generateSignature
};