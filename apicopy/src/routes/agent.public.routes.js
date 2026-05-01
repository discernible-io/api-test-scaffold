const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { ulid } = require("ulid");
const { logger, errorResponse } = require("@rodit/rodit-auth-be");
const { listPublicAgents } = require("../services/public-agents.service");
const { decodeFacialTokenId } = require("../services/facialTokenId");
const { validateLimitParam } = require("../middleware/request-validation");
const { sendError } = errorResponse;

/**
 * @route GET /api/login/timestamp
 * @desc Public endpoint for AI agents to get synchronized timestamp for login
 * @access Public - No authentication required
 * 
 * Returns a synchronized timestamp and ISO string that agents can use
 * to construct proper /api/login requests. Both values are generated from
 * the same moment to ensure signature verification succeeds.
 */
router.get("/login/timestamp", (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("AgentRoutes", "getAuthParams", {
    requestId,
    endpoint: "/api/login/timestamp",
    ip: req.ip,
    userAgent: req.get("User-Agent")
  });

  try {
    // Generate Unix timestamp in seconds (as expected by /api/login)
    const timestamp = Math.floor(Date.now() / 1000);
    
    // CRITICAL: Generate ISO timestamp from the SAME Unix timestamp
    // The server reconstructs this exact string during signature verification
    // using: new Date(timestamp * 1000).toISOString()
    const timestampISO = new Date(timestamp * 1000).toISOString();

    const duration = Date.now() - startTime;
    
    logger.infoWithContext("Auth params generated for AI agent", {
      ...context,
      duration,
      timestamp
    });

    logger.metric("agent_auth_params_generate", duration, {
      operation: "getAuthParams",
      result: "success"
    });

    return res.status(200).json({
      timestamp,
      timestamp_iso: timestampISO,
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

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "AGENT_AUTH_PARAMS_FAILED",
      message: error.message
    });
  }
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

    const result = await listPublicAgents({
      limit,
      cursor
    });

    const agents = result && Array.isArray(result.list_agents)
      ? result.list_agents
      : [];

    // Decode facial descriptions from token IDs and extract Creature from metadata
    const agentsWithFaces = agents.map(agent => {
      const decoded = decodeFacialTokenId(agent.token_id);
      
      // Extract Creature from metadata if available
      let creature = null;
      if (agent.metadata && typeof agent.metadata === "object") {
        const extra = agent.metadata.extra;
        if (typeof extra === "string") {
          try {
            const parsed = JSON.parse(extra);
            creature = parsed.Creature || null;
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
      
      return {
        tokenId: agent.token_id,
        creature,
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

    const duration = Date.now() - startTime;
    logger.infoWithContext("Agent discovery completed successfully", {
      ...context,
      duration,
      agentCount: agentsWithFaces.length
    });

    return res.status(200).json({
      agents: agentsWithFaces,
      nextCursor,
      requestId,
      disclaimer: "The creature field and other agent metadata are self-declared by the agent. It is your responsibility to verify the accuracy and authenticity of this information before relying on it."
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error in public agent discovery",
      { ...context, duration, errorMessage: error.message, errorStack: error.stack },
      error,
      "agent_discovery_error",
      { operation: "listAgents", result: "error", duration }
    );

    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "AGENT_DISCOVERY_FAILED",
      message: error.message
    });
  }
});

module.exports = router;
