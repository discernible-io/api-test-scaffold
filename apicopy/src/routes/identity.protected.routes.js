const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const nacl = require("tweetnacl");
const base32 = require("hi-base32");
const { logger, blockchainService, nearorg_rpc_listpublicagents, errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;
const { getUserRateLimiter } = require("../middleware/user-rate-limit");
const nearIdentityService = require("../services/near-identity.service");
const { decodeFacialTokenId } = require("../services/facialTokenId");
const { validateHexNonce, computeHelloChecksum } = require("../services/nonce-encoding.service");
const {
  validateContentType,
  validateTokenIdParam,
  validateJsonBody,
  validateLimitParam
} = require("../middleware/request-validation");

const CONTACT_URI_ATTRIBUTE_NAME = "CONTACTURI";

function decodeBase32ToBytes(value) {
  const raw = String(value || "").toUpperCase().replace(/=+$/g, "");
  if (!/^[A-Z2-7]+$/.test(raw)) {
    throw new Error("Invalid base32 input");
  }
  const normalized = raw;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 8) * 8, "=");
  return new Uint8Array(base32.decode.asBytes(padded));
}

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
    logger.debugWithContext("/me/identity missing or invalid sub in JWT payload", context);

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
    logger.debugWithContext("/me/identity could not parse caller tokenId from sub", {
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
        logger.debugWithContext("/me/identity owner mismatch between JWT and NEAR token", {
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
      notAfter: token.metadata && token.metadata.not_after ? token.metadata.not_after : null,
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
    logger.debugWithContext("Hello string exceeds maximum length", {
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

  // HOLA protocol is case-insensitive for Morse code compatibility
  // Canonical signed payloads are always uppercase before verification
  const normalizedHello = hello.toUpperCase();
  const prefixLiteral = "HOLA/";
  if (!normalizedHello.startsWith(prefixLiteral)) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_INVALID",
      message: "Unsupported protocol; expected HOLA"
    });
  }

  const withoutPrefix = normalizedHello.slice(prefixLiteral.length);

  const recipientSeparatorIndex = withoutPrefix.indexOf("/");
  if (recipientSeparatorIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_RECIPIENT_MISSING",
      message: "hello must include a destinatary field immediately after HOLA/"
    });
  }

  const recipientRaw = withoutPrefix.slice(0, recipientSeparatorIndex);
  const recipient = recipientRaw.length > 0 ? recipientRaw : "MUNDO";
  const afterRecipient = withoutPrefix.slice(recipientSeparatorIndex + 1);

  const lastSeparatorIndex = afterRecipient.lastIndexOf("/");
  if (lastSeparatorIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FORMAT_INVALID",
      message:
        "hello must have the form HOLA/<destinatary>/<tokenId>/<ISO8601-timestamp>/<noncets-hex>/API.IDENTYCLAW.COM/<base32-signature>/<checksum>"
    });
  }

  const checksumCharRaw = afterRecipient.slice(lastSeparatorIndex + 1);
  const beforeChecksum = afterRecipient.slice(0, lastSeparatorIndex);

  const signatureSeparatorIndex = beforeChecksum.lastIndexOf("/");
  if (signatureSeparatorIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  const signatureB64 = beforeChecksum.slice(signatureSeparatorIndex + 1);
  const beforeSignature = beforeChecksum.slice(0, signatureSeparatorIndex);

  const protocolSeparatorIndex = beforeSignature.lastIndexOf("/");
  if (protocolSeparatorIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_MISSING",
      message: "API.IDENTYCLAW.COM protocol marker is required"
    });
  }

  const protocolMarker = beforeSignature.slice(protocolSeparatorIndex + 1);
  if (protocolMarker !== "API.IDENTYCLAW.COM") {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_PROTOCOL_UNRECOGNIZED",
      message: "Expected API.IDENTYCLAW.COM protocol marker"
    });
  }

  const beforeProtocol = beforeSignature.slice(0, protocolSeparatorIndex);

  const noncetsHexSeparatorIndex = beforeProtocol.lastIndexOf("/");
  if (noncetsHexSeparatorIndex === -1) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required"
    });
  }

  const noncetsHexRaw = beforeProtocol.slice(noncetsHexSeparatorIndex + 1);
  const beforeNoncets = beforeProtocol.slice(0, noncetsHexSeparatorIndex);

  // Detect format: standard (8 fields) vs subagent (11 fields)
  // Standard: HOLA/<recipient>/<tokenId>/<timestamp>/<noncets>/API.IDENTYCLAW.COM/<sig>/<checksum>
  // Subagent: HOLA/<recipient>/<delegateID>/<issuerTokenId>/<publicKey>/<timestamp>/<noncets>/API.IDENTYCLAW.COM/<sig>/<checksum>
  // Note: fields.length counts fields BEFORE noncets (after recipient is already extracted)

  const fields = beforeNoncets.split("/");
  let isSubagentFormat = false;
  let tokenId = null;
  let isoTimestamp = null;
  let delegateId = null;
  let issuerTokenId = null;
  let subagentPublicKey = null;

  if (fields.length === 2) {
    // Old standard format: tokenId:timestamp
    tokenId = fields[0];
    isoTimestamp = fields[1];
  } else if (fields.length === 3) {
    // New standard format with recipient: recipient:tokenId:timestamp
    tokenId = fields[1];
    isoTimestamp = fields[2];
  } else if (fields.length === 4) {
    // Subagent format: delegateID:issuerTokenId:publicKey:timestamp
    isSubagentFormat = true;
    delegateId = fields[0];
    issuerTokenId = fields[1];
    subagentPublicKey = fields[2];
    isoTimestamp = fields[3];
    tokenId = issuerTokenId; // For token existence check
  } else {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FORMAT_INVALID",
      message: "Invalid HOLA format. Expected standard format (8 fields with recipient) or subagent format (11 fields)"
    });
  }

  if (!tokenId || !isoTimestamp || !noncetsHexRaw || !signatureB64 || !checksumCharRaw) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_FIELDS_MISSING",
      message: "Required fields are missing"
    });
  }

  if (!/^[A-Z]{12}$/.test(tokenId)) {
    return sendError(res, {
      statusCode: 400,
      requestId,
      code: "HELLO_TOKEN_ID_INVALID",
      message: isSubagentFormat ? "issuerTokenId must be exactly 12 letters" : "tokenId must be exactly 12 letters"
    });
  }

  // Validate subagent-specific fields
  if (isSubagentFormat) {
    if (!delegateId || delegateId.length < 1 || delegateId.length > 128) {
      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "HELLO_DELEGATE_ID_INVALID",
        message: "delegateID must be between 1 and 128 characters"
      });
    }

    if (!subagentPublicKey) {
      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "HELLO_PUBLIC_KEY_MISSING",
        message: "publicKey is required in subagent format"
      });
    }
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
  const warnings = [];
  const lookupTokenId = tokenId.toLowerCase();

  // Check if the recipient matches the authenticated user's token ID
  const authenticatedTokenId = req.user?.sub;
  if (
    authenticatedTokenId &&
    recipient.toUpperCase() !== String(authenticatedTokenId).toUpperCase()
  ) {
    warnings.push({
      code: "RECIPIENT_MISMATCH",
      message: `This HOLA message is intended for recipient '${recipient}', but you are authenticated as '${authenticatedTokenId}'. You are verifying a message not addressed to you, which is an indication of a "man in the middle attack"`
    });
  }

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
  const noncetsHex = noncetsHexCheck.original ?? noncetsHexCheck.value;

  // Build canonical signed payload based on format.
  // Canonicalization is strict: entire signed payload must be uppercase.
  let signedMessage;
  if (isSubagentFormat) {
    signedMessage = `HOLA/${recipient}/${delegateId}/${issuerTokenId}/${subagentPublicKey}/${isoTimestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;
  } else {
    signedMessage = `HOLA/${recipient}/${tokenId}/${isoTimestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;
  }
  const canonicalSignedMessage = signedMessage.toUpperCase();
  const checksumPrefix = `${canonicalSignedMessage}${signatureB64}/`;
  
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
    const token = await nearIdentityService.getToken(lookupTokenId);

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
        let publicKeyBytes;
        
        if (isSubagentFormat) {
          // For subagent format, use the provided public key
          try {
            publicKeyBytes = decodeBase32ToBytes(subagentPublicKey);
            if (publicKeyBytes.length !== 32) {
              logger.debugWithContext("IdentityRoutes: subagent public key invalid length", {
                ...context,
                delegateId,
                issuerTokenId,
                keyLength: publicKeyBytes.length
              });
              failureReasons.push("subagent_public_key_invalid_length");
              publicKeyBytes = null;
            }
          } catch (decodeError) {
            logger.debugWithContext("IdentityRoutes: failed to decode subagent public key", {
              ...context,
              delegateId,
              issuerTokenId,
              cause: decodeError.message
            });
            failureReasons.push("subagent_public_key_decode_failed");
            publicKeyBytes = null;
          }
        } else {
          // For standard format, fetch public key from blockchain
          publicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(
            token.owner_id
          );
        }

        if (publicKeyBytes && publicKeyBytes.length === 32) {
          // Build signed message based on format.
          // Canonicalization is strict: entire signed payload must be uppercase.
          let message;
          if (isSubagentFormat) {
            message = `HOLA/${recipient}/${delegateId}/${issuerTokenId}/${subagentPublicKey}/${isoTimestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;
          } else {
            message = `HOLA/${recipient}/${tokenId}/${isoTimestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;
          }
          const canonicalMessage = message.toUpperCase();
          const messageBytes = new TextEncoder().encode(canonicalMessage);

          const signatureBytes = decodeBase32ToBytes(signatureB64);

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
        } else if (!isSubagentFormat) {
          logger.debugWithContext("IdentityRoutes: public key bytes unavailable or invalid length", {
            ...context,
            tokenId: lookupTokenId,
            ownerId: token.owner_id,
            keyLength: publicKeyBytes ? publicKeyBytes.length : 0
          });
          failureReasons.push("public_key_unavailable");
        }
      } catch (pkError) {
        logger.errorWithContext("IdentityRoutes: error fetching or using public key bytes", {
          ...context,
          tokenId: lookupTokenId,
          ownerId: token.owner_id,
          isSubagentFormat,
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
      peerTokenId: lookupTokenId,
      destinatary: recipient,
      checks,
      failureReasons,
      signatureVerificationImplemented: true,
      requestId
    };

    // Add subagent-specific fields to response
    if (isSubagentFormat) {
      responseBody.isSubagentFormat = true;
      responseBody.delegateId = delegateId;
      responseBody.issuerTokenId = issuerTokenId;
    }

    if (warnings.length > 0) {
      responseBody.warnings = warnings;
    }

    const duration = Date.now() - startTime;
    logger.infoWithContext("Identity verification outcome", {
      ...context,
      tokenId: lookupTokenId,
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
      requestId,
      disclaimer: "The DN metadata including creature, name, contact URI, address, and other attributes are self-declared by the agent. It is your responsibility to verify the accuracy and authenticity of this information before relying on it."
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

router.post("/isauthorizedsigner", validateContentType, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "isauthorizedsigner", {
    requestId,
    endpoint: "/isauthorizedsigner",
    ip: req.ip
  });

  logger.infoWithContext("POST /api/isauthorizedsigner called", context);

  try {
    const { tokenId, base64HashOrDelegateSignerId, unixTimestamp, publicKey } = req.body;

    if (!base64HashOrDelegateSignerId || typeof base64HashOrDelegateSignerId !== "string") {
      logger.debugWithContext("isauthorizedsigner: missing or invalid base64HashOrDelegateSignerId", {
        ...context,
        hashOrDelegateIdType: typeof base64HashOrDelegateSignerId
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_HASH_OR_DELEGATE_ID_MISSING",
        message: "base64HashOrDelegateSignerId is required and must be a string (can be a DID, name, hash, or any identifier)"
      });
    }

    if (base64HashOrDelegateSignerId.length < 1 || base64HashOrDelegateSignerId.length > 128) {
      logger.debugWithContext("isauthorizedsigner: invalid base64HashOrDelegateSignerId length", {
        ...context,
        base64HashOrDelegateSignerId,
        length: base64HashOrDelegateSignerId.length
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_HASH_OR_DELEGATE_ID_INVALID",
        message: "base64HashOrDelegateSignerId must be between 1 and 128 characters"
      });
    }

    if (!tokenId || typeof tokenId !== "string") {
      logger.debugWithContext("isauthorizedsigner: missing or invalid tokenId", {
        ...context,
        tokenIdType: typeof tokenId
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_TOKEN_ID_MISSING",
        message: "tokenId is required and must be a string"
      });
    }

    if (!/^[a-z]{12}$/.test(tokenId)) {
      logger.debugWithContext("isauthorizedsigner: invalid tokenId format", {
        ...context,
        tokenId
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_TOKEN_ID_INVALID",
        message: "tokenId must be exactly 12 lowercase letters"
      });
    }

    if (unixTimestamp === undefined || unixTimestamp === null) {
      logger.debugWithContext("isauthorizedsigner: missing unixTimestamp", {
        ...context
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_TIMESTAMP_MISSING",
        message: "unixTimestamp is required"
      });
    }

    const timestamp = Number(unixTimestamp);
    if (!Number.isInteger(timestamp) || timestamp < 0) {
      logger.debugWithContext("isauthorizedsigner: invalid unixTimestamp", {
        ...context,
        unixTimestamp,
        parsed: timestamp
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_TIMESTAMP_INVALID",
        message: "unixTimestamp must be a non-negative integer (Unix timestamp in seconds)"
      });
    }

    if (!publicKey || typeof publicKey !== "string") {
      logger.debugWithContext("isauthorizedsigner: missing or invalid publicKey", {
        ...context,
        publicKeyType: typeof publicKey
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_PUBLIC_KEY_MISSING",
        message: "publicKey is required and must be a string (base64url-encoded Ed25519 public key)"
      });
    }

    let publicKeyBytes;
    try {
      publicKeyBytes = new Uint8Array(Buffer.from(publicKey, "base64url"));
    } catch (decodeError) {
      logger.debugWithContext("isauthorizedsigner: failed to decode publicKey from base64url", {
        ...context,
        cause: decodeError.message
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_PUBLIC_KEY_DECODE_FAILED",
        message: "publicKey must be a valid base64url-encoded string"
      });
    }

    if (publicKeyBytes.length !== 32) {
      logger.debugWithContext("isauthorizedsigner: invalid publicKey length", {
        ...context,
        length: publicKeyBytes.length,
        expected: 32
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "ISAUTHORIZEDSIGNER_PUBLIC_KEY_INVALID_LENGTH",
        message: "publicKey must decode to exactly 32 bytes (Ed25519 public key size)"
      });
    }

    const token = await nearIdentityService.getToken(tokenId);

    const checks = {
      tokenExists: false,
      tokenActive: false,
      publicKeyAuthorized: false
    };

    const failureReasons = [];

    if (!token) {
      logger.infoWithContext("isauthorizedsigner: token not found", {
        ...context,
        tokenId
      });

      return sendError(res, {
        statusCode: 404,
        requestId,
        code: "TOKEN_NOT_FOUND",
        message: "RODiT token not found on blockchain",
        details: { tokenId }
      });
    }

    checks.tokenExists = true;
    checks.tokenActive = true;

    if (!token.owner_id) {
      logger.debugWithContext("isauthorizedsigner: token has no owner_id", {
        ...context,
        tokenId
      });

      failureReasons.push("token_owner_missing");

      return res.status(200).json({
        authorized: false,
        tokenId,
        base64HashOrDelegateSignerId,
        checks,
        failureReasons,
        requestId
      });
    }

    try {
      const ownerPublicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(
        token.owner_id
      );

      if (!ownerPublicKeyBytes || ownerPublicKeyBytes.length !== 32) {
        logger.debugWithContext("isauthorizedsigner: owner public key unavailable or invalid length", {
          ...context,
          tokenId,
          ownerId: token.owner_id,
          keyLength: ownerPublicKeyBytes ? ownerPublicKeyBytes.length : 0
        });

        failureReasons.push("owner_public_key_unavailable");

        return res.status(200).json({
          authorized: false,
          tokenId,
          base64HashOrDelegateSignerId,
          checks,
          failureReasons,
          requestId
        });
      }

      const message = `${tokenId}:${base64HashOrDelegateSignerId}:${timestamp}:${publicKey}`;
      const messageBytes = new TextEncoder().encode(message);

      const signatureBytes = new Uint8Array(
        Buffer.from(req.body.signature || "", "base64url")
      );

      if (!req.body.signature || signatureBytes.length !== 64) {
        logger.debugWithContext("isauthorizedsigner: missing or invalid signature", {
          ...context,
          tokenId,
          signatureLength: signatureBytes.length,
          expected: 64
        });

        failureReasons.push("signature_missing_or_invalid");

        return res.status(200).json({
          authorized: false,
          tokenId,
          base64HashOrDelegateSignerId,
          checks,
          failureReasons,
          requestId
        });
      }

      const isAuthorized = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        ownerPublicKeyBytes
      );

      if (isAuthorized) {
        checks.publicKeyAuthorized = true;

        logger.infoWithContext("isauthorizedsigner: public key authorized", {
          ...context,
          tokenId,
          ownerId: token.owner_id
        });

        return res.status(200).json({
          authorized: true,
          tokenId,
          base64HashOrDelegateSignerId,
          checks,
          failureReasons: [],
          requestId
        });
      } else {
        logger.debugWithContext("isauthorizedsigner: signature verification failed", {
          ...context,
          tokenId,
          ownerId: token.owner_id
        });

        failureReasons.push("signature_verification_failed");

        return res.status(200).json({
          authorized: false,
          tokenId,
          base64HashOrDelegateSignerId,
          checks,
          failureReasons,
          requestId
        });
      }
    } catch (pkError) {
      logger.errorWithContext("isauthorizedsigner: error fetching or verifying public key", {
        ...context,
        tokenId,
        ownerId: token.owner_id,
        cause: pkError.name || "PublicKeyError",
        error: pkError.message
      });

      failureReasons.push("public_key_error");

      return res.status(200).json({
        authorized: false,
        tokenId,
        checks,
        failureReasons,
        requestId
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;

    logger.logErrorWithMetrics(
      "Error in isauthorizedsigner",
      { ...context, duration },
      error,
      "isauthorizedsigner_error",
      { operation: "isauthorizedsigner", result: "error", duration }
    );

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "ISAUTHORIZEDSIGNER_ERROR",
      message: error.message
    });
  }
});

module.exports = router;
