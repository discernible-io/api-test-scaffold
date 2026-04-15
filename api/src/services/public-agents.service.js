const { ulid } = require("ulid");
const { logger } = require("@rodit/rodit-auth-be");

const NEAR_RPC_URL = process.env.NEAR_RPC_URL || "https://rpc.mainnet.near.org";
const NEAR_CONTRACT_ID = process.env.NEAR_CONTRACT_ID || "rodit.near";

/**
 * Fetch list of public RODiT agents from NEAR blockchain
 * Uses the rodit_tokens smart contract method to retrieve paginated list
 * 
 * @param {Object} options - Query options
 * @param {number} [options.limit=20] - Number of agents to return (max 100)
 * @param {string|number} [options.cursor] - Pagination cursor (from_index)
 * @returns {Promise<Object>} Result with list_agents array and nextCursor
 */
async function listPublicAgents(options = {}) {
  const { limit = 20, cursor } = options;
  const from_index = cursor ? cursor : null;
  const requestId = ulid();
  const startTime = Date.now();

  const context = logger.createLogContext(
    "PublicAgentsService",
    "listPublicAgents",
    {
      requestId,
      limit,
      cursor
    }
  );

  try {
    logger.debugWithContext("Fetching public agents list from NEAR blockchain", context);

    // Build RPC call to rodit_tokens method
    const args = { from_index, limit };
    const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");

    const rpcPayload = {
      jsonrpc: "2.0",
      id: NEAR_CONTRACT_ID,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: NEAR_CONTRACT_ID,
        method_name: "rodit_tokens",
        args_base64: argsBase64
      }
    };

    const rpcStart = Date.now();
    const response = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rpcPayload)
    });
    const rpcDuration = Date.now() - rpcStart;

    if (!response.ok) {
      logger.metric("near_rpc_calls", rpcDuration, {
        result: "failure",
        method: "list_public_agents",
        status_code: response.status
      });
      throw new Error(`NEAR RPC error: HTTP ${response.status}`);
    }

    const parsed = await response.json();
    const resultBase64 = parsed.result?.result;

    if (!resultBase64) {
      logger.debugWithContext("No agents found in NEAR response", context);
      return { list_agents: [], nextCursor: null };
    }

    // Decode base64 response
    const buf = Buffer.from(resultBase64, "base64");
    const decoded = new TextDecoder().decode(buf);
    const payload = JSON.parse(decoded);

    const totalDuration = Date.now() - startTime;
    logger.metric("near_rpc_calls", totalDuration, {
      result: "success",
      method: "list_public_agents"
    });

    logger.debugWithContext("Public agents list retrieved successfully", {
      ...context,
      duration: totalDuration,
      agentCount: payload?.length || 0
    });

    // Transform response with pagination cursor
    const transformedResponse = {
      list_agents: payload || [],
      nextCursor: payload && payload.length === limit ? (from_index || 0) + limit : null
    };

    return transformedResponse;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error fetching public agents from NEAR",
      { ...context, duration },
      error,
      "near_rpc_error",
      { operation: "list_public_agents", result: "error", duration }
    );
    throw error;
  }
}

module.exports = {
  listPublicAgents
};
