jest.mock("../src/services/near-identity.service", () => ({
  getToken: jest.fn()
}));

const express = require("express");
const request = require("supertest");

const identityRoutes = require("../src/routes/identity.protected.routes");
const nearIdentityService = require("../src/services/near-identity.service");

function createApp() {
  const app = express();
  app.use(express.json());

  app.locals.roditClient = {
    authenticate: (req, res, next) => {
      req.user = {
        id: "test-user",
        sub: "bc=near.org;sc=contract.near;id=test;sub=pkncjdbdefcp",
        aud: "test-owner-id"
      };
      next();
    }
  };

  app.use("/api", identityRoutes);
  return app;
}

describe("Identity Protected Routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("GET /api/me/identity", () => {
    test("returns caller's own identity with parsed DN info", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {
          userselected_dn: "NNSWF=Alice,NSWF=Smith,ContactURI=email:gmail.com:alice",
          openapijson_url: "https://example.com/openapi.json",
          not_after: "2036-04-01"
        }
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/me/identity");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.identity).toBeDefined();
      expect(res.body.identity.token_id).toBe("pkncjdbdefcp");
      expect(res.body.identity.metadata).toBeDefined();
      expect(res.body.identity.metadata.userselected_dn_info).toBeDefined();
      expect(res.body.identity.metadata.userselected_dn_info.displayName).toBe("Alice Smith");
      expect(res.body.identity.metadata.userselected_dn_info.nameNotSharedWithFamily).toBe("Alice");
      expect(res.body.identity.metadata.userselected_dn_info.nameSharedWithFamily).toBe("Smith");
      expect(res.body.identity.metadata.userselected_dn_info.contactUri).toBe("email:gmail.com:alice");
      expect(res.body.requestId).toBeDefined();
    });

    test("returns identity without DN info when DN is not present", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {
          openapijson_url: "https://example.com/openapi.json",
          not_after: "2036-04-01"
        }
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/me/identity");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.identity.metadata.userselected_dn_info).toBeNull();
    });

    test("returns 400 when JWT sub is missing", async () => {
      const app = express();
      app.use(express.json());

      app.locals.roditClient = {
        authenticate: (req, res, next) => {
          req.user = { id: "test-user" };
          next();
        }
      };

      app.use("/api", identityRoutes);

      const res = await request(app).get("/api/me/identity");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("IdentityUnavailable");
    });

    test("returns 404 when token not found on NEAR", async () => {
      nearIdentityService.getToken.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/api/me/identity");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("IdentityNotFound");
    });
  });

  describe("GET /api/identity/token/{tokenId}", () => {
    test("returns identity for a given token with parsed DN info", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {
          userselected_dn: "NNSWF=Bob,NSWF=Jones",
          openapijson_url: "https://example.com/openapi.json"
        }
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/identity/token/pkncjdbdefcp");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.identity.metadata.userselected_dn_info).toBeDefined();
      expect(res.body.identity.metadata.userselected_dn_info.nameNotSharedWithFamily).toBe("Bob");
      expect(res.body.identity.metadata.userselected_dn_info.nameSharedWithFamily).toBe("Jones");
      expect(res.body.identity.metadata.userselected_dn_info.displayName).toBe("Bob Jones");
    });

    test("returns 404 when token not found", async () => {
      nearIdentityService.getToken.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/api/identity/token/abcdefghijkl");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Identity not found");
    });
  });

  describe("GET /api/identity/token/{tokenId}/dn", () => {
    test("returns parsed DN attributes in structured format", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {
          userselected_dn: "NNSWF=Charlie,NSWF=Brown,ContactURI=email:example.com:charlie,taxRes=US"
        }
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/identity/token/pkncjdbdefcp/dn");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.raw).toBe("NNSWF=Charlie,NSWF=Brown,ContactURI=email:example.com:charlie,taxRes=US");
      expect(res.body.parsed).toBeDefined();
      expect(res.body.parsed.nameNotSharedWithFamily).toBe("Charlie");
      expect(res.body.parsed.nameSharedWithFamily).toBe("Brown");
      expect(res.body.parsed.displayName).toBe("Charlie Brown");
      expect(res.body.parsed.contactUri).toBe("email:example.com:charlie");
      expect(res.body.parsed.taxResidence).toBe("US");
      expect(res.body.allAttributes).toBeDefined();
      expect(res.body.requestId).toBeDefined();
    });

    test("returns 404 when token has no DN", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {}
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/identity/token/pkncjdbdefcp/dn");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("DnNotFound");
    });

    test("returns 404 when token not found", async () => {
      nearIdentityService.getToken.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/api/identity/token/abcdefghijkl/dn");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("DnNotFound");
    });
  });

  describe("GET /api/me/face", () => {
    test("returns facial description for authenticated caller", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {}
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/me/face");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.faceDescription).toBeDefined();
      expect(res.body.faceDescription.checksumValid).toBe(true);
      expect(res.body.faceDescription.categories).toBeDefined();
      expect(res.body.requestId).toBeDefined();
    });

    test("returns 400 for invalid facial token ID", async () => {
      const app = express();
      app.use(express.json());

      app.locals.roditClient = {
        authenticate: (req, res, next) => {
          req.user = {
            id: "test-user",
            sub: "bc=near.org;sc=contract.near;id=test;sub=INVALID123"
          };
          next();
        }
      };

      app.use("/api", identityRoutes);

      const res = await request(app).get("/api/me/face");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("FaceTokenIdInvalid");
    });
  });

  describe("GET /api/identity/face/{tokenId}", () => {
    test("returns facial description for a given token", async () => {
      const mockToken = {
        token_id: "pkncjdbdefcp",
        owner_id: "test-owner-id",
        metadata: {}
      };

      nearIdentityService.getToken.mockResolvedValue(mockToken);

      const app = createApp();
      const res = await request(app).get("/api/identity/face/pkncjdbdefcp");

      expect(res.status).toBe(200);
      expect(res.body.tokenId).toBe("pkncjdbdefcp");
      expect(res.body.faceDescription).toBeDefined();
      expect(res.body.faceDescription.checksumValid).toBe(true);
      expect(res.body.requestId).toBeDefined();
    });

    test("returns 400 for invalid facial token ID", async () => {
      const app = createApp();
      const res = await request(app).get("/api/identity/face/INVALID123");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("InvalidTokenIdFormat");
    });

    test("returns 404 when token not found", async () => {
      nearIdentityService.getToken.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/api/identity/face/pkncjdbdefcp");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("IdentityNotFound");
    });
  });
});
