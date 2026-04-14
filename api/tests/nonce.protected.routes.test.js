const express = require("express");
const request = require("supertest");

const nonceRoutes = require("../src/routes/nonce.protected.routes");

function createApp() {
  const app = express();
  app.use(express.json());

  // Mock roditClient with authenticate middleware
  app.locals.roditClient = {
    authenticate: (req, res, next) => {
      req.user = { id: "test-user", sub: "test-user;sub=testtoken" };
      next();
    }
  };

  app.use("/api", nonceRoutes);
  return app;
}

describe("GET /api/noncets", () => {
  test("returns concatenation-ready noncets and underlying fields", async () => {
    const app = createApp();

    const res = await request(app).get("/api/noncets");

    expect(res.status).toBe(200);
    expect(typeof res.body.noncets).toBe("string");
    expect(typeof res.body.timestamp).toBe("string");
    expect(typeof res.body.requestId).toBe("string");

    // timestamp should be a valid ISO-8601 date-time string
    expect(Number.isNaN(Date.parse(res.body.timestamp))).toBe(false);

    // noncets should be of the form :<timestamp>:<NONCETS_HEX>:
    const noncets = res.body.noncets;
    expect(noncets.startsWith(":"));
    expect(noncets.endsWith(":"));

    const inner = noncets.slice(1, -1);
    const lastColon = inner.lastIndexOf(":");
    expect(lastColon).toBeGreaterThan(0);

    const timestampPart = inner.slice(0, lastColon);
    const noncetsHexPart = inner.slice(lastColon + 1);

    expect(timestampPart).toBe(res.body.timestamp);
    // noncetsHexPart should be uppercase hex
    expect(/^[0-9A-F]+$/.test(noncetsHexPart)).toBe(true);
  });
});
