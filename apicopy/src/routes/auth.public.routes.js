const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");

// Import logger utilities and error helper from SDK
const { logger, errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;
const { validateContentType, validateJsonBody } = require("../middleware/request-validation");

// Authentication middleware - uses app.locals.roditClient
const authenticate = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    const requestId = req.requestId || ulid();
    return sendError(res, {
      statusCode: 503,
      requestId,
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service unavailable"
    });
  }
  return client.authenticate(req, res, next);
};

router.post("/login", validateContentType, validateJsonBody, async (req, res) => {
  req.logAction = "login-attempt";
  logger.info("Login request received", {
    component: "AuthRoutes",
    method: "login_client",
    requestId: req.requestId || ulid(),
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.get("User-Agent")
  });

  // Use the shared RoditClient stored in app.locals
  const client = req.app.locals.roditClient;
  if (!client) {
    return sendError(res, {
      statusCode: 503,
      requestId: req.requestId || ulid(),
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service unavailable"
    });
  }

  // Ensure headers exist to prevent SDK errors
  if (!req.headers) {
    req.headers = {};
  }

  // Ensure user-agent header exists
  if (!req.headers["user-agent"]) {
    req.headers["user-agent"] = req.get("User-Agent") || "Unknown";
  }

  // Use login_client for Express req/res client authentication
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
    return sendError(res, {
      statusCode: 503,
      requestId,
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service not configured"
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
    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "LOGOUT_FAILED",
      message: error.message
    });
  }
});

module.exports = router;
