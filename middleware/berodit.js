// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const nacl = require('tweetnacl');
const { decodeUTF8 } = require('tweetnacl-util');

const debugWithType = (name, value) => {
  const type = typeof value;
  const isNull = value === null;
  const isUndefined = value === undefined;
  const isArray = Array.isArray(value);
  
  let detailedType = type;
  if (isNull) detailedType = 'null';
  if (isUndefined) detailedType = 'undefined';
  if (isArray) detailedType = 'array';
  
  const valueDisplay = isNull || isUndefined ? String(value) : value;
  
  console.debug(`${name}:`, {
    value: valueDisplay,
    type: detailedType
  });
};

// Utility function to ensure 'this' context is not required
const setValue = (obj, field, value) => {
  if (obj && typeof obj === "object") {
    obj[field] = value;
  }
  return value;
};

// Validates and sets a URL
const validateAndSetUrl = (value, field, obj = null) => {
  if (value == null) {
    return null; // Return null for null or undefined values
  }

  // Regular expression for URL validation, including localhost and IP addresses
  const urlRegex =
    /^(https?:\/\/)?(localhost(:[0-9]{1,5})?|([\da-z\.-]+)\.([a-z\.]{2,6})|((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?))([\/\w \.-]*)*\/?$/i;

  if (urlRegex.test(value)) {
    // Ensure the URL starts with http:// or https://
    const urlString = value.match(/^https?:\/\//) ? value : `https://${value}`;
    return setValue(obj, field, urlString);
  }

  throw new Error(`Invalid URL for ${field}: ${value}`);
};

// Validates and sets a date
const validateAndSetDate = (value, field, obj = null) => {
  if (value == null || value === "0" || value === "") {
      return "1970-01-01"; // Return default date string instead of null
  }
  const date = new Date(value);
  // Check if the date is valid and not before 1970-01-01
  if (isNaN(date.getTime()) || date < new Date("1970-01-01")) {
      throw new Error(
          `Invalid date for ${field}: ${value}. Must be YYYY-MM-DD and no earlier than 1970-01-01`
      );
  }
  return setValue(obj, field, value);
};

// Validates and sets a JSON string
const validateAndSetJson = (value, field, obj = null) => {
  if (value == null) {
    return null;
  }
  
  let jsonString;
  if (typeof value === "object") {
    // Convert object to string
    jsonString = JSON.stringify(value);
  } else if (typeof value === "string") {
    // Validate it's proper JSON
    try {
      JSON.parse(value);
      jsonString = value;
    } catch (e) {
      throw new Error(`Invalid JSON for ${field}: ${value}`);
    }
  } else {
    throw new Error(`Invalid type for ${field}: ${typeof value}`);
  }
  
  // Important: The Rust contract expects a string, so we need to ensure
  // the JSON string itself is properly escaped as a string
  return setValue(obj, field, jsonString);
};

// Validates and sets a digital signature
const validateAndSetSignature = (value, field, obj = null) => {
  if (value == null) {
    return null; // Return null for null or undefined values
  }
  // Regular expression for base64url encoding
  const base64urlPattern = /^[A-Za-z0-9_-]+$/;
  if (!base64urlPattern.test(value)) {
    throw new Error(`Invalid base64url encoding for ${field}: ${value}`);
  }
  // Check if the signature length is exactly 86 characters
  if (value.length !== 86) {
    throw new Error(
      `Invalid signature length for ${field}: ${value}. Expected 86 characters for base64url encoded Ed25519 signature.`
    );
  }
  return setValue(obj, field, value);
};

function ensureDateIsSet(dateVar, defaultValue) {
  if (!dateVar) {
    return defaultValue;
  }
  return dateVar;
}

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
  // Assume canonicalizeObject function is defined elsewhere
  const canonicalObj = canonicalizeObject(variable);
  const canonicalJson = JSON.stringify(canonicalObj);
  
  // Convert the JSON string to Uint8Array
  const messageUint8 = decodeUTF8(canonicalJson);
  
  // Calculate SHA-256 hash
  const hashUint8 = nacl.hash(messageUint8);
  
  // Convert the hash to a hexadecimal string
  return Array.from(hashUint8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

module.exports = {
  debugWithType,
  validateAndSetUrl,
  validateAndSetDate,
  validateAndSetJson,
  validateAndSetSignature,
  ensureDateIsSet,
  base64ToBase64Url,
  canonicalizeObject,
  calculateCanonicalHash
};