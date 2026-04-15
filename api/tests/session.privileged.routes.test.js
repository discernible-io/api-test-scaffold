const express = require("express");
const request = require("supertest");

const sessionRoutes = require("../src/routes/session.privileged.routes");

function createAppWithSessions(sessionManagerImpl = {}) {
  const app = express();
  app.use(express.json());

  // Minimal roditClient stub with authenticate/authorize and session manager
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
      getActiveSessionCount: async () => 1,
      cleanupExpiredSessions: async () => ({ removed: 0 }),
      closeSession: jest.fn().mockReturnValue(true),
      ...sessionManagerImpl
    })
  };

  app.use("/api/sessions", sessionRoutes);
  return app;
}

describe("/api/sessions routes", () => {
  test("GET /api/sessions/list_all returns list of sessions", async () => {
    const app = createAppWithSessions();
    const res = await request(app).get("/api/sessions/list_all");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sessions");
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  test("POST /api/sessions/cleanup returns cleanup stats", async () => {
    const app = createAppWithSessions();
    const res = await request(app)
      .post("/api/sessions/cleanup")
      .set("Content-Type", "application/json");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("stats");
  });

  test("POST /api/sessions/revoke requires sessionId", async () => {
    const app = createAppWithSessions();
    const res = await request(app).post("/api/sessions/revoke").send({});

    expect(res.status).toBe(400);
  });

  test("POST /api/sessions/revoke revokes session when sessionId provided", async () => {
    const closeSession = jest.fn().mockReturnValue(true);
    const app = createAppWithSessions({ closeSession });

    const res = await request(app)
      .post("/api/sessions/revoke")
      .send({ sessionId: "s1" });

    expect(res.status).toBe(200);
    expect(closeSession).toHaveBeenCalledWith("s1", "admin_termination");
  });
});
