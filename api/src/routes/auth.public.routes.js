const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");

// Import logger utilities from SDK
const { logger } = require("@rodit/rodit-auth-be");
const { validateContentType, validateJsonBody } = require("../middleware/request-validation");

// Authentication middleware - uses app.locals.roditClient
const authenticate = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    return res.status(503).json({ error: "Authentication service unavailable" });
  }
  return client.authenticate(req, res, next);
};

router.post("/login", validateContentType, validateJsonBody, async (req, res) => {
  req.logAction = "login-attempt";
  logger.info("Login request received", {
    component: "AuthRoutes",
    method: "login",
    requestId: req.requestId || ulid(),
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("User-Agent")
  });

  // Use the shared RoditClient stored in app.locals
  const client = req.app.locals.roditClient;
  if (!client) {
    return res.status(503).json({ error: "Authentication service unavailable" });
  }

  // Ensure headers exist to prevent SDK errors
  if (!req.headers) {
    req.headers = {};
  }

  // Ensure user-agent header exists
  if (!req.headers["user-agent"]) {
    req.headers["user-agent"] = req.get("User-Agent") || "Unknown";
  }

  // Use the login_client method that handles Express req/res for client authentication
  await client.login_client(req, res);
});

router.post("/logout", validateContentType, authenticate, async (req, res) => {
  req.logAction = "logout-attempt";
  const requestId = req.requestId || ulid();
  const context = logger.createLogContext("AuthRoutes", "logout", {
    requestId,
    endpoint: "/logout",
    ip: req.ip
  });

  logger.infoWithContext("Logout request received", context);

  const client = req.app?.locals?.roditClient;
  if (!client) {
    logger.warnWithContext("Logout attempted but RoditClient unavailable", context);
    return res.status(503).json({
      error: "Service unavailable",
      message: "Authentication service not configured",
      requestId
    });
  }

  try {
    await client.logout_client(req, res);
  } catch (error) {
    logger.logErrorWithMetrics(
      "Error calling logout_client",
      context,
      error,
      "logout_error",
      { operation: "logout", result: "error" }
    );
    return res.status(500).json({
      error: "Logout failed",
      message: error.message,
      requestId
    });
  }
});

module.exports = router;
