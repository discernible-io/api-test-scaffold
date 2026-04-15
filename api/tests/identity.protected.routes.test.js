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
      expect(res.body.dn).toBeDefined();
      expect(res.body.dn.nameSharedWithFamily).toBe("Smith");
      expect(res.body.dn.contactUri).toBe("email:gmail.com:alice");
      expect(res.body.face).toBeDefined();
      expect(res.body.face.checksumValid).toBe(true);
      expect(res.body.face.categories).toBeDefined();
      expect(res.body.metadata).toBeDefined();
      expect(res.body.metadata.userselected_dn_info).toBeDefined();
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
      expect(res.body.dn).toBeNull();
      expect(res.body.face).toBeDefined();
      expect(res.body.metadata).toBeDefined();
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
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("IDENTITY_SUB_MISSING");
    });

    test("returns 404 when token not found on NEAR", async () => {
      nearIdentityService.getToken.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get("/api/me/identity");

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
      expect(res.body.error.code).toBe("IDENTITY_NOT_FOUND");
      expect(res.body.error.details).toMatchObject({ tokenId: "pkncjdbdefcp" });
    });
  });
});
