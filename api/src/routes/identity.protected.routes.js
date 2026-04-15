const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const nacl = require("tweetnacl");
const { logger, blockchainService, nearorg_rpc_listpublicagents, errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;
const { getUserRateLimiter } = require("../middleware/user-rate-limit");
const nearIdentityService = require("../services/near-identity.service");
const { decodeFacialTokenId } = require("../services/face-decoder.service");
const { validateHexNonce, computeHelloChecksum } = require("../services/nonce-encoding.service");
const {
  validateContentType,
  validateTokenIdParam,
  validateJsonBody,
  validateLimitParam
} = require("../middleware/request-validation");

const CONTACT_URI_ATTRIBUTE_NAME = "CONTACTURI";

// Authentication middleware - uses app.locals.roditClient
const authenticate = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    const requestId = req.requestId || ulid();
    return sendError(res, {
      statusCode: 503,
      requestId,
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service unavailable"
    });
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

router.get("/me/identity", authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "getMyIdentity", {
    requestId,
    endpoint: "/me/identity",
    ip: req.ip
  });

  logger.infoWithContext("GET /api/me/identity called", context);

  const userPayload = req.user;

  if (!userPayload || typeof userPayload.sub !== "string") {
    logger.warnWithContext("/me/identity missing or invalid sub in JWT payload", context);

    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "IDENTITY_SUB_MISSING",
      message: "JWT payload is missing required sub field for identity derivation"
    });
  }

  const subParts = userPayload.sub.split(";sub=");
  const tokenId = subParts.length > 1 && subParts[1] ? subParts[1] : null;

  if (!tokenId) {
    logger.warnWithContext("/me/identity could not parse caller tokenId from sub", {
      ...context,
      cause: "JWT sub field missing ;sub= segment"
    });

    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "IDENTITY_TOKENID_PARSE_FAILED",
      message: "Unable to parse caller tokenId from JWT sub field"
    });
  }

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.token_id) {
      logger.infoWithContext("/me/identity NEAR token not found", {
        ...context,
        tokenId
      });

      return sendError(res, {
        statusCode: 404,
        requestId,
        code: "IDENTITY_NOT_FOUND",
        message: "RODiT identity not found",
        details: { tokenId }
      });
    }

    if (token.owner_id && userPayload && typeof userPayload.aud === "string") {
      const expectedOwner = userPayload.aud;
      if (token.owner_id !== expectedOwner) {
        logger.warnWithContext("/me/identity owner mismatch between JWT and NEAR token", {
          ...context,
          tokenId,
          tokenOwnerId: token.owner_id,
          jwtAud: userPayload.aud
        });
      }
    }

    // Parse DN from metadata
    let dn = null;
    if (token.metadata && token.metadata.userselected_dn) {
      const parsed = parseUserSelectedDn(token.metadata.userselected_dn);
      dn = {
        raw: token.metadata.userselected_dn,
        nameNotSharedWithFamily: parsed.nameNotSharedWithFamily,
        nameSharedWithFamily: parsed.nameSharedWithFamily,
        displayName: parsed.displayName,
        contactUri: parsed.contactUri,
        taxResidence: parsed.attributes.taxRes || null,
        inceptDateTime: parsed.attributes.inceptDateTime || null,
        inceptPlace: parsed.attributes.inceptPlace || null,
        taxPayerCode: parsed.attributes.taxPayer || null,
        address: parsed.attributes.address || null,
        creature: parsed.attributes.Creature || null,
        avatarUrl: parsed.attributes.AvatarURL || null,
        emojiUrl: parsed.attributes.EmojiURL || null,
        allAttributes: parsed.attributes
      };
    }

    // Decode facial description from tokenId
    const decoded = decodeFacialTokenId(tokenId);
    const face = decoded.valid ? {
      checksumValid: decoded.checksumValid,
      categories: decoded.categories
    } : null;

    // Build metadata with userselected_dn_info
    const rawDn = token.metadata && token.metadata.userselected_dn ? token.metadata.userselected_dn : null;
    const parsedDn = rawDn ? parseUserSelectedDn(rawDn) : null;

    const userselectedDnInfo = parsedDn && parsedDn.raw !== null ? {
      raw: parsedDn.raw,
      attributes: parsedDn.attributes,
      contactUri: parsedDn.contactUri,
      contactAttribute: parsedDn.contactAttribute,
      nameNotSharedWithFamily: parsedDn.nameNotSharedWithFamily,
      nameSharedWithFamily: parsedDn.nameSharedWithFamily,
      displayName: parsedDn.displayName,
      isEmpty: parsedDn.isEmpty
    } : null;

    const metadataSource = token && Object.prototype.hasOwnProperty.call(token, "metadata") ? token.metadata : undefined;
    let metadata = metadataSource;

    if (metadataSource && typeof metadataSource === "object" && metadataSource !== null && !Array.isArray(metadataSource)) {
      metadata = {
        ...metadataSource,
        userselected_dn_info: userselectedDnInfo
      };
    } else if (userselectedDnInfo) {
      metadata = {
        userselected_dn: rawDn,
        userselected_dn_info: userselectedDnInfo
      };
    }

    const duration = Date.now() - startTime;
    logger.infoWithContext("Self-identification successful", {
      ...context,
      duration,
      hasDn: !!dn,
      hasFace: !!face
    });

    logger.metric("me_identity_retrieval", duration, {
      operation: "getMyIdentity",
      result: "success",
      hasDn: !!dn,
      hasFace: !!face
    });

    return res.status(200).json({
      tokenId: token.token_id,
      dn,
      face,
      metadata: metadata === undefined ? null : metadata,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in /api/me/identity",
      { ...context, tokenId, duration },
      error,
      "me_identity_error",
      { operation: "getMyIdentity", result: "error", duration }
    );

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "IDENTITY_LOOKUP_FAILED",
      message: error.message
    });
  }
});

router.post("/identity/verify", validateContentType, validateJsonBody, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "verifyIdentity", {
    requestId,
    endpoint: "/identity/verify",
    ip: req.ip
  });

  logger.infoWithContext("POST /api/identity/verify called", context);

  const body = req.body || {};
  const hello = body.hello;
  const constraints = body.constraints || {};
  const maxAgeMs = Number.isFinite(constraints.maxAgeMs)
    ? constraints.maxAgeMs
    : 5 * 60 * 1000;

  const MAX_HELLO_LENGTH = 512;
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  if (maxAgeMs > MAX_AGE_MS) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "INVALID_CONSTRAINTS",
      message: `maxAgeMs must not exceed ${MAX_AGE_MS} milliseconds (24 hours)`
    });
  }

  if (!hello || typeof hello !== "string") {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_REQUIRED",
      message: "hello string is required"
    });
  }

  if (hello.length > MAX_HELLO_LENGTH) {
    logger.warnWithContext("Hello string exceeds maximum length", {
      ...context,
      helloLength: hello.length,
      maxLength: MAX_HELLO_LENGTH
    });
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_TOO_LONG",
      message: `hello string exceeds maximum length of ${MAX_HELLO_LENGTH} characters`,
      details: { actualLength: hello.length, maxLength: MAX_HELLO_LENGTH }
    });
  }

  const prefixLiteral = "HOLA:";
  if (!hello.startsWith(prefixLiteral)) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_INVALID",
      message: "Unsupported protocol; expected HOLA"
    });
  }

  const withoutPrefix = hello.slice(prefixLiteral.length);

  const lastColonIndex = withoutPrefix.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FORMAT_INVALID",
      message:
        "hello must have the form HOLA:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:API.IDENTYCLAW.COM:<base64url-signature>:<checksum>"
    });
  }

  const checksumCharRaw = withoutPrefix.slice(lastColonIndex + 1);
  const beforeChecksum = withoutPrefix.slice(0, lastColonIndex);

  const sigColonIndex = beforeChecksum.lastIndexOf(":");
  if (sigColonIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  const signatureB64 = beforeChecksum.slice(sigColonIndex + 1);
  const beforeSignature = beforeChecksum.slice(0, sigColonIndex);

  const protocolColonIndex = beforeSignature.lastIndexOf(":");
  if (protocolColonIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_MISSING",
      message: "API.IDENTYCLAW.COM protocol marker is required"
    });
  }

  const protocolMarker = beforeSignature.slice(protocolColonIndex + 1);
  if (protocolMarker !== "API.IDENTYCLAW.COM") {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_UNRECOGNIZED",
      message: "Expected API.IDENTYCLAW.COM protocol marker"
    });
  }

  const beforeProtocol = beforeSignature.slice(0, protocolColonIndex);

  const noncetsHexColonIndex = beforeProtocol.lastIndexOf(":");
  if (noncetsHexColonIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  const noncetsHexRaw = beforeProtocol.slice(noncetsHexColonIndex + 1);
  const tokenAndTimestamp = beforeProtocol.slice(0, noncetsHexColonIndex);

  const tokenColonIndex = tokenAndTimestamp.indexOf(":");
  if (tokenColonIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  const tokenId = tokenAndTimestamp.slice(0, tokenColonIndex);
  const isoTimestamp = tokenAndTimestamp.slice(tokenColonIndex + 1);

  if (!tokenId || !isoTimestamp || !noncetsHexRaw || !signatureB64 || !checksumCharRaw) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  if (!/^[a-z]{12}$/.test(tokenId)) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_TOKEN_ID_INVALID",
      message: "tokenId must be exactly 12 lowercase letters"
    });
  }

  const checksumChar = checksumCharRaw.toUpperCase();

  if (!/^[0-9A-F]$/.test(checksumChar)) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_CHECKSUM_INVALID",
      message: "checksum must be a single hexadecimal character"
    });
  }

  const checks = {
    tokenExists: false,
    tokenActive: false,
    signatureValid: false,
    timestampFresh: false,
    checksumValid: false
  };
  const failureReasons = [];

  const noncetsHexCheck = validateHexNonce(noncetsHexRaw);
  if (!noncetsHexCheck.valid) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_NONCETS_INVALID",
      message:
        noncetsHexCheck.reason ||
        "noncets_hex must contain only uppercase hex characters 0-9A-F"
    });
  }
  const noncetsHex = noncetsHexCheck.value;

  const checksumPrefix = `HOLA:${tokenId}:${isoTimestamp}:${noncetsHex}:API.IDENTYCLAW.COM:${signatureB64}:`;
  const expectedChecksum = computeHelloChecksum(checksumPrefix);
  if (checksumChar === expectedChecksum) {
    checks.checksumValid = true;
  } else {
    failureReasons.push("checksum_invalid");
  }

  let tsSeconds = null;
  const tsMs = Date.parse(isoTimestamp);
  if (!Number.isNaN(tsMs)) {
    tsSeconds = Math.floor(tsMs / 1000);
  }

  if (tsSeconds === null) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_TIMESTAMP_INVALID",
      message: "timestamp must be a valid ISO-8601 string"
    });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const ageSeconds = nowSeconds - tsSeconds;
  const maxAgeSeconds = Math.floor(maxAgeMs / 1000);
  if (ageSeconds >= 0 && ageSeconds <= maxAgeSeconds) {
    checks.timestampFresh = true;
  } else {
    failureReasons.push("timestamp_stale_or_future");
  }

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (token) {
      checks.tokenExists = true;
      // TODO: once contract metadata is finalized, determine active/expired status from metadata
      checks.tokenActive = true;
    }
    if (!token) {
      failureReasons.push("token_missing");
    }

    if (token && token.owner_id) {
      try {
        const publicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(
          token.owner_id
        );

        if (publicKeyBytes && publicKeyBytes.length === 32) {
          const message = `HOLA:${tokenId}:${isoTimestamp}:${noncetsHex}:API.IDENTYCLAW.COM:`;
          const messageBytes = new TextEncoder().encode(message);

          const signatureBytes = new Uint8Array(
            Buffer.from(signatureB64, "base64url")
          );

          const ok = nacl.sign.detached.verify(
            messageBytes,
            signatureBytes,
            publicKeyBytes
          );

          if (ok) {
            checks.signatureValid = true;
          } else {
            failureReasons.push("signature_invalid");
          }
        } else {
          logger.warnWithContext("IdentityRoutes: public key bytes unavailable or invalid length", {
            ...context,
            tokenId,
            ownerId: token.owner_id,
            keyLength: publicKeyBytes ? publicKeyBytes.length : 0
          });
          failureReasons.push("public_key_unavailable");
        }
      } catch (pkError) {
        logger.errorWithContext("IdentityRoutes: error fetching or using public key bytes", {
          ...context,
          tokenId,
          ownerId: token.owner_id,
          cause: pkError.name || "PublicKeyError",
          error: pkError.message
        });
        failureReasons.push("public_key_error");
      }
    }

    const verified =
      checks.tokenExists &&
      checks.tokenActive &&
      checks.timestampFresh &&
      checks.signatureValid &&
      checks.checksumValid;

    const responseBody = {
      verified,
      peerTokenId: tokenId,
      checks,
      failureReasons,
      signatureVerificationImplemented: true,
      requestId
    };

    const duration = Date.now() - startTime;
    logger.infoWithContext("Identity verification outcome", {
      ...context,
      tokenId,
      verified,
      failureReasons,
      checks,
      duration
    });

    logger.metric("identity_verify", duration, {
      operation: "verifyIdentity",
      result: verified ? "success" : "failed",
      failureCount: failureReasons.length
    });

    return res.status(200).json(responseBody);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error during identity verification",
      { ...context, duration },
      error,
      "identity_verify_error",
      { operation: "verifyIdentity", result: "error", duration }
    );

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "IDENTITY_VERIFICATION_FAILED",
      message: error.message
    });
  }
});

function parseUserSelectedDn(rawDn) {
  const MAX_DN_LENGTH = 2048;

  if (typeof rawDn !== "string") {
    return {
      raw: null,
      attributes: {},
      components: [],
      contactUri: null,
      contactAttribute: null,
      nameNotSharedWithFamily: null,
      nameSharedWithFamily: null,
      displayName: null,
      isEmpty: true
    };
  }

  const trimmedDn = rawDn.trim();

  if (trimmedDn.length === 0) {
    return {
      raw: "",
      attributes: {},
      components: [],
      contactUri: null,
      contactAttribute: null,
      nameNotSharedWithFamily: null,
      nameSharedWithFamily: null,
      displayName: null,
      isEmpty: true
    };
  }

  if (trimmedDn.length > MAX_DN_LENGTH) {
    logger.warnWithContext("DN exceeds maximum length, truncating", {
      component: "DNParser",
      length: trimmedDn.length,
      maxLength: MAX_DN_LENGTH
    });
    return {
      raw: trimmedDn.substring(0, MAX_DN_LENGTH),
      attributes: { ERROR: "DN_TRUNCATED" },
      components: [],
      contactUri: null,
      contactAttribute: null,
      nameNotSharedWithFamily: null,
      nameSharedWithFamily: null,
      displayName: "[DN TOO LONG]",
      isEmpty: false,
      truncated: true
    };
  }

  const components = splitDistinguishedName(trimmedDn)
    .map(parseDnComponent)
    .filter(Boolean);

  const attributes = {};

  for (const component of components) {
    if (Object.prototype.hasOwnProperty.call(attributes, component.attribute)) {
      const existing = attributes[component.attribute];
      if (Array.isArray(existing)) {
        existing.push(component.value);
      } else {
        attributes[component.attribute] = [existing, component.value];
      }
    } else {
      attributes[component.attribute] = component.value;
    }
  }

  const findComponent = (name) =>
    components.find(
      (component) => component.attribute.toUpperCase() === name.toUpperCase()
    ) || null;

  const contactComponent = findComponent(CONTACT_URI_ATTRIBUTE_NAME);

  const nameNotSharedComponent = findComponent("NNSWF");
  const nameSharedComponent = findComponent("NSWF");

  const displayNameParts = [];
  if (nameNotSharedComponent && nameNotSharedComponent.value) {
    displayNameParts.push(nameNotSharedComponent.value);
  }
  if (nameSharedComponent && nameSharedComponent.value) {
    displayNameParts.push(nameSharedComponent.value);
  }

  const displayName =
    displayNameParts.length > 0 ? displayNameParts.join(" ").trim() : null;

  return {
    raw: trimmedDn,
    attributes,
    components,
    contactUri: contactComponent ? contactComponent.value : null,
    contactAttribute: contactComponent ? contactComponent.attribute : null,
    nameNotSharedWithFamily: nameNotSharedComponent ? nameNotSharedComponent.value : null,
    nameSharedWithFamily: nameSharedComponent ? nameSharedComponent.value : null,
    displayName,
    isEmpty: components.length === 0
  };
}

function splitDistinguishedName(dn) {
  const parts = [];
  let current = "";
  let escapeNext = false;

  for (let i = 0; i < dn.length; i += 1) {
    const char = dn[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escapeNext = true;
      continue;
    }

    if (char === ",") {
      if (current.trim().length > 0) {
        parts.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }

  return parts.filter((part) => part.length > 0);
}

function parseDnComponent(component) {
  const separatorIndex = component.indexOf("=");

  if (separatorIndex === -1) {
    return null;
  }

  const attribute = component.slice(0, separatorIndex).trim();

  if (!attribute) {
    return null;
  }

  const rawValue = component.slice(separatorIndex + 1).trim();
  const value = unescapeDnValue(rawValue);

  return {
    attribute,
    value
  };
}

function unescapeDnValue(value) {
  if (!value) {
    return value;
  }

  let result = "";

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];

    if (char !== "\\") {
      result += char;
      continue;
    }

    if (i + 2 < value.length && isHexPair(value[i + 1], value[i + 2])) {
      const hex = value.slice(i + 1, i + 3);
      result += String.fromCharCode(parseInt(hex, 16));
      i += 2;
      continue;
    }

    if (i + 1 < value.length) {
      result += value[i + 1];
      i += 1;
    }
  }

  return result;
}

function isHexPair(first, second) {
  return /[0-9A-Fa-f]/.test(first) && /[0-9A-Fa-f]/.test(second);
}

router.get("/identity/token/:tokenId/full", validateTokenIdParam, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const tokenId = req.params.tokenId;
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "getTokenFull", {
    requestId,
    endpoint: "/identity/token/:tokenId/full",
    tokenId,
    ip: req.ip
  });

  logger.infoWithContext("GET /api/identity/token/:tokenId/full called", context);

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.token_id) {
      return sendError(res, {
        statusCode: 404,
        requestId,
        code: "IDENTITY_NOT_FOUND",
        message: "RODiT identity not found",
        details: { tokenId }
      });
    }

    // Parse DN from metadata
    let dn = null;
    if (token.metadata && token.metadata.userselected_dn) {
      const parsed = parseUserSelectedDn(token.metadata.userselected_dn);
      dn = {
        raw: token.metadata.userselected_dn,
        nameNotSharedWithFamily: parsed.nameNotSharedWithFamily,
        nameSharedWithFamily: parsed.nameSharedWithFamily,
        displayName: parsed.displayName,
        contactUri: parsed.contactUri,
        taxResidence: parsed.attributes.taxRes || null,
        inceptDateTime: parsed.attributes.inceptDateTime || null,
        inceptPlace: parsed.attributes.inceptPlace || null,
        taxPayerCode: parsed.attributes.taxPayer || null,
        address: parsed.attributes.address || null,
        creature: parsed.attributes.Creature || null,
        avatarUrl: parsed.attributes.AvatarURL || null,
        emojiUrl: parsed.attributes.EmojiURL || null,
        allAttributes: parsed.attributes
      };
    }

    // Decode facial description from tokenId
    const decoded = decodeFacialTokenId(tokenId);
    const face = decoded.valid ? {
      checksumValid: decoded.checksumValid,
      categories: decoded.categories
    } : null;

    const duration = Date.now() - startTime;
    logger.infoWithContext("Full identity retrieval successful", {
      ...context,
      duration,
      hasDn: !!dn,
      hasFace: !!face
    });

    logger.metric("identity_full_retrieval", duration, {
      operation: "getTokenFull",
      result: "success",
      hasDn: !!dn,
      hasFace: !!face
    });

    return res.status(200).json({
      tokenId,
      dn,
      face,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in full identity retrieval",
      { ...context, duration },
      error,
      "identity_full_error",
      { operation: "getTokenFull", result: "error", duration }
    );

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "IDENTITY_FULL_RETRIEVAL_FAILED",
      message: error.message
    });
  }
});

module.exports = router;
