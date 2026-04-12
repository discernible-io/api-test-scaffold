const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const { logger, blockchainService } = require("@rodit/rodit-auth-be");

const nearIdentityService = require("../services/near-identity.service");
const { getUserRateLimiter } = require("../middleware/user-rate-limit");

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

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function encodeBase58(input) {
  if (!input) {
    return "";
  }

  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length === 0) {
    return "";
  }

  const digits = [0];

  for (let i = 0; i < buffer.length; i += 1) {
    let carry = buffer[i];

    for (let j = 0; j < digits.length; j += 1) {
      const value = digits[j] * 256 + carry;
      digits[j] = value % 58;
      carry = Math.floor(value / 58);
    }

    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let leadingZeroCount = 0;
  while (leadingZeroCount < buffer.length && buffer[leadingZeroCount] === 0) {
    leadingZeroCount += 1;
  }

  let result = "";
  for (let i = 0; i < leadingZeroCount; i += 1) {
    result += BASE58_ALPHABET[0];
  }

  for (let i = digits.length - 1; i >= 0; i -= 1) {
    result += BASE58_ALPHABET[digits[i]];
  }

  return result;
}

async function resolveTokenContext(tokenId, baseContext) {
  const token = await nearIdentityService.getToken(tokenId);
  if (!token) {
    logger.warnWithContext("DID resolution token not found", {
      ...baseContext,
      tokenId
    });
    return null;
  }

  const ownerAccountId = token.owner_id;
  let publicKeyBase58;

  try {
    const publicKeyBytes = await blockchainService.nearorg_rpc_fetchpublickeybytes(ownerAccountId);
    publicKeyBase58 = encodeBase58(Buffer.from(publicKeyBytes));
  } catch (error) {
    logger.errorWithContext("Failed to resolve owner public key for DID", {
      ...baseContext,
      tokenId,
      ownerAccountId,
      cause: error.name || "PublicKeyResolutionError",
      error: error.message
    });
    throw error;
  }

  return {
    token,
    ownerAccountId,
    publicKeyBase58
  };
}

function buildDidDocument({
  primaryDid,
  aliasDid,
  token,
  publicKeyBase58,
  baseUrl
}) {
  const verificationMethodId = `${primaryDid}#controller`;
  const metadata = (token && token.metadata) || {};
  const mcpDiscoveryEndpoint = baseUrl ? `${baseUrl}/api/mcp/resources` : "/api/mcp/resources";

  const serviceEndpoints = [
    {
      id: `${primaryDid}#metadata`,
      type: "RoditTokenMetadata",
      serviceEndpoint: {
        type: "RODiTMetadataDocument",
        tokenId: token.token_id,
        ownerAccountId: token.owner_id,
        subjectUniqueIdentifier: metadata.subjectuniqueidentifier_url || null,
        serviceProviderId: metadata.serviceprovider_id || null,
        metadata
      }
    },
    {
      id: `${primaryDid}#mcp-discovery`,
      type: "MCPDiscoveryService",
      serviceEndpoint: mcpDiscoveryEndpoint
    }
  ];

  const didDocument = {
    "@context": [
      "https://www.w3.org/ns/did/v1",
      {
        rodit: "https://identityclaw.com/ns/rodit#",
        IdentityVerification: "https://identityclaw.com/ns/services#IdentityVerification",
        RoditTokenMetadata: "https://identityclaw.com/ns/services#RoditTokenMetadata"
      }
    ],
    id: primaryDid,
    alsoKnownAs: aliasDid ? [aliasDid] : [],
    controller: token.owner_id,
    verificationMethod: [
      {
        id: verificationMethodId,
        type: "Ed25519VerificationKey2020",
        controller: primaryDid,
        publicKeyBase58
      }
    ],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
    service: serviceEndpoints
  };

  return didDocument;
}

function normalizeHostForDidWeb(host) {
  if (!host || typeof host !== "string") {
    return "api.identyclaw.com";
  }
  return host.replace(/:/g, "%3A");
}

function parseDidString(didValue) {
  if (typeof didValue !== "string") {
    const error = new Error("DID value must be a string");
    error.code = "INVALID_DID";
    throw error;
  }

  const trimmed = didValue.trim();
  if (trimmed.length === 0) {
    const error = new Error("DID value must not be empty");
    error.code = "INVALID_DID";
    throw error;
  }

  const match = trimmed.match(/^did:([a-z0-9]+):(.*)$/i);
  if (!match) {
    const error = new Error("DID value is not in a valid format");
    error.code = "INVALID_DID";
    throw error;
  }

  const method = match[1].toLowerCase();
  const remainder = match[2];

  if (method === "rodit") {
    if (!remainder) {
      const error = new Error("did:rodit identifier is missing the token ID");
      error.code = "INVALID_DID";
      throw error;
    }
    return { method, tokenId: remainder };
  }

  if (method === "web") {
    const parts = remainder.split(":");
    if (parts.length < 2) {
      const error = new Error("did:web identifier must include host and path segments");
      error.code = "INVALID_DID";
      throw error;
    }

    const hostSegment = decodeURIComponent(parts.shift());
    const tokenIndex = parts.findIndex(segment => segment.toLowerCase() === "token");
    if (tokenIndex === -1 || tokenIndex === parts.length - 1) {
      const error = new Error("did:web identifier must include ':token:<tokenId>' segment");
      error.code = "INVALID_DID";
      throw error;
    }

    const tokenIdSegment = parts[tokenIndex + 1];
    const tokenId = decodeURIComponent(tokenIdSegment);

    return { method, tokenId, webHost: hostSegment };
  }

  const error = new Error(`Unsupported DID method '${method}'`);
  error.code = "INVALID_DID";
  throw error;
}

function buildDidVariants({ method, tokenId, requestHost, webHostSegment }) {
  const roditDid = `did:rodit:${tokenId}`;
  const normalizedRequestHost = requestHost ? normalizeHostForDidWeb(requestHost) : null;
  const normalizedWebHost = webHostSegment ? normalizeHostForDidWeb(webHostSegment) : normalizedRequestHost;
  const webDid = normalizedWebHost
    ? `did:web:${normalizedWebHost}:token:${encodeURIComponent(tokenId)}`
    : null;

  if (method === "rodit") {
    return {
      primaryDid: roditDid,
      aliasDid: webDid
    };
  }

  if (method === "web") {
    if (!normalizedWebHost) {
      const error = new Error("Cannot construct did:web without host information");
      error.code = "INVALID_DID";
      throw error;
    }
    return {
      primaryDid: webDid,
      aliasDid: roditDid
    };
  }

  const error = new Error(`Unsupported DID method '${method}'`);
  error.code = "INVALID_DID";
  throw error;
}

async function respondWithDidDocument(req, res, { tokenId, method, webHostSegment, baseContext, requestId }) {
  const correlationId = requestId || baseContext.requestId || req.requestId || ulid();

  try {
    const tokenContext = await resolveTokenContext(tokenId, baseContext);
    if (!tokenContext) {
      return res.status(404).json({
        error: "DidNotFound",
        message: `No RODiT token found for tokenId '${tokenId}'`,
        requestId: correlationId
      });
    }

    const requestHost = req.get("host");
    const baseUrl = requestHost ? `${req.protocol}://${requestHost}` : null;
    const { primaryDid, aliasDid } = buildDidVariants({
      method,
      tokenId,
      requestHost,
      webHostSegment
    });

    const didDocument = buildDidDocument({
      primaryDid,
      aliasDid,
      token: tokenContext.token,
      publicKeyBase58: tokenContext.publicKeyBase58,
      baseUrl
    });

    return res.status(200).json({
      ...didDocument,
      requestId: correlationId
    });
  } catch (error) {
    if (error.code === "INVALID_DID") {
      logger.warnWithContext("Invalid DID resolution request", {
        ...baseContext,
        cause: error.name || "InvalidDid",
        error: error.message
      });
      return res.status(400).json({
        error: "InvalidDid",
        message: error.message,
        requestId: correlationId
      });
    }

    logger.errorWithContext("Failed to resolve DID document", {
      ...baseContext,
      cause: error.name || "DidResolutionError",
      error: error.message
    });

    return res.status(500).json({
      error: "DidResolutionFailed",
      message: error.message,
      requestId: correlationId
    });
  }
}

router.get("/rodit/:tokenId", authenticate, async (req, res) => {
  const requestId = ulid();
  const { tokenId } = req.params;

  const baseContext = logger.createLogContext("DidRoutes", "resolveRoditDid", {
    requestId,
    tokenId,
    endpoint: "/.well-known/did/rodit/:tokenId",
    ip: req.ip
  });

  logger.infoWithContext("Resolving did:rodit document", baseContext);

  return respondWithDidDocument(req, res, {
    tokenId,
    method: "rodit",
    baseContext,
    requestId
  });
});

router.get("/resolve", authenticate, async (req, res) => {
  const requestId = ulid();
  const did = req.query.did;

  const baseContext = logger.createLogContext("DidRoutes", "resolveDidString", {
    requestId,
    did,
    endpoint: "/.well-known/did/resolve",
    ip: req.ip
  });

  logger.infoWithContext("Resolving DID document from string", baseContext);

  if (!did) {
    return res.status(400).json({
      error: "DidRequired",
      message: "Query parameter 'did' is required",
      requestId
    });
  }

  let parsed;
  try {
    parsed = parseDidString(did);
  } catch (error) {
    logger.warnWithContext("Invalid DID string supplied", {
      ...baseContext,
      cause: error.name || "InvalidDid",
      error: error.message
    });
    return res.status(400).json({
      error: "InvalidDid",
      message: error.message,
      requestId
    });
  }

  return respondWithDidDocument(req, res, {
    tokenId: parsed.tokenId,
    method: parsed.method,
    webHostSegment: parsed.webHost,
    baseContext: {
      ...baseContext,
      method: parsed.method,
      tokenId: parsed.tokenId,
      webHost: parsed.webHost
    },
    requestId
  });
});

router.get("/web/token/:tokenId", authenticate, async (req, res) => {
  const requestId = ulid();
  const { tokenId } = req.params;

  const baseContext = logger.createLogContext("DidRoutes", "resolveWebDid", {
    requestId,
    tokenId,
    endpoint: "/.well-known/did/web/token/:tokenId",
    ip: req.ip
  });

  logger.infoWithContext("Resolving did:web document", baseContext);

  const host = req.get("host");

  return respondWithDidDocument(req, res, {
    tokenId,
    method: "web",
    webHostSegment: host,
    baseContext,
    requestId
  });
});

router.get("/web/token/:tokenId/did.json", authenticate, async (req, res) => {
  const requestId = ulid();
  const { tokenId } = req.params;

  const baseContext = logger.createLogContext("DidRoutes", "resolveWebDidJson", {
    requestId,
    tokenId,
    endpoint: "/.well-known/did/web/token/:tokenId/did.json",
    ip: req.ip
  });

  logger.infoWithContext("Resolving did:web JSON document", baseContext);

  const host = req.get("host");

  return respondWithDidDocument(req, res, {
    tokenId,
    method: "web",
    webHostSegment: host,
    baseContext,
    requestId
  });
});

module.exports = router;
