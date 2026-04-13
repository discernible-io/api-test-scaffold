const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const nacl = require("tweetnacl");
const { logger, blockchainService, nearorg_rpc_listpublicagents } = require("@rodit/rodit-auth-be");
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

router.get("/identity/token/:tokenId", validateTokenIdParam, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const tokenId = req.params.tokenId;
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityProtectedRoutes", "getIdentityByToken", {
    requestId,
    endpoint: "/identity/token/:tokenId",
    tokenId,
    ip: req.ip
  });

  try {
    logger.infoWithContext("Protected identity lookup requested", context);

    const token = await nearIdentityService.getToken(tokenId);

    if (!token) {
      return res.status(404).json({
        error: "Identity not found",
        tokenId,
        requestId
      });
    }

    const rawDn =
      token &&
      token.metadata &&
      typeof token.metadata.userselected_dn === "string"
        ? token.metadata.userselected_dn
        : null;

    const parsedDn = parseUserSelectedDn(rawDn);

    const userselectedDnInfo =
      parsedDn.raw === null
        ? null
        : {
            raw: parsedDn.raw,
            attributes: parsedDn.attributes,
            contactUri: parsedDn.contactUri,
            contactAttribute: parsedDn.contactAttribute,
            nameNotSharedWithFamily: parsedDn.nameNotSharedWithFamily,
            nameSharedWithFamily: parsedDn.nameSharedWithFamily,
            displayName: parsedDn.displayName,
            isEmpty: parsedDn.isEmpty
          };

    const metadataSource =
      token && Object.prototype.hasOwnProperty.call(token, "metadata")
        ? token.metadata
        : undefined;

    let metadata = metadataSource;

    if (
      metadataSource &&
      typeof metadataSource === "object" &&
      metadataSource !== null &&
      !Array.isArray(metadataSource)
    ) {
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

    const identity = {
      ...token,
      metadata: metadata === undefined ? null : metadata
    };

    return res.status(200).json({
      tokenId,
      identity,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in protected identity lookup",
      { ...context, duration },
      error,
      "identity_lookup_error",
      { operation: "getIdentityByToken", result: "error", duration }
    );

    return res.status(500).json({
      error: "Failed to lookup identity",
      message: error.message,
      requestId
    });
  }
});

router.get("/agents", validateLimitParam, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();
  const rawLimit = req.query.limit;
  const rawCursor = req.query.cursor;

  let limit = parseInt(rawLimit, 10);
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = 20;
  }
  if (limit > 100) {
    limit = 100;
  }

  const cursor = rawCursor || null;

  const context = logger.createLogContext("IdentityProtectedRoutes", "listAgents", {
    requestId,
    endpoint: "/agents",
    ip: req.ip,
    limit,
    cursor
  });

  try {
    logger.infoWithContext("Protected agent discovery requested", context);

    const result = await nearorg_rpc_listpublicagents({
      limit,
      cursor
    });

    const agents = result && Array.isArray(result.list_agents)
      ? result.list_agents
      : [];

    const nextCursor =
      result && Object.prototype.hasOwnProperty.call(result, "nextCursor")
        ? result.nextCursor
        : null;

    return res.status(200).json({
      agents,
      nextCursor,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in protected agent discovery",
      { ...context, duration },
      error,
      "agent_discovery_error",
      { operation: "listAgents", result: "error", duration }
    );

    return res.status(500).json({
      error: "AgentDiscoveryFailed",
      message: error.message,
      requestId
    });
  }
});

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

    return res.status(400).json({
      error: "IdentityUnavailable",
      message: "JWT payload is missing required sub field for identity derivation",
      requestId
    });
  }

  const subParts = userPayload.sub.split(";sub=");
  const tokenId = subParts.length > 1 && subParts[1] ? subParts[1] : null;

  if (!tokenId) {
    logger.warnWithContext("/me/identity could not parse caller tokenId from sub", {
      ...context,
      cause: "JWT sub field missing ;sub= segment"
    });

    return res.status(400).json({
      error: "IdentityUnavailable",
      message: "Unable to parse caller tokenId from JWT sub field",
      requestId
    });
  }

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.token_id) {
      logger.infoWithContext("/me/identity NEAR token not found", {
        ...context,
        tokenId
      });

      return res.status(404).json({
        error: "IdentityNotFound",
        tokenId,
        requestId
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

    const rawDn =
      token &&
      token.metadata &&
      typeof token.metadata.userselected_dn === "string"
        ? token.metadata.userselected_dn
        : null;

    const parsedDn = parseUserSelectedDn(rawDn);

    const userselectedDnInfo =
      parsedDn.raw === null
        ? null
        : {
            raw: parsedDn.raw,
            attributes: parsedDn.attributes,
            contactUri: parsedDn.contactUri,
            contactAttribute: parsedDn.contactAttribute,
            nameNotSharedWithFamily: parsedDn.nameNotSharedWithFamily,
            nameSharedWithFamily: parsedDn.nameSharedWithFamily,
            displayName: parsedDn.displayName,
            isEmpty: parsedDn.isEmpty
          };

    const metadataSource =
      token && Object.prototype.hasOwnProperty.call(token, "metadata")
        ? token.metadata
        : undefined;

    let metadata = metadataSource;

    if (
      metadataSource &&
      typeof metadataSource === "object" &&
      metadataSource !== null &&
      !Array.isArray(metadataSource)
    ) {
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

    const identity = {
      ...token,
      metadata: metadata === undefined ? null : metadata
    };

    const duration = Date.now() - startTime;
    logger.infoWithContext("Self-identification successful", {
      ...context,
      duration,
      hasDn: !!rawDn
    });

    logger.metric("me_identity_retrieval", duration, {
      operation: "getMyIdentity",
      result: "success"
    });

    return res.status(200).json({
      tokenId: token.token_id,
      identity,
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

    return res.status(500).json({
      error: "IdentityLookupFailed",
      message: error.message,
      requestId
    });
  }
});

router.get("/me/face", authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "getMyFace", {
    requestId,
    endpoint: "/me/face",
    ip: req.ip
  });

  logger.infoWithContext("GET /api/me/face called", context);

  const userPayload = req.user;

  if (!userPayload || typeof userPayload.sub !== "string") {
    logger.warnWithContext("/me/face missing or invalid sub in JWT payload", context);

    return res.status(400).json({
      error: "FaceDescriptionUnavailable",
      message: "JWT payload is missing required sub field for face derivation",
      requestId
    });
  }

  const subParts = userPayload.sub.split(";sub=");
  const tokenId = subParts.length > 1 && subParts[1] ? subParts[1] : null;

  if (!tokenId) {
    logger.warnWithContext("/me/face could not parse caller tokenId from sub", {
      ...context,
      cause: "JWT sub field missing ;sub= segment"
    });

    return res.status(400).json({
      error: "FaceDescriptionUnavailable",
      message: "Unable to parse caller tokenId from JWT sub field",
      requestId
    });
  }

  const decoded = decodeFacialTokenId(tokenId);

  if (!decoded.valid) {
    logger.warnWithContext("/me/face tokenId failed facial decoding", {
      ...context,
      tokenId,
      reason: decoded.reason
    });

    return res.status(400).json({
      error: "FaceTokenIdInvalid",
      message: decoded.reason || "tokenId does not conform to facial encoding",
      tokenId,
      requestId
    });
  }

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.token_id) {
      logger.infoWithContext("/me/face NEAR token not found", {
        ...context,
        tokenId
      });

      return res.status(404).json({
        error: "IdentityNotFound",
        tokenId,
        requestId
      });
    }

    return res.status(200).json({
      tokenId: decoded.tokenId,
      faceDescription: {
        checksumValid: decoded.checksumValid,
        categories: decoded.categories
      },
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in /api/me/face",
      { ...context, tokenId, duration },
      error,
      "me_face_error",
      { operation: "getMyFace", result: "error", duration }
    );

    return res.status(500).json({
      error: "FaceDescriptionFailed",
      message: error.message,
      requestId
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

  if (!hello || typeof hello !== "string") {
    return res.status(400).json({
      error: "InvalidRequest",
      message: "hello string is required",
      requestId
    });
  }

  const prefixLiteral = "API.IDENTYCLAW.COM:";
  if (!hello.startsWith(prefixLiteral)) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "Unsupported protocol; expected API.IDENTYCLAW.COM",
      requestId
    });
  }

  const withoutPrefix = hello.slice(prefixLiteral.length);

  const lastColonIndex = withoutPrefix.lastIndexOf(":");
  if (lastColonIndex === -1) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message:
        "hello must have the form API.IDENTYCLAW.COM:<tokenId>:<ISO8601-timestamp>:<noncets-hex>:<base64url-signature>:<checksum>",
      requestId
    });
  }

  const checksumCharRaw = withoutPrefix.slice(lastColonIndex + 1);
  const beforeChecksum = withoutPrefix.slice(0, lastColonIndex);

  const sigColonIndex = beforeChecksum.lastIndexOf(":");
  if (sigColonIndex === -1) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required",
      requestId
    });
  }

  const signatureB64 = beforeChecksum.slice(sigColonIndex + 1);
  const beforeSignature = beforeChecksum.slice(0, sigColonIndex);

  const noncetsHexColonIndex = beforeSignature.lastIndexOf(":");
  if (noncetsHexColonIndex === -1) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required",
      requestId
    });
  }

  const noncetsHexRaw = beforeSignature.slice(noncetsHexColonIndex + 1);
  const tokenAndTimestamp = beforeSignature.slice(0, noncetsHexColonIndex);

  const tokenColonIndex = tokenAndTimestamp.indexOf(":");
  if (tokenColonIndex === -1) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required",
      requestId
    });
  }

  const tokenId = tokenAndTimestamp.slice(0, tokenColonIndex);
  const isoTimestamp = tokenAndTimestamp.slice(tokenColonIndex + 1);

  if (!tokenId || !isoTimestamp || !noncetsHexRaw || !signatureB64 || !checksumCharRaw) {
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "tokenId, timestamp, noncets_hex, signature and checksum are required",
      requestId
    });
  }

  const checksumChar = checksumCharRaw.toUpperCase();

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
    return res.status(400).json({
      error: "InvalidPeerHello",
      message:
        noncetsHexCheck.reason ||
        "noncets_hex must contain only uppercase hex characters 0-9A-F",
      requestId
    });
  }
  const noncetsHex = noncetsHexCheck.value;

  const checksumPrefix = `API.IDENTYCLAW.COM:${tokenId}:${isoTimestamp}:${noncetsHex}:${signatureB64}:`;
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
    return res.status(400).json({
      error: "InvalidPeerHello",
      message: "timestamp must be a valid ISO-8601 string",
      requestId
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
          const message = `API.IDENTYCLAW.COM:${tokenId}:${isoTimestamp}:${noncetsHex}:`;
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

    return res.status(500).json({
      error: "VerificationFailed",
      message: error.message,
      requestId
    });
  }
});

router.get("/identity/face/:tokenId", validateTokenIdParam, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const tokenId = req.params.tokenId;
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "getIdentityFace", {
    requestId,
    endpoint: "/identity/face/:tokenId",
    tokenId,
    ip: req.ip
  });

  logger.infoWithContext("GET /api/identity/face/:tokenId called", context);

  if (!tokenId) {
    return res.status(400).json({
      error: "InvalidRequest",
      message: "tokenId path parameter is required",
      requestId
    });
  }

  const decoded = decodeFacialTokenId(tokenId);

  if (!decoded.valid) {
    logger.warnWithContext("/identity/face tokenId failed facial decoding", {
      ...context,
      reason: decoded.reason
    });

    return res.status(400).json({
      error: "FaceTokenIdInvalid",
      message: decoded.reason || "tokenId does not conform to facial encoding",
      tokenId,
      requestId
    });
  }

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.token_id) {
      logger.infoWithContext("/identity/face NEAR token not found", context);

      return res.status(404).json({
        error: "IdentityNotFound",
        tokenId,
        requestId
      });
    }

    return res.status(200).json({
      tokenId: decoded.tokenId,
      faceDescription: {
        checksumValid: decoded.checksumValid,
        categories: decoded.categories
      },
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in /api/identity/face/:tokenId",
      { ...context, duration },
      error,
      "identity_face_error",
      { operation: "getIdentityFace", result: "error", duration }
    );

    return res.status(500).json({
      error: "FaceDescriptionFailed",
      message: error.message,
      requestId
    });
  }
});

function parseUserSelectedDn(rawDn) {
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

router.get("/identity/token/:tokenId/dn", validateTokenIdParam, authenticate, async (req, res) => {
  const requestId = req.requestId || ulid();
  const tokenId = req.params.tokenId;
  const startTime = Date.now();

  const context = logger.createLogContext("IdentityRoutes", "getTokenDn", {
    requestId,
    endpoint: "/identity/token/:tokenId/dn",
    tokenId,
    ip: req.ip
  });

  logger.infoWithContext("GET /api/identity/token/:tokenId/dn called", context);

  try {
    const token = await nearIdentityService.getToken(tokenId);

    if (!token || !token.metadata || !token.metadata.userselected_dn) {
      logger.infoWithContext("Token or DN not found", {
        ...context,
        hasToken: !!token,
        hasMetadata: !!(token && token.metadata),
        hasDn: !!(token && token.metadata && token.metadata.userselected_dn)
      });

      return res.status(404).json({
        error: "DnNotFound",
        message: "Token not found or does not have a Distinguished Name",
        tokenId,
        requestId
      });
    }

    const rawDn = token.metadata.userselected_dn;
    const parsed = parseUserSelectedDn(rawDn);

    const dnResponse = {
      tokenId,
      raw: rawDn,
      parsed: {
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
        emojiUrl: parsed.attributes.EmojiURL || null
      },
      allAttributes: parsed.attributes,
      requestId
    };

    const duration = Date.now() - startTime;
    logger.infoWithContext("DN retrieval successful", {
      ...context,
      duration,
      attributeCount: Object.keys(parsed.attributes).length
    });

    logger.metric("identity_dn_retrieval", duration, {
      operation: "getTokenDn",
      result: "success"
    });

    return res.status(200).json(dnResponse);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error retrieving DN",
      { ...context, duration },
      error,
      "identity_dn_error",
      { operation: "getTokenDn", result: "error", duration }
    );

    return res.status(500).json({
      error: "DnRetrievalFailed",
      message: error.message,
      requestId
    });
  }
});

module.exports = router;
