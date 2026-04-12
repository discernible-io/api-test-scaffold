const express = require("express");
const request = require("supertest");

jest.mock("../src/services/near-identity.service", () => ({
  getToken: jest.fn()
}));

const didRoutes = require("../src/routes/did.protected.routes");
const nearIdentityService = require("../src/services/near-identity.service");
const { blockchainService } = require("@rodit/rodit-auth-be");

function createApp() {
  const app = express();
  app.use(express.json());

  app.locals.roditClient = {
    authenticate: (req, res, next) => {
      req.user = { id: "test-user" };
      next();
    }
  };

  app.use("/.well-known/did", didRoutes);
  return app;
}

describe("DID protected routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    blockchainService.nearorg_rpc_fetchpublickeybytes.mockResolvedValue(
      Buffer.from("01".repeat(32), "hex")
    );
    nearIdentityService.getToken.mockResolvedValue({
      token_id: "sampletoken",
      owner_id: "0".repeat(64),
      metadata: {
        token_id: "sampletoken",
        subjectuniqueidentifier_url: "https://api.identyclaw.com",
        serviceprovider_id: "provider.near",
        openapijson_url: "https://api.identyclaw.com/openapi.json"
      }
    });
  });

  test("resolves did:rodit documents with MCP discovery endpoint", async () => {
    const app = createApp();

    const res = await request(app).get("/.well-known/did/rodit/sampletoken");

    expect(res.status).toBe(200);
    expect(res.body.id).toBe("did:rodit:sampletoken");
    expect(res.body.alsoKnownAs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^did:web:127\.0\.0\.1%3A\d+:token:sampletoken$/)
      ])
    );
    expect(typeof res.body.requestId).toBe("string");

    const discoveryService = res.body.service.find(
      (service) => service.type === "MCPDiscoveryService"
    );
    expect(discoveryService).toBeDefined();
    expect(discoveryService.serviceEndpoint).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/api\/mcp\/resources$/
    );

    const metadataService = res.body.service.find(
      (service) => service.type === "RoditTokenMetadata"
    );
    expect(metadataService).toBeDefined();
    expect(metadataService.serviceEndpoint.tokenId).toBe("sampletoken");
  });

  test("returns 404 when token cannot be resolved", async () => {
    nearIdentityService.getToken.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await request(app).get("/.well-known/did/rodit/missingtoken");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("DidNotFound");
  });

  test("requires DID query parameter for resolver", async () => {
    const app = createApp();

    const res = await request(app).get("/.well-known/did/resolve");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("DidRequired");
  });
});
