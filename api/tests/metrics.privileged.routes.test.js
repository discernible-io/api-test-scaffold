const express = require("express");
const request = require("supertest");

const metricsRoutes = require("../src/routes/metrics.privileged.routes");

function createAppWithMetrics(performanceServiceImpl = {}) {
  const app = express();
  app.use(express.json());

  // Minimal roditClient stub with authenticate/authorize and performanceService
  app.locals.roditClient = {
    authenticate: (req, res, next) => {
      req.user = { id: "admin", permissions: ["admin"] };
      next();
    },
    authorize: (req, res, next) => next(),
    getSessionManager: () => ({
      getAllSessions: async () => [
        {
          id: "s1",
          roditId: "r1",
          ownerId: "owner.near",
          createdAt: 0,
          expiresAt: 0,
          lastAccessedAt: 0,
          status: "active"
        }
      ],
      getActiveSessionCount: async () => 1
    })
  };

  app.locals.performanceService = {
    getMetrics: () => ({ requestCount: 1, errorCount: 0, requestsPerMinute: 1 }),
    getSystemMetrics: () => ({ cpu: 0.1, memory: 0.2 }),
    resetMetrics: jest.fn(),
    recordRequest: jest.fn(),
    recordMetric: jest.fn(),
    ...performanceServiceImpl
  };

  app.use("/api/metrics", metricsRoutes);
  return app;
}

describe("/api/metrics routes", () => {
  test("GET /api/metrics returns metrics payload", async () => {
    const app = createAppWithMetrics();
    const res = await request(app).get("/api/metrics");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("requestCount");
    expect(res.body).toHaveProperty("requests");
    expect(res.body).toHaveProperty("sessions");
  });

  test("GET /api/metrics/system returns system metrics", async () => {
    const app = createAppWithMetrics();
    const res = await request(app).get("/api/metrics/system");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("metrics");
    expect(res.body.metrics).toHaveProperty("cpu");
  });

  test("POST /api/metrics/reset resets metrics when admin", async () => {
    const resetFn = jest.fn();
    const app = createAppWithMetrics({ resetMetrics: resetFn });

    const res = await request(app).post("/api/metrics/reset");

    expect(res.status).toBe(200);
    expect(resetFn).toHaveBeenCalled();
  });
});
