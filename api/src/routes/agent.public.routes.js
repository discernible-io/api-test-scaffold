const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { ulid } = require("ulid");
const { logger, nearorg_rpc_listpublicagents } = require("@rodit/rodit-auth-be");
const { decodeFacialTokenId } = require("../services/face-decoder.service");
const { validateLimitParam } = require("../middleware/request-validation");

/**
 * @route GET /api/agent/auth-params
 * @desc Public endpoint for AI agents to get timestamps and nonces for login
 * @access Public - No authentication required
 * 
 * AI agents often struggle with real-time data and random number generation.
 * This endpoint provides pre-generated timestamps and nonces that agents
 * can use to construct proper /api/login requests.
 */
router.get("/agent/auth-params", (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("AgentRoutes", "getAuthParams", {
    requestId,
    endpoint: "/agent/auth-params",
    ip: req.ip,
    userAgent: req.get("User-Agent")
  });

  try {
    // Generate Unix timestamp in seconds (as expected by /api/login)
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Generate a random nonce (32 bytes for NEP-413 compatibility)
    const nonceBytes = crypto.randomBytes(32);
    const nonceBase64Url = Buffer.from(nonceBytes).toString("base64url");
    
    // Also provide a hex-encoded nonce for legacy compatibility
    const nonceHex = nonceBytes.toString("hex");
    
    // ISO timestamp for reference
    const timestampISO = new Date().toISOString();

    const duration = Date.now() - startTime;
    
    logger.infoWithContext("Auth params generated for AI agent", {
      ...context,
      duration,
      timestamp,
      nonceLength: nonceBytes.length
    });

    logger.metric("agent_auth_params_generate", duration, {
      operation: "getAuthParams",
      result: "success"
    });

    return res.status(200).json({
      timestamp,
      timestamp_iso: timestampISO,
      nonce: nonceBase64Url,
      nonce_hex: nonceHex,
      nonce_length: nonceBytes.length,
      algorithm: "randomBytes(32)_base64url",
      purpose: "Use these values to construct /api/login requests",
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.logErrorWithMetrics(
      "Error generating auth params for AI agent",
      { ...context, duration },
      error,
      "agent_auth_params_error",
      { operation: "getAuthParams", result: "error", duration }
    );

    return res.status(500).json({
      error: "Failed to generate authentication parameters",
      message: error.message,
      requestId
    });
  }
});

/**
 * @route POST /api/agent/auth-params
 * @desc Alternative POST endpoint for AI agents that prefer POST requests
 * @access Public - No authentication required
 */
router.post("/agent/auth-params", (req, res) => {
  // Reuse the GET handler logic
  req.method = "GET";
  return router.handle(req, res);
});

/**
 * @route GET /api/agents
 * @desc Public endpoint to browse RODiT token holders with facial descriptions
 * @access Public - No authentication required
 * 
 * Returns a paginated list of all RODiT token holders with their facial
 * descriptions decoded from token IDs. For detailed identity info including
 * DN and full metadata, use the protected /api/identity/token/{tokenId}/full endpoint.
 */
router.get("/agents", validateLimitParam, async (req, res) => {
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

  const context = logger.createLogContext("AgentRoutes", "listAgents", {
    requestId,
    endpoint: "/agents",
    ip: req.ip,
    limit,
    cursor
  });

  try {
    logger.infoWithContext("Public agent discovery requested", context);

    const result = await nearorg_rpc_listpublicagents({
      limit,
      cursor
    });

    const agents = result && Array.isArray(result.list_agents)
      ? result.list_agents
      : [];

    // Decode facial descriptions from token IDs
    const agentsWithFaces = agents.map(agent => {
      const decoded = decodeFacialTokenId(agent.token_id);
      return {
        tokenId: agent.token_id,
        face: decoded.valid ? {
          checksumValid: decoded.checksumValid,
          categories: decoded.categories
        } : null
      };
    });

    const nextCursor =
      result && Object.prototype.hasOwnProperty.call(result, "nextCursor")
        ? result.nextCursor
        : null;

    return res.status(200).json({
      agents: agentsWithFaces,
      nextCursor,
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in public agent discovery",
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

module.exports = router;
