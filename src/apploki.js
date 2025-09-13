// Copyright (c) 2024 Discernible, Inc. All rights reserved.

const config = require("config");
const express = require("express");
const crypto = require("crypto");
const { logger, loggingmw } = require("@rodit/rodit-auth-be");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const { ulid } = require("ulid");

// Import the SDK package public API (npm package)
const rodit = require("@rodit/rodit-auth-be");

// State manager from SDK
const { stateManager } = rodit;

// Configuration constants
const SERVERPORT = config.get("SERVERPORT");
const isProduction = process.env.NODE_ENV === "production";
const SERVICE_NAME = config.get("SERVICE_NAME");

// Initialize rate limiter
// let ratelimiter = ratelimitmw(100, 15);

// Express app setup
const app = express();

// Configure Express to trust proxies for correct client IP detection
// Using a specific configuration instead of 'true' to prevent IP spoofing
app.set("trust proxy", 1);

// Parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Apply logging middleware
app.use(loggingmw);

// Performance monitoring middleware
app.use((req, res, next) => {
  req.startTime = Date.now();
  req.requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || ulid();
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  
  // Add response tracking
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    req.duration = duration;
    
    // Use structured logging with context
    logger.debugWithContext("Request performance metrics", {
      component: "API",
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      requestId: req.requestId,
      traceId: req.traceId,
      userAgent: req.get('User-Agent'),
      referer: req.get('Referer'),
      contentLength: res.get('Content-Length'),
      contentType: res.get('Content-Type')
    });
    
    // Log metrics for monitoring systems
    logger.metric('request_duration_ms', duration, {
      method: req.method,
      path: req.path,
      status: res.statusCode
    });
  });
  next();
});

// Action logging middleware - tracks user actions
app.use((req, res, next) => {
  if (req.logAction) {
    logger.infoWithContext("Action executed", {
      component: "API",
      action: req.logAction,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userId: req.user ? req.user.id : "anonymous",
      roditId: req.user ? req.user.roditId : null,
      requestId: req.requestId,
      traceId: req.traceId,
      timestamp: new Date().toISOString(),
      service: req.logService || SERVICE_NAME,
      resource: req.resource || req.path
    });
  }
  next();
});

// Swagger documentation setup
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RODIT Signing API",
      version: "1.0.0",
      description: `API service for signing server and client RODIT IDs using a secure vault-stored Key Pair (${
        isProduction ? "Production" : "Development"
      } Environment)`,
      contact: {
        name: "API Support",
        url: "https://signportal.rodit.org/support",
        email: "support@rodit.org",
      },
    },
    components: {
      securitySchemes: {
        auth: {
          type: "apiKey",
          in: "header",
          name: "X-RODIT-Token",
          description: "RODiT mutual authentication token",
        },
      },
    },
    security: [{ auth: [] }],
    tags: [
      {
        name: "Server RODIT",
        description: "Operations related to server RODIT signing",
      },
      {
        name: "Client RODIT",
        description: "Operations related to client RODIT signing",
      },
    ],
    paths: {
      "/api/root/signroot": {
        post: {
          tags: ["Portal/Sanctum RODIT"],
          summary: "Sign Portal/Sanctum RODIT",
          description:
            "Sign a Portal/Sanctum RODIT ID using the secure vault-stored Key Pair",
        },
      },
      "/api/portal/signportal": {
        post: {
          tags: ["Client RODIT"],
          summary: "Sign client RODIT",
          description:
            "Sign a client RODIT ID using the secure vault-stored Key Pair",
        },
      },
    },
  },
  apis: ["./app.js", "./protected/*.js"],
};

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerJsdoc(swaggerOptions))
);

// Routes
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.post(
  "/login",
  (req, res, next) => {
    req.logAction = "login-attempt";
    req.logService = "authentication";
    req.requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || ulid();
    req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
    
    logger.infoWithContext("Login request received", {
      component: "API",
      method: "login",
      requestId: req.requestId,
      traceId: req.traceId,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString(),
      service: "authentication"
    });
    next();
  },
  (req, res) => {
    // Use the SDK's login function directly
    rodit.login(req, res);
  }
);

/**
 * Logout endpoint
 */
app.post('/logout', rodit.authenticate, (req, res) => {
  req.logAction = "logout-attempt";
  req.logService = "authentication";
  
  logger.infoWithContext("Logout request received", {
    component: "API",
    method: "logout",
    requestId: req.requestId,
    traceId: req.traceId,
    path: req.path,
    ip: req.ip,
    userId: req.user ? req.user.id : "anonymous",
    roditId: req.user ? req.user.roditId : null,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
    service: "authentication"
  });
  
  rodit.logout(req, res);
});

// Protected routes
const signportalprotectedRoute = require("./protected/signportal");
const signrootprotectedRoute = require("./protected/signroot");

// Use the SDK's authenticate middleware for protected routes
// Add permission validation if needed for specific routes
app.use("/api/portal", rodit.authenticate, signportalprotectedRoute);
app.use("/api/root", signrootprotectedRoute);

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  const requestId = req.requestId || ulid();
  const traceId = req.traceId || crypto.randomUUID();
  
  logger.errorWithContext(
    "Server error occurred",
    {
      component: "API",
      message: err.message,
      method: req.method,
      url: req.originalUrl,
      userIP: req.ip,
      userId: req.user ? req.user.id : "anonymous",
      roditId: req.user ? req.user.roditId : null,
      errorCode: err.code || "936",
      route: req.route ? req.route.path : "unknown",
      requestId: requestId,
      traceId: traceId,
      timestamp: new Date().toISOString(),
      service: req.logService || SERVICE_NAME,
      action: req.logAction || "unspecified",
      statusCode: err.statusCode || 500,
      stack: isProduction ? undefined : err.stack
    },
    err // Pass the error object directly
  );
  
  res.status(500).json({ 
    error: "Error 936: Internal Server Error",
    requestId: req.requestId || ulid(),
    timestamp: new Date().toISOString()
  });
});

// Store server instance for graceful shutdown
let server;

// Server startup
async function startServer() {
  try {
    logger.info("Initializing server", {
      component: "AppLifecycle",
      status: "initializing",
      environment: process.env.NODE_ENV || 'development'
    });

    // Initialize credentials store and load RODiT configuration via SDK helper
    await rodit.initConfig('portal');

    logger.info("RODiT configuration initialized", {
      component: "vault",
      status: "initialized"
    });

    // Get and apply configuration
    const configObject = await stateManager.getConfigOwnRodit();
    if (!configObject) {
      throw new Error("Failed to initialize RODiT configuration");
    }

    // Rate limiting has been removed
    const own_rodit = configObject.own_rodit;

    // Start the HTTP server
    server = app.listen(SERVERPORT, () => {
      logger.info("Server started", {
        port: SERVERPORT,
        env: process.env.NODE_ENV || "development"
      });
      
      console.log(`\nRODiT Signing Portal running on port ${SERVERPORT}`);
      console.log('');
      console.log('Available endpoints:');
      console.log('  POST /login - Login with RODiT credentials');
      console.log('  POST /api/portal - Portal signing operations');
      console.log('  POST /api/root - Root signing operations');
      console.log('  GET  /api-docs - Swagger API documentation');
      console.log('');
    });

    // Graceful shutdown handling
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
  } catch (error) {
    logger.error("Server initialization failed", {
      component: "AppLifecycle",
      errorCode: "907",
      error: error.message
    }, error);
    process.exit(1);
  }
}

// Graceful shutdown function
async function gracefulShutdown(signal) {
  logger.info("Shutting down gracefully", {
    component: "AppLifecycle",
    signal: signal || "unknown",
    time: new Date().toISOString()
  });
  
  if (server) {
    server.close(() => {
      logger.info("HTTP server closed", { component: "http-server" });
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
}

startServer();
