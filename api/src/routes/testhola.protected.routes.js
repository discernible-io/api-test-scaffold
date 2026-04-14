const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { logger, roditManager, blockchainService } = require("@rodit/rodit-auth-be");
const { validateContentType, validateJsonBody } = require("../middleware/request-validation");
const { getUserRateLimiter } = require("../middleware/user-rate-limit");
const nearIdentityService = require("../services/near-identity.service");
const { validateHexNonce, computeHelloChecksum } = require("../services/nonce-encoding.service");

// Authentication middleware - uses app.locals.roditClient
const authenticate = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    return res.status(503).json({ error: "Authentication service unavailable" });
  }

  return client.authenticate(req, res, (authErr) => {
    if (authErr) {
      return next(authErr);
    }

    const userRateLimiter = getUserRateLimiter(req);
    if (!userRateLimiter) {
      return next();
    }

    return userRateLimiter(req, res, next);
  });
};

const HEX_ALPHABET = "0123456789ABCDEF";

/**
 * Validates and parses a HOLA message
 * @param {string} hello - The HOLA message to validate
 * @returns {Object} Validation result with parsed components or error reason
 */
function validateHolaMessage(hello) {
  const result = {
    valid: false,
    tokenId: null,
    isoTimestamp: null,
    noncetsHex: null,
    signatureB64: null,
    checksumChar: null,
    reason: null,
    checks: {
      formatValid: false,
      checksumValid: false,
      timestampValid: false,
      noncetsValid: false
    }
  };

  // Check if hello is provided
  if (!hello || typeof hello !== "string") {
    result.reason = "Missing or invalid hello parameter (must be a string)";
    return result;
  }

  const MAX_HELLO_LENGTH = 512;
  if (hello.length > MAX_HELLO_LENGTH) {
    result.reason = `Hello string exceeds maximum length of ${MAX_HELLO_LENGTH} characters (got ${hello.length})`;
    return result;
  }

  // Check HOLA prefix
  const prefixLiteral = "HOLA:";
  if (!hello.startsWith(prefixLiteral)) {
    result.reason = "Unsupported protocol; expected HOLA prefix";
    return result;
  }

  result.checks.formatValid = true;

  const withoutPrefix = hello.slice(prefixLiteral.length);

  // Parse from the end: extract checksum
  const lastColonIndex = withoutPrefix.lastIndexOf(":");
  if (lastColonIndex === -1) {
    result.reason = "Invalid HOLA format: missing checksum separator";
    return result;
  }

  const checksumCharRaw = withoutPrefix.slice(lastColonIndex + 1);
  const beforeChecksum = withoutPrefix.slice(0, lastColonIndex);

  if (!checksumCharRaw) {
    result.reason = "Missing checksum";
    return result;
  }

  result.checksumChar = checksumCharRaw.toUpperCase();

  // Extract signature
  const sigColonIndex = beforeChecksum.lastIndexOf(":");
  if (sigColonIndex === -1) {
    result.reason = "Invalid HOLA format: missing signature separator";
    return result;
  }

  result.signatureB64 = beforeChecksum.slice(sigColonIndex + 1);
  const beforeSignature = beforeChecksum.slice(0, sigColonIndex);

  if (!result.signatureB64) {
    result.reason = "Missing signature";
    return result;
  }

  // Extract protocol marker
  const protocolColonIndex = beforeSignature.lastIndexOf(":");
  if (protocolColonIndex === -1) {
    result.reason = "Invalid HOLA format: missing protocol marker separator";
    return result;
  }

  const protocolMarker = beforeSignature.slice(protocolColonIndex + 1);
  if (protocolMarker !== "API.IDENTYCLAW.COM") {
    result.reason = `Invalid protocol marker: expected API.IDENTYCLAW.COM, got ${protocolMarker}`;
    return result;
  }

  const beforeProtocol = beforeSignature.slice(0, protocolColonIndex);

  // Extract noncets
  const noncetsHexColonIndex = beforeProtocol.lastIndexOf(":");
  if (noncetsHexColonIndex === -1) {
    result.reason = "Invalid HOLA format: missing noncets separator";
    return result;
  }

  const noncetsHexRaw = beforeProtocol.slice(noncetsHexColonIndex + 1);
  const tokenAndTimestamp = beforeProtocol.slice(0, noncetsHexColonIndex);

  if (!noncetsHexRaw) {
    result.reason = "Missing noncets";
    return result;
  }

  // Validate noncets hex
  const noncetsCheck = validateHexNonce(noncetsHexRaw);
  if (!noncetsCheck.valid) {
    result.reason = noncetsCheck.reason || "noncets must contain only uppercase hex characters 0-9A-F";
    return result;
  }

  result.noncetsHex = noncetsCheck.value;
  result.checks.noncetsValid = true;

  // Extract tokenId and timestamp
  const tokenColonIndex = tokenAndTimestamp.indexOf(":");
  if (tokenColonIndex === -1) {
    result.reason = "Invalid HOLA format: missing tokenId/timestamp separator";
    return result;
  }

  result.tokenId = tokenAndTimestamp.slice(0, tokenColonIndex);
  result.isoTimestamp = tokenAndTimestamp.slice(tokenColonIndex + 1);

  if (!result.tokenId) {
    result.reason = "Missing tokenId";
    return result;
  }

  if (!result.isoTimestamp) {
    result.reason = "Missing timestamp";
    return result;
  }

  // Validate timestamp format
  const tsMs = Date.parse(result.isoTimestamp);
  if (Number.isNaN(tsMs)) {
    result.reason = "Invalid timestamp: must be a valid ISO-8601 string";
    return result;
  }

  result.checks.timestampValid = true;

  // Validate checksum
  const checksumPrefix = `HOLA:${result.tokenId}:${result.isoTimestamp}:${result.noncetsHex}:API.IDENTYCLAW.COM:${result.signatureB64}:`;
  const expectedChecksum = computeHelloChecksum(checksumPrefix);

  if (result.checksumChar !== expectedChecksum) {
    result.reason = `Invalid checksum: expected ${expectedChecksum}, got ${result.checksumChar}`;
    return result;
  }

  result.checks.checksumValid = true;
  result.valid = true;

  return result;
}

/**
 * Validates signature against the token owner's public key
 * @param {string} tokenId - The token ID
 * @param {string} message - The message that was signed
 * @param {string} signatureB64 - Base64url encoded signature
 * @returns {Promise<Object>} Signature validation result
 */
async function validateSignature(tokenId, message, signatureB64) {
  const result = {
    valid: false,
    tokenExists: false,
    tokenActive: false,
    signatureValid: false,
    publicKeyAvailable: false,
    reason: null
  };

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token) {
      result.reason = "Token not found";
      return result;
    }

    result.tokenExists = true;
    result.tokenActive = true; // TODO: check actual active status when contract supports it

    if (!token.owner_id) {
      result.reason = "Token has no owner_id";
      return result;
    }

    const publicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(token.owner_id);

    if (!publicKeyBytes || publicKeyBytes.length !== 32) {
      result.reason = "Public key unavailable or invalid length";
      return result;
    }

    result.publicKeyAvailable = true;

    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = new Uint8Array(Buffer.from(signatureB64, "base64url"));

    const ok = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

    if (ok) {
      result.signatureValid = true;
      result.valid = true;
    } else {
      result.reason = "Signature verification failed";
    }

    return result;
  } catch (error) {
    result.reason = `Error during signature validation: ${error.message}`;
    return result;
  }
}

/**
 * Generates a HOLA response using roditclient's key pair
 * @returns {Promise<Object>} Generated HOLA message and metadata
 */
async function generateHolaResponse() {
  const result = {
    success: false,
    hello: null,
    tokenId: null,
    timestamp: null,
    error: null
  };

  try {
    // Get roditclient credentials
    const credentials = await roditManager.initializeRoditConfig("server");

    if (!credentials || !credentials.implicit_account_id) {
      result.error = "RoditClient credentials not available";
      return result;
    }

    const tokenId = credentials.implicit_account_id;
    const now = new Date();
    const isoTimestamp = now.toISOString();

    // Generate noncets (16 random bytes as hex)
    const noncetsBytes = nacl.randomBytes(16);
    const noncetsHex = Buffer.from(noncetsBytes).toString("hex").toUpperCase();

    // Build message to sign (everything except signature and checksum)
    const message = `HOLA:${tokenId}:${isoTimestamp}:${noncetsHex}:API.IDENTYCLAW.COM:`;
    const messageBytes = new TextEncoder().encode(message);

    // Get private key and sign
    const privateKeyBase58 = credentials.private_key;
    if (!privateKeyBase58) {
      result.error = "Private key not available";
      return result;
    }

    // Decode private key from base58
    const privateKeyBytes = new Uint8Array(bs58.decode(privateKeyBase58));

    // Sign the message
    const signature = nacl.sign.detached(messageBytes, privateKeyBytes);
    const signatureB64 = Buffer.from(signature).toString("base64url");

    // Compute checksum
    const prefixWithSignature = `${message}${signatureB64}:`;
    const checksum = computeHelloChecksum(prefixWithSignature);

    // Build complete HOLA
    const hello = `HOLA:${tokenId}:${isoTimestamp}:${noncetsHex}:API.IDENTYCLAW.COM:${signatureB64}:${checksum}`;

    result.success = true;
    result.hello = hello;
    result.tokenId = tokenId;
    result.timestamp = isoTimestamp;
    result.noncetsHex = noncetsHex;
    result.signatureB64 = signatureB64;
    result.checksum = checksum;

    return result;
  } catch (error) {
    result.error = `Error generating HOLA response: ${error.message}`;
    return result;
  }
}

router.post("/testhola", validateContentType, validateJsonBody, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("TestHolaRoutes", "testHola", {
    requestId,
    endpoint: "/testhola",
    ip: req.ip
  });

  logger.infoWithContext("POST /api/testhola called", context);

  const body = req.body || {};
  const hello = body.hello;

  // Validate the client's HOLA message
  const validation = validateHolaMessage(hello);

  if (!validation.valid) {
    const duration = Date.now() - startTime;

    logger.infoWithContext("HOLA validation failed", {
      ...context,
      reason: validation.reason,
      checks: validation.checks,
      duration
    });

    logger.metric("testhola_validation", duration, {
      result: "invalid",
      reason: validation.reason
    });

    return res.status(400).json({
      valid: false,
      reason: validation.reason,
      checks: validation.checks,
      requestId
    });
  }

  // Validate timestamp freshness (5 minute window)
  const tsMs = Date.parse(validation.isoTimestamp);
  const tsSeconds = Math.floor(tsMs / 1000);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = nowSeconds - tsSeconds;
  const maxAgeSeconds = 5 * 60; // 5 minutes

  if (ageSeconds < 0 || ageSeconds > maxAgeSeconds) {
    const duration = Date.now() - startTime;
    const reason = `Timestamp stale or future: age is ${ageSeconds}s, max allowed is ${maxAgeSeconds}s`;

    logger.infoWithContext("HOLA timestamp validation failed", {
      ...context,
      reason,
      ageSeconds,
      maxAgeSeconds,
      duration
    });

    logger.metric("testhola_validation", duration, {
      result: "stale",
      ageSeconds
    });

    return res.status(400).json({
      valid: false,
      reason,
      checks: {
        ...validation.checks,
        timestampFresh: false
      },
      requestId
    });
  }

  // Validate signature using token owner's public key
  const message = `HOLA:${validation.tokenId}:${validation.isoTimestamp}:${validation.noncetsHex}:API.IDENTYCLAW.COM:`;
  const sigValidation = await validateSignature(validation.tokenId, message, validation.signatureB64);

  if (!sigValidation.valid) {
    const duration = Date.now() - startTime;

    logger.infoWithContext("HOLA signature validation failed", {
      ...context,
      reason: sigValidation.reason,
      tokenExists: sigValidation.tokenExists,
      signatureValid: sigValidation.signatureValid,
      duration
    });

    logger.metric("testhola_validation", duration, {
      result: "invalid_signature",
      reason: sigValidation.reason
    });

    return res.status(400).json({
      valid: false,
      reason: sigValidation.reason,
      checks: {
        ...validation.checks,
        timestampFresh: true,
        tokenExists: sigValidation.tokenExists,
        tokenActive: sigValidation.tokenActive,
        signatureValid: sigValidation.signatureValid,
        publicKeyAvailable: sigValidation.publicKeyAvailable
      },
      requestId
    });
  }

  // All validations passed - generate a valid HOLA response using roditclient's key pair
  const holaResponse = await generateHolaResponse();

  if (!holaResponse.success) {
    const duration = Date.now() - startTime;

    logger.errorWithContext("Failed to generate HOLA response", {
      ...context,
      error: holaResponse.error,
      duration
    });

    logger.metric("testhola_response", duration, {
      result: "error"
    });

    return res.status(500).json({
      valid: true,
      peerTokenId: validation.tokenId,
      peerVerified: true,
      error: holaResponse.error,
      requestId
    });
  }

  const duration = Date.now() - startTime;

  logger.infoWithContext("HOLA validation successful, responding with server HOLA", {
    ...context,
    peerTokenId: validation.tokenId,
    serverTokenId: holaResponse.tokenId,
    duration
  });

  logger.metric("testhola_success", duration, {
    result: "success"
  });

  return res.status(200).json({
    valid: true,
    peerTokenId: validation.tokenId,
    peerVerified: true,
    hello: holaResponse.hello,
    serverTokenId: holaResponse.tokenId,
    serverTimestamp: holaResponse.timestamp,
    checks: {
      formatValid: true,
      checksumValid: true,
      timestampValid: true,
      timestampFresh: true,
      noncetsValid: true,
      tokenExists: true,
      tokenActive: true,
      signatureValid: true,
      publicKeyAvailable: true
    },
    requestId
  });
});

module.exports = router;
