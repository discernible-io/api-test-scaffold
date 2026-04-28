const express = require("express");
const winston = require("winston");
const LokiTransport = require("winston-loki");
const swaggerUi = require("swagger-ui-express");
const swaggerSpec = require("../api-docs/swagger.json");
const { ulid } = require("ulid");
const { RoditClient, logger, validateConfig, healthCheckRPC } = require("@rodit/rodit-auth-be");
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
    
    // Rate limit public endpoints to prevent scraping/DoS
    const publicEndpointLimit = sdkFactory(100, 1); // 100 req/min
    app.use("/api/mcp", publicEndpointLimit);
    
    // Rate limit /api/login/timestamp with configurable limits from environment variables
    // Defaults to NO rate limiting if environment variables are not set
    let loginTimestampLimit = null; // Default to no limit
    if (config.has("RATE_LIMIT_LOGIN_TIMESTAMP_MAX") && config.has("RATE_LIMIT_LOGIN_TIMESTAMP_WINDOW_MINUTES")) {
      const maxRequests = parseInt(config.get("RATE_LIMIT_LOGIN_TIMESTAMP_MAX"), 10);
      const windowMinutes = parseInt(config.get("RATE_LIMIT_LOGIN_TIMESTAMP_WINDOW_MINUTES"), 10);
      
      if (Number.isFinite(maxRequests) && Number.isFinite(windowMinutes) && maxRequests > 0 && windowMinutes > 0) {
        loginTimestampLimit = sdkFactory(maxRequests, windowMinutes);
        logger.info("Using custom rate limit for /api/login/timestamp from environment variables", {
          component: "IDClawserverAPI",
          endpoint: "/api/login/timestamp",
          maxRequests,
          windowMinutes,
          source: "environment_variables"
        });
      } else {
        logger.warn("Invalid rate limit values for /api/login/timestamp, applying no rate limit", {
          component: "IDClawserverAPI",
          endpoint: "/api/login/timestamp",
          providedMax: config.get("RATE_LIMIT_LOGIN_TIMESTAMP_MAX"),
          providedWindow: config.get("RATE_LIMIT_LOGIN_TIMESTAMP_WINDOW_MINUTES"),
          fallback: "no limit"
        });
      }
    } else {
      logger.info("No custom rate limit configured for /api/login/timestamp, applying no rate limit", {
        component: "IDClawserverAPI",
        endpoint: "/api/login/timestamp",
        fallback: "no limit",
        note: "Set RATE_LIMIT_LOGIN_TIMESTAMP_MAX and RATE_LIMIT_LOGIN_TIMESTAMP_WINDOW_MINUTES to enable rate limiting"
      });
    }
    
    // Only apply rate limit middleware if configured
    if (loginTimestampLimit) {
      app.use("/api/login/timestamp", loginTimestampLimit);
    }
    app.use("/.well-known/terms-of-service", publicEndpointLimit);
    app.use("/.well-known/privacy-policy", publicEndpointLimit);
    app.use("/.well-known/data-retention", publicEndpointLimit);
    app.use("/.well-known/why-identyclaw", publicEndpointLimit);
    app.use("/swagger.json", publicEndpointLimit);

    rateLimitersApplied = true;

    logger.info("IP-based rate limiting applied for unauthenticated endpoints", {
      component: "IDClawserverAPI",
      login,
      signclient,
      publicEndpoints: { max: 100, windowMinutes: 1 }
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

// Content-Type validation for POST/PUT/PATCH requests (must run before body parser)
// This ensures invalid content types return 415 instead of 400 from JSON parser
const { errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;

app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) {
      const requestId = req.requestId || ulid();
      return sendError(res, {
        statusCode: 415,
        requestId,
        code: "UNSUPPORTED_MEDIA_TYPE",
        message: "Content-Type must be application/json"
      });
    }
  }
  next();
});

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
    
    // Log at INFO level instead of DEBUG for production visibility
    if (typeof logger.infoWithContext === "function") {
      logger.infoWithContext("Request completed", {
        component: "IDClawserverAPI",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        duration,
        requestId: req.requestId,
        userAgent: req.get("User-Agent")
      });
    } else {
      logger.info("Request completed", {
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
const agentPublicRoutes = require("./routes/agent.public.routes");
const identityProtectedRoutes = require("./routes/identity.protected.routes");
const nonceProtectedRoutes = require("./routes/nonce.protected.routes");
const mcpRoutes = require("./routes/mcp.public.routes");
const signclientRoutes = require("./routes/signclient.public.routes");
const metricsRoutes = require("./routes/metrics.privileged.routes");
const sessionRoutes = require("./routes/session.privileged.routes");
const didRoutes = require("./routes/did.protected.routes");
const policiesRoutes = require("./routes/policies.public.routes");
const testholaRoutes = require("./routes/testhola.protected.routes");
const discoveryRoutes = require("./routes/discovery.public.routes");

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

  // Discovery routes (API root and enrollment)
  app.use("/", discoveryRoutes);

  // Public routes
  app.use("/api", authPublicRoutes);
  app.use("/api", agentPublicRoutes);
  app.use("/api", signclientRoutes);

  // Protected routes (each router applies its own authentication middleware)
  app.use("/api", nonceProtectedRoutes);
  app.use("/api", identityProtectedRoutes);
  app.use("/api", testholaRoutes);

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

  // 404 handler with enrollment guidance
  app.use((req, res) => {
    const requestId = req.requestId || ulid();
    
    logger.info("404 - Endpoint not found", {
      component: "IDClawserverAPI",
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      requestId
    });

    const isApiPath = req.originalUrl.startsWith('/api');
    const isWellKnownPath = req.originalUrl.startsWith('/.well-known');
    
    let message = "Endpoint not found";
    let suggestions = [];
    
    if (isApiPath) {
      message = "API endpoint not found";
      suggestions = [
        "Try GET / for API discovery",
        "Visit https://purchase.identyclaw.com for enrollment",
        "Check /swagger.json for available endpoints"
      ];
    } else if (isWellKnownPath) {
      message = "Well-known endpoint not found";
      suggestions = [
        "Try GET /.well-known/enrollment for enrollment info",
        "Try GET /.well-known/why-identyclaw for value proposition",
        "Try GET /.well-known/terms-of-service for terms",
        "Try GET /.well-known/privacy-policy for privacy policy"
      ];
    } else {
      suggestions = [
        "Try GET / for API discovery and enrollment",
        "Visit https://purchase.identyclaw.com to get started",
        "Check /docs for interactive API documentation"
      ];
    }

    res.status(404).json({
      error: {
        code: "ENDPOINT_NOT_FOUND",
        message,
        suggestions,
        enrollment: "https://purchase.identyclaw.com",
        documentation: {
          swagger: "/swagger.json",
          openapi: "/openapi.json",
          html: "/docs",
          enrollment: "/.well-known/enrollment"
        }
      },
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
            
            // Record endpoint-specific metrics for percentile calculations
            if (typeof performanceService.recordEndpointMetric === "function") {
              performanceService.recordEndpointMetric(req.method, req.originalUrl, duration, res.statusCode);
            }
            
            if (res.statusCode >= 400 && typeof performanceService.recordMetric === "function") {
              performanceService.recordMetric("error_count", 1);
            }
            if (typeof performanceService.recordMetric === "function") {
              performanceService.recordMetric("request_duration", duration);
            }
          });

          next();
        });

        logger.info("Performance tracking middleware applied with per-endpoint metrics and percentiles", {
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

    // Run startup checks
    logger.info("🚀 Running startup checks...", {
      component: "IDClawserverAPI"
    });

    try {
      validateConfig(logger);
    } catch (err) {
      logger.error("❌ Configuration validation failed", {
        component: "IDClawserverAPI",
        error: err.message
      });
      throw err;
    }

    try {
      const rpcUrl = config.get('NEAR_RPC_URL');
      await healthCheckRPC(rpcUrl);
    } catch (err) {
      logger.error("❌ RPC health check failed", {
        component: "IDClawserverAPI",
        error: err.message
      });
      throw err;
    }

    logger.info("✅ All startup checks passed", {
      component: "IDClawserverAPI"
    });

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
