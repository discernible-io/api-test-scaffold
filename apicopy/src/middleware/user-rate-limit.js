const config = require("config");
const { logger } = require("@rodit/rodit-auth-be");

const USER_RATE_LIMITER_LOCALS_KEY = "__userRateLimiterMiddleware";

function createUserRateLimitMiddleware(roditClient) {
  const getRateLimitFactory = roditClient?.getRateLimitMiddleware?.();

  if (typeof getRateLimitFactory !== "function") {
    throw new Error("Rate limit middleware factory not available from SDK");
  }

  const userLimiters = new Map();

  return async function userRateLimitMiddleware(req, res, next) {
    const userId = req.user?.id || req.user?.sub;

    if (!userId) {
      return next();
    }

    try {
      if (!userLimiters.has(userId)) {
        const configObject = await roditClient.getConfigOwnRodit();
        const metadata = configObject?.own_rodit?.metadata;

        if (!metadata?.max_requests || !metadata?.maxrq_window) {
          throw new Error("User metadata missing required rate limit configuration");
        }

        const maxRequests = parseInt(metadata.max_requests, 10);
        const windowSeconds = parseInt(metadata.maxrq_window, 10);
        const windowMinutes = Math.max(Math.floor(windowSeconds / 60), 1);

        logger.infoWithContext("Creating user-specific rate limiter", {
          component: "UserRateLimit",
          userId,
          maxRequests,
          windowMinutes,
          windowSeconds
        });

        const userLimiter = getRateLimitFactory(maxRequests, windowMinutes);
        userLimiters.set(userId, {
          limiter: userLimiter,
          maxRequests,
          windowMinutes,
          createdAt: Date.now()
        });
      }

      const userLimiterData = userLimiters.get(userId);

      logger.debugWithContext("Applying user-based rate limiting", {
        component: "UserRateLimit",
        userId,
        maxRequests: userLimiterData.maxRequests,
        windowMinutes: userLimiterData.windowMinutes,
        path: req.originalUrl
      });

      return userLimiterData.limiter(req, res, next);
    } catch (error) {
      logger.errorWithContext(
        "Error applying user-based rate limiting",
        {
          component: "UserRateLimit",
          userId,
          path: req.originalUrl,
          error: error.message
        },
        error
      );

      return res.status(500).json({ error: "Rate limiting configuration error" });
    }
  };
}

function cleanupUserLimiters(userLimiters, maxAgeMs = 60 * 60 * 1000) {
  const now = Date.now();
  let removed = 0;

  for (const [userId, limiterData] of userLimiters.entries()) {
    if (now - limiterData.createdAt > maxAgeMs) {
      userLimiters.delete(userId);
      removed += 1;
    }
  }

  if (removed > 0) {
    logger.infoWithContext("Cleaned up expired user rate limiters", {
      component: "UserRateLimit",
      removed,
      remaining: userLimiters.size
    });
  }
}

module.exports = {
  createUserRateLimitMiddleware,
  cleanupUserLimiters,
  getUserRateLimiter(req) {
    const appLocals = req.app?.locals;
    if (!appLocals?.roditClient) {
      logger.warnWithContext("Rodit client unavailable for user rate limiting; falling back to pass-through", {
        component: "UserRateLimit"
      });
      return null;
    }

    if (!appLocals[USER_RATE_LIMITER_LOCALS_KEY]) {
      try {
        appLocals[USER_RATE_LIMITER_LOCALS_KEY] = createUserRateLimitMiddleware(appLocals.roditClient);
      } catch (error) {
        logger.warnWithContext(
          "User rate limiter unavailable, falling back to pass-through",
          {
            component: "UserRateLimit",
            reason: error.message
          },
          error
        );

        appLocals[USER_RATE_LIMITER_LOCALS_KEY] = null;
      }
    }

    return appLocals[USER_RATE_LIMITER_LOCALS_KEY];
  }
};
