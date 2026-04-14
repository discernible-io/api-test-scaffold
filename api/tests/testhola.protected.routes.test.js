jest.mock("../src/services/near-identity.service", () => ({
  getToken: jest.festn()
}));

const express = require("express");
const request = require("supertest");

const testholaRoutes = require("../src/routes/testhola.protected.routes");
const nearIdentityService = require("../src/services/near-identity.service");

function createApp() {
  const app = express();
  app.use(express.json());

  app.locals.roditClient = {
    authenticate: (req, res, next) => {
      req.user = {
        id: "test-user",
        sub: "bc=near.org;sc=contract.near;id=test;sub=aaaaaaaaaaaa",
        aud: "test-owner-id"
      };
      next();
    }
  };

  app.use("/api", testholaRoutes);
  return app;
}

describe("POST /api/testhola", () => {
  test("validates HOLA message and responds with server HOLA", async () => {
    const mockToken = {
      token_id: "aaaaaaaaaaaa",
      owner_id: "test-owner-id",
      metadata: {}
    };

    nearIdentityService.getToken.mockResolvedValue(mockToken);

    const app = createApp();
    // Use a valid HOLA message with correct checksum
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "HOLA:aaaaaaaaaaaa:2026-04-14T14:00:00.000Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:6"
      });

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.peerTokenId).toBe("aaaaaaaaaaaa");
    expect(res.body.peerVerified).toBe(true);
    expect(res.body.hello).toBeDefined();
    expect(res.body.hello).toMatch(/^HOLA:/);
    expect(res.body.requestId).toBeDefined();
  });

  test("returns 400 for missing hello parameter", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("Missing or invalid hello parameter");
  });

  test("returns 400 for invalid HOLA format", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "INVALID_FORMAT"
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("Unsupported protocol");
  });

  test("returns 400 for stale timestamp", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "HOLA:aaaaaaaaaaaa:2020-01-01T00:00:00.000Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:0"
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("stale or future");
  });

  test("returns 400 for invalid checksum", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "HOLA:aaaaaaaaaaaa:2026-04-14T14:00:00.000Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:Z"
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("Invalid checksum");
  });

  test("returns 400 when token not found", async () => {
    nearIdentityService.getToken.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "HOLA:aaaaaaaaaaaa:2026-04-14T14:00:00.000Z:4F9A3C7E2D1B9A4C:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:6"
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("Token not found");
  });

  test("returns 400 for invalid nonce format", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/testhola")
      .send({
        hello: "HOLA:aaaaaaaaaaaa:2026-04-14T14:00:00.000Z:INVALID:API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:6"
      });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("nonce must contain only");
  });

  test("returns 400 for hello exceeding max length", async () => {
    const app = createApp();
    const longHello = "HOLA:aaaaaaaaaaaa:2026-04-14T14:00:00.000Z:" + "A".repeat(500) + ":API.IDENTYCLAW.COM:n3FZ5kQ8-Lh2BsM1xY:6";
    
    const res = await request(app)
      .post("/api/testhola")
      .send({ hello: longHello });

    expect(res.status).toBe(400);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toContain("exceeds maximum length");
  });
});
