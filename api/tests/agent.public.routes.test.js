jest.mock("@rodit/rodit-auth-be", () => {
  const logger = {
    createLogContext: jest.fn(() => ({})),
    infoWithContext: jest.fn(),
    logErrorWithMetrics: jest.fn(),
    metric: jest.fn()
  };

  const buildErrorResponse = ({ requestId, code, message, details }) => ({
    error: { code, message, ...(details ? { details } : {}) },
    requestId,
    timestamp: new Date().toISOString()
  });

  const sendError = jest.fn((res, { statusCode = 500, requestId, code, message, details }) =>
    res.status(statusCode).json(buildErrorResponse({ requestId, code, message, details }))
  );

  return {
    logger,
    errorResponse: { sendError, buildErrorResponse }
  };
});

jest.mock("../src/services/public-agents.service", () => ({
  listPublicAgents: jest.fn()
}));

const express = require("express");
const request = require("supertest");

const agentRoutes = require("../src/routes/agent.public.routes");
const { listPublicAgents } = require("../src/services/public-agents.service");

function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", agentRoutes);
  return app;
}

describe("GET /api/agent/auth-params", () => {
  test("returns auth params with timestamp and nonce", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/auth-params");

    expect(res.status).toBe(200);
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.timestamp_iso).toBeDefined();
    expect(res.body.nonce).toBeDefined();
    expect(res.body.nonce_hex).toBeDefined();
    expect(res.body.nonce_length).toBe(32);
    expect(res.body.algorithm).toBe("randomBytes(32)_base64url");
    expect(res.body.purpose).toBeDefined();
    expect(res.body.requestId).toBeDefined();
  });

  test("nonce is base64url encoded 32 bytes", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/auth-params");

    expect(res.status).toBe(200);
    expect(res.body.nonce).toBeDefined();
    expect(typeof res.body.nonce).toBe("string");
    
    // Base64url should not have +, /, or =
    expect(res.body.nonce).not.toMatch(/[+\/=]/);
  });

  test("nonce_hex is hex encoded", async () => {
    const app = createApp();
    const res = await request(app).get("/api/agent/auth-params");

    expect(res.status).toBe(200);
    expect(res.body.nonce_hex).toBeDefined();
    expect(typeof res.body.nonce_hex).toBe("string");
    
    // Hex should only contain 0-9 and a-f
    expect(res.body.nonce_hex).toMatch(/^[0-9a-f]+$/i);
  });
});

describe("POST /api/agent/auth-params", () => {
  test("returns same auth params as GET", async () => {
    const app = createApp();
    
    const getRes = await request(app).get("/api/agent/auth-params");
    const postRes = await request(app).post("/api/agent/auth-params");

    expect(postRes.status).toBe(200);
    expect(postRes.body.timestamp).toBeDefined();
    expect(postRes.body.nonce).toBeDefined();
    expect(postRes.body.nonce_hex).toBeDefined();
  });
});

describe("GET /api/agents", () => {
  test("returns agents with facial descriptions", async () => {
    const mockResult = {
      list_agents: [
        { token_id: "aaaaaaaaaaaa" },
        { token_id: "bbbbbbbbbbbb" }
      ],
      nextCursor: null
    };

    listPublicAgents.mockResolvedValue(mockResult);

    const app = createApp();
    const res = await request(app).get("/api/agents");

    expect(res.status).toBe(200);
    expect(res.body.agents).toBeDefined();
    expect(Array.isArray(res.body.agents)).toBe(true);
    expect(res.body.agents.length).toBe(2);
    expect(res.body.agents[0].tokenId).toBe("aaaaaaaaaaaa");
    expect(res.body.agents[0].face).toBeDefined();
    expect(res.body.agents[0].face.checksumValid).toBe(true);
    expect(res.body.agents[0].face.categories).toBeDefined();
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.requestId).toBeDefined();
  });

  test("respects limit parameter", async () => {
    const mockResult = {
      list_agents: [
        { token_id: "aaaaaaaaaaaa" }
      ],
      nextCursor: null
    };

    listPublicAgents.mockResolvedValue(mockResult);

    const app = createApp();
    const res = await request(app).get("/api/agents?limit=10");

    expect(res.status).toBe(200);
    expect(listPublicAgents).toHaveBeenCalledWith({
      limit: 10,
      cursor: null
    });
  });

  test("respects cursor parameter", async () => {
    const mockResult = {
      list_agents: [
        { token_id: "bbbbbbbbbbbb" }
      ],
      nextCursor: "20"
    };

    listPublicAgents.mockResolvedValue(mockResult);

    const app = createApp();
    const res = await request(app).get("/api/agents?cursor=10");

    expect(res.status).toBe(200);
    expect(listPublicAgents).toHaveBeenCalledWith({
      limit: 20,
      cursor: "10"
    });
    expect(res.body.nextCursor).toBe("20");
  });

  test("returns empty array when no agents found", async () => {
    const mockResult = {
      list_agents: [],
      nextCursor: null
    };

    listPublicAgents.mockResolvedValue(mockResult);

    const app = createApp();
    const res = await request(app).get("/api/agents");

    expect(res.status).toBe(200);
    expect(res.body.agents).toEqual([]);
    expect(res.body.nextCursor).toBeNull();
  });

  test("handles invalid token IDs gracefully", async () => {
    const mockResult = {
      list_agents: [
        { token_id: "invalid123" }
      ],
      nextCursor: null
    };

    listPublicAgents.mockResolvedValue(mockResult);

    const app = createApp();
    const res = await request(app).get("/api/agents");

    expect(res.status).toBe(200);
    expect(res.body.agents[0].tokenId).toBe("invalid123");
    expect(res.body.agents[0].face).toBeNull();
  });

  test("returns 500 on error", async () => {
    listPublicAgents.mockRejectedValue(new Error("RPC error"));

    const app = createApp();
    const res = await request(app).get("/api/agents");

    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("AGENT_DISCOVERY_FAILED");
    expect(res.body.error.message).toBeDefined();
  });
});
