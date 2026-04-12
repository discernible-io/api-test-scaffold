const express = require("express");
const winston = require("winston");
const LokiTransport = require("winston-loki");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("../api-docs/swagger.json");
const { ulid } = require("ulid");
const { RoditClient, logger } = require("@rodit/rodit-auth-be");
const config = require("config");
const { setupMcpHttpTransport } = require("./integrations/mcp-http");

// Rate limiting settings will be derived from roditClient metadata
// Fallback defaults if metadata is not available
const DEFAULT_RATE_LIMITS = {
  enabled: true,
  login: { max: 20, windowMinutes: 1 },
  signclient: { max: 6, windowMinutes: 1 }
};

// Configure winston-loki logging BEFORE creating RoditClient
(() => {
  try {
    const lokiUrl = config.has("LOKI_URL") ? config.get("LOKI_URL") : null;
    const logLevel = config.has("LOG_LEVEL") ? config.get("LOG_LEVEL") : "info";
    const skipTls = config.has("LOKI_TLS_SKIP_VERIFY")
      ? String(config.get("LOKI_TLS_SKIP_VERIFY")).toLowerCase() === "true"
      : false;
    const basicAuth = config.has("LOKI_BASIC_AUTH") ? config.get("LOKI_BASIC_AUTH") : null;

    const transports = [
      new winston.transports.Console({ format: winston.format.json(), level: logLevel })
    ];

    if (lokiUrl) {
      const serviceLabel = config.has("SERVICE_NAME") ? config.get("SERVICE_NAME") : "idclawserver-api";
      const lokiOptions = {
        host: lokiUrl,
        labels: { app: serviceLabel, service_name: serviceLabel, component: "rodit-sdk" },
        json: true,
        level: logLevel,
        batching: false,
        gracefulShutdown: true,
        replaceTimestamp: true,
        timeout: 5000
      };

      if (basicAuth) {
        lokiOptions.basicAuth = basicAuth;
      }
      if (skipTls) {
        lokiOptions.ssl = { rejectUnauthorized: false };
      }

      const lokiTransport = new LokiTransport(lokiOptions);

      lokiTransport.on("error", (err) => {
        console.error("winston-loki transport ERROR:", err.message);
      });

      lokiTransport.on("warn", (warn) => {
        console.warn("winston-loki transport WARN:", warn);
      });

      transports.push(lokiTransport);
    }

    const customLogger = winston.createLogger({
      level: logLevel,
      format: winston.format.json(),
      transports
    });

    logger.setLogger(customLogger);
  } catch (e) {
    console.warn("SDK Loki logger injection failed:", e?.message || e);
  }
})();

const SERVERPORT = config.get("SERVERPORT");
const LOG_LEVEL = config.get("LOG_LEVEL");
const SERVICE_NAME = config.get("SERVICE_NAME");

const app = express();
app.disable("x-powered-by");

let rateLimitersApplied = false;

async function applyRateLimitersIfAvailable() {
  if (rateLimitersApplied) {
    return;
  }

  const roditClient = app.locals?.roditClient;
  if (!roditClient) {
    logger.warn("Rodit client not initialized; rate limiter setup deferred", {
      component: "IDClawserverAPI"
    });
    return;
  }

  const sdkFactory = roditClient.getRateLimitMiddleware?.();
  if (typeof sdkFactory !== "function") {
    logger.warn("Rate limit middleware factory not available from SDK - skipping rate limiter setup", {
      component: "IDClawserverAPI"
    });
    return;
  }

  // Try to get rate limits from roditClient metadata, fall back to defaults
  let rateLimitSettings = DEFAULT_RATE_LIMITS;
  
  try {
    const metadata = roditClient.roditMetadata;
    if (metadata?.max_requests && metadata?.maxrq_window) {
      // Use metadata values for both endpoints
      const maxRequests = parseInt(metadata.max_requests, 10);
      const windowSeconds = parseInt(metadata.maxrq_window, 10);
      const windowMinutes = Math.ceil(windowSeconds / 60);
      
      rateLimitSettings = {
        enabled: true,
        login: { max: maxRequests, windowMinutes },
        signclient: { max: Math.floor(maxRequests / 3), windowMinutes } // More restrictive for signclient
      };
      
      logger.info("Using rate limits from RODiT metadata", {
        component: "IDClawserverAPI",
        maxRequests,
        windowSeconds,
        source: "roditClient.roditMetadata"
      });
    } else {
      logger.info("RODiT metadata does not contain rate limit info, using defaults", {
        component: "IDClawserverAPI",
        defaults: DEFAULT_RATE_LIMITS
      });
    }
  } catch (error) {
    logger.warn("Failed to read rate limits from RODiT metadata, using defaults", {
      component: "IDClawserverAPI",
      error: error.message
    });
  }

  if (!rateLimitSettings.enabled) {
    logger.warn("Rate limiting is DISABLED", {
      component: "IDClawserverAPI"
    });
    rateLimitersApplied = true;
    return;
  }

  const { login, signclient } = rateLimitSettings;

  try {
    app.use("/api/login", sdkFactory(login.max, login.windowMinutes));
    app.use("/api/signclient", sdkFactory(signclient.max, signclient.windowMinutes));

    rateLimitersApplied = true;

    logger.info("IP-based rate limiting applied for unauthenticated endpoints", {
      component: "IDClawserverAPI",
      login,
      signclient
    });
  } catch (error) {
    logger.warn("Failed to apply rate limiting middleware from SDK, falling back to no IP-based rate limiting", {
      component: "IDClawserverAPI",
      reason: error.message,
      code: error.code
    });

    rateLimitersApplied = true;
  }
}

// Parse JSON and URL-encoded bodies with explicit limits
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

// Request context middleware
app.use((req, res, next) => {
  req.requestId = req.headers["x-request-id"] || req.headers["x-correlation-id"] || ulid();
  req.startTime = Date.now();
  next();
});

// Performance logging middleware
app.use((req, res, next) => {
  res.on("finish", () => {
    const duration = Date.now() - req.startTime;
    if (typeof logger.debugWithContext === "function") {
      logger.debugWithContext("Request completed", {
        component: "IDClawserverAPI",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
        userAgent: req.get("User-Agent")
      });
    } else {
      logger.debug("Request completed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId
      });
    }
  });
  next();
});

// Swagger documentation setup
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get("/swagger.json", (req, res) => {
  res.json(swaggerSpec);
});

// Import routes
const authPublicRoutes = require("./routes/auth.public.routes");
const identityProtectedRoutes = require("./routes/identity.protected.routes");
const nonceProtectedRoutes = require("./routes/nonce.protected.routes");
const mcpRoutes = require("./routes/mcp.public.routes");
const signclientRoutes = require("./routes/signclient.public.routes");
const metricsRoutes = require("./routes/metrics.privileged.routes");
const sessionRoutes = require("./routes/session.privileged.routes");
const didRoutes = require("./routes/did.protected.routes");
const policiesRoutes = require("./routes/policies.public.routes");

function setupRoutes() {
  // Health check endpoint
  app.get("/health", (req, res) => {
    const response = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: SERVICE_NAME
    };
    res.status(200).json(response);
  });

  // Public routes
  app.use("/api", authPublicRoutes);
  app.use("/api", signclientRoutes);

  // Protected routes (each router applies its own authentication middleware)
  app.use("/api", nonceProtectedRoutes);
  app.use("/api", identityProtectedRoutes);

  // Metrics and session management routes (protected by their own middleware)
  app.use("/api/metrics", metricsRoutes);
  app.use("/api/sessions", sessionRoutes);

  // MCP routes
  app.use("/api/mcp", mcpRoutes);

  // DID resolution routes (exposed under RFC 8615 well-known namespace)
  app.use("/.well-known/did", didRoutes);

  // Policy discovery routes (RFC 8615 well-known URIs)
  app.use("/.well-known", policiesRoutes);

  // Basic error handler
  app.use((err, req, res, next) => {
    const requestId = req.requestId || ulid();

    logger.error("Server error occurred", {
      component: "IDClawserverAPI",
      cause: err.name || "UnhandledError",
      error: err.message,
      method: req.method,
      url: req.originalUrl,
      statusCode: err.statusCode || 500,
      requestId
    });

    logger.debug("Server error stack", {
      component: "IDClawserverAPI",
      requestId,
      stack: err.stack
    });

    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
      requestId,
      timestamp: new Date().toISOString()
    });
  });
}

async function startServer() {
  try {
    try {
      const authClient = await RoditClient.create("server");
      app.locals.roditClient = authClient;

      const loggingMiddleware = authClient.getLoggingMiddleware();
      if (loggingMiddleware) {
        app.use(loggingMiddleware);
      }

      const performanceService = authClient.getPerformanceService();
      if (performanceService && typeof performanceService.recordRequest === "function") {
        app.locals.performanceService = performanceService;

        app.use((req, res, next) => {
          const startTime = Date.now();

          performanceService.recordRequest(req);

          res.on("finish", () => {
            const duration = Date.now() - startTime;
            if (res.statusCode >= 400 && typeof performanceService.recordMetric === "function") {
              performanceService.recordMetric("error_count", 1);
            }
            if (typeof performanceService.recordMetric === "function") {
              performanceService.recordMetric("request_duration", duration);
            }
          });

          next();
        });

        logger.info("Performance tracking middleware applied using recordRequest", {
          component: "IDClawserverAPI",
          performanceServiceId: performanceService.constructor.name
        });
      } else {
        logger.warn("Performance tracking not available from SDK", {
          component: "IDClawserverAPI",
          hasPerformanceService: !!performanceService,
          performanceServiceType: performanceService?.constructor?.name,
          availableMethods: performanceService
            ? Object.getOwnPropertyNames(Object.getPrototypeOf(performanceService))
            : []
        });
      }

      logger.info("Authentication client initialized", {
        component: "IDClawserverAPI",
        service: SERVICE_NAME
      });
    } catch (authErr) {
      logger.warn("Failed to initialize authentication client", {
        component: "IDClawserverAPI",
        error: authErr.message
      });
    }

    await applyRateLimitersIfAvailable();

    setupRoutes();
    await setupMcpHttpTransport(app);

    const server = app.listen(SERVERPORT, () => {
      logger.info("IDClawserver API server started", {
        component: "IDClawserverAPI",
        port: SERVERPORT,
        logLevel: LOG_LEVEL,
        service: SERVICE_NAME
      });
    });

    const shutdown = (signal) => {
      logger.info("Shutdown signal received", {
        component: "IDClawserverAPI",
        signal
      });
      server.close(() => {
        logger.info("HTTP server closed", { component: "IDClawserverAPI" });
        process.exit(0);
      });
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    logger.error("Fatal error starting IDClawserver API", {
      component: "IDClawserverAPI",
      error: err.message
    });
    process.exit(1);
  }
}

startServer();
