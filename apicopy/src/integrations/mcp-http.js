const config = require("config");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { z } = require("zod");
const { logger } = require("@rodit/rodit-auth-be");

const { mcpService } = require("../routes/mcp.public.routes");

const API_VERSION = config.get("API_VERSION");
const SERVICE_NAME = config.has("SERVICE_NAME") ? config.get("SERVICE_NAME") : "IDClawserver API";

async function setupMcpHttpTransport(app) {
  if (!mcpService) {
    logger.warn("MCP service not available; skipping streamable HTTP transport setup", {
      component: "MCPHttpIntegration"
    });
    return;
  }

  const buildRequest = (ctxRequest = null) => {
    if (ctxRequest) {
      return ctxRequest;
    }

    return {
      app,
      headers: {},
      method: "MCP",
      user: {}
    };
  };

  const mcpServer = new McpServer({
    name: `${SERVICE_NAME} MCP`,
    version: API_VERSION,
    instructions: "Use these MCP tools to inspect resources, fetch documentation, and discover IDENTYCLAW capabilities."
  });

  mcpServer.tool(
    "list_resources",
    "Lists available MCP resources",
    {
      limit: z.number().optional().describe("Maximum number of resources to return"),
      cursor: z.string().optional().describe("Pagination cursor returned from previous call")
    },
    async ({ limit, cursor }, ctx) => {
      const result = await mcpService.listAvailableResources(buildRequest(ctx?.request), { limit, cursor });
      return { content: [{ type: "json", json: result }] };
    }
  );

  mcpServer.tool(
    "get_resource",
    "Retrieves a resource by URI",
    {
      uri: z.string().describe('Resource URI (e.g. "openapi:swagger")')
    },
    async ({ uri }, ctx) => {
      try {
        const result = await mcpService.getResource(uri, buildRequest(ctx?.request));
        return { content: [{ type: "json", json: result }] };
      } catch (error) {
        const isNotFound = error.statusCode === 404 || error.message?.includes("Unknown resource");
        return {
          content: [{
            type: "text",
            text: error.message || "Resource not found",
            isError: true
          }],
          isError: true
        };
      }
    }
  );

  const transport = new StreamableHTTPServerTransport({ server: mcpServer });
  await mcpServer.connect(transport);

  let handler;
  if (typeof transport.expressMiddleware === "function") {
    handler = transport.expressMiddleware();
  } else if (typeof transport.handleRequest === "function") {
    handler = (req, res) => transport.handleRequest(req, res);
  } else {
    logger.error("[MCP] Unsupported transport shape", {
      component: "MCPHttpIntegration",
      availableKeys: Object.keys(transport)
    });
    throw new TypeError("Unsupported MCP HTTP transport shape");
  }

  logger.info("[MCP] Streamable HTTP transport mounted", {
    component: "MCPHttpIntegration",
    handlerType: handler.name || "expressMiddleware"
  });

  app.use("/mcp", handler);
}

module.exports = { setupMcpHttpTransport };
