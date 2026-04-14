const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const { ulid } = require("ulid");
const { logger, blockchainService } = require("@rodit/rodit-auth-be");
const { encodeNonceToMorse } = require("../services/nonce-encoding.service");
const { getUserRateLimiter } = require("../middleware/user-rate-limit");

const authenticate = (req, res, next) => {
  const client = req.app?.locals?.roditClient;
  if (!client) {
    return res.status(503).json({ error: "Authentication service unavailable" });
  }

  return client.authenticate(req, res, (authErr) => {
    if (authErr) {
      return next(authErr);
    }

    const userRateLimiter = getUserRateLimiter(req);
    if (!userRateLimiter) {
      return next();
    }

    return userRateLimiter(req, res, next);
  });
};

router.get("/noncets", authenticate, (req, res) => {
  const requestId = req.requestId || ulid();
  const startTime = Date.now();

  const context = logger.createLogContext("NonceRoutes", "generateNoncets", {
    requestId,
    endpoint: "/noncets",
    ip: req.ip
  });

  try {
    const nonceBytes = crypto.randomBytes(16);
    const encoded = encodeNonceToMorse(nonceBytes);
    const timestamp = new Date().toISOString();
    const noncets = `:${timestamp}:${encoded}:`;

    const duration = Date.now() - startTime;
    logger.infoWithContext("Noncets generated", {
      ...context,
      duration
    });

    logger.metric("noncets_generate", duration, {
      operation: "generateNoncets",
      result: "success"
    });

    return res.status(200).json({
      noncets,
      timestamp,
      length: nonceBytes.length,
      algorithm: "randomBytes(16)_hex",
      requestId
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.logErrorWithMetrics(
      "Error generating noncets",
      { ...context, duration },
      error,
      "noncets_generate_error",
      { operation: "generateNoncets", result: "error", duration }
    );

    return res.status(500).json({
      error: "Failed to generate noncets",
      message: error.message,
      requestId
    });
  }
});

module.exports = router;
