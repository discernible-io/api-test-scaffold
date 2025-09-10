/**
 * RODiT Authentication API Server
 * 
 * This application demonstrates the implementation of RODiT-based authentication
 * using the RODiT Authentication SDK.
 * 
 * Copyright (c) 2025 Discernible Inc. All rights reserved.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { ulid } = require('ulid');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const config = require('config');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const LokiTransport = require('winston-loki');

// Import the unified auth module and services from npm package
const auth = require('@rodit/rodit-auth-be');
const { logger, loggingmw, ratelimitmw, stateManager, roditManager } = auth;
const { createLogContext, logErrorWithMetrics } = logger;

// Configure file-based logging using DailyRotateFile
const logDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(logDir, { recursive: true });

// Create file transports for different log levels
const fileTransports = [
  new DailyRotateFile({
    filename: path.join(logDir, 'apiinfo-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'info',
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  new DailyRotateFile({
    filename: path.join(logDir, 'apierror-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '14d',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  })
];

// Add Loki transport if configured
const transports = [...fileTransports];
if (process.env.LOKI_URL) {
  transports.push(new LokiTransport({
    host: process.env.LOKI_URL,
    labels: { 
      job: 'servertest-api',
      app: 'servertest-api',
      hostname: 'api.discernible.io'
    },
    json: true,
    format: winston.format.json(),
    replaceTimestamp: true,
    onConnectionError: (err) => console.error('Loki connection error:', err)
  }));
}

// Create custom logger with file and Loki transports
const customLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
  exitOnError: false
});

// Add console transport for development
if (process.env.NODE_ENV !== 'production') {
  customLogger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }));
}

// Inject custom logger into SDK
logger.setLogger(customLogger);

// Import routes
const echoprotectedRoute = require('./protected/echo');
const crudaprotectedRoute = require('./protected/cruda');
const signclientRoute = require('./routes/signclient');
const metricsRoutes = require('./routes/metricsroutes');
const mcpRoutes = require('./routes/mcproutes');
const homeRoute = require('./routes/home');
const sessionRoutes = require('./routes/sessionroutes');
const loginRoute = require('./routes/login');
const logoutRoute = require('./routes/logout');

// Use SDK-provided rate limiting helper

// Default rate limits - will be updated from RODiT metadata
let ratelimiter = ratelimitmw(100, 15);

// Swagger API documentation setup
const swaggerOptions = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RODiT Authentication API",
      version: "1.0.0",
      description: `# API using Discernible Authentication system

## Service Description
The RODiT Authentication API provides secure authentication services using the Discernible Authentication system. This API enables applications to implement robust user authentication, session management, and access control using RODiT's cryptographic identity verification.

## Key Features
- Secure user authentication via RODiT credentials
- Session management and token-based authorization
- User identity verification
- Access control for protected resources
- Metrics and monitoring capabilities

## Data Handling and Privacy
All user data is handled in accordance with our privacy policy. We implement industry-standard encryption for data in transit and at rest. Personal information is processed only for the purposes of authentication and is not shared with third parties without explicit consent.

We comply with applicable data protection regulations including GDPR and CCPA. In the event of a data breach, we will notify affected users within 72 hours of discovery.
      `,
      termsOfService: "https://api.discernible.io/terms",
      contact: {
        name: "Discernible Inc.",
        url: "https://api.discernible.io/home.js",
        email: "support@rodit-tech.com"
      },
      license: {
        name: "Proprietary",
        url: "https://api.discernible.io/license"
      },
      "x-api-id": "rodit-auth-api-v1"
    },
    servers: [], // Will be populated dynamically from RODIT token
    externalDocs: {
      description: "Additional API Documentation",
      url: "https://docs.rodit-tech.com"
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained after successful authentication"
        }
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            code: {
              type: "string",
              description: "Error code"
            },
            message: {
              type: "string",
              description: "Error message"
            }
          }
        }
      }
    },
    "x-terms-and-conditions": {
      "usage-rights": "This API is provided for use by authorized clients only. Usage rights are granted upon acceptance of the terms and conditions.",
      "intellectual-property": "All intellectual property rights in the API, including but not limited to copyright, patents, and trademarks, are owned by Discernible Inc.",
      "liability": "Discernible Inc. shall not be liable for any direct, indirect, incidental, special, or consequential damages resulting from the use or inability to use the API.",
      "termination": "Discernible Inc. reserves the right to terminate API access for any user who violates these terms and conditions."
    },
    "x-subscription-plans": {
      "free": {
        "description": "Limited access for development and testing",
        "rate-limits": "100 requests per day",
        "features": ["Basic authentication", "Limited API access"]
      },
      "basic": {
        "description": "Standard access for small applications",
        "rate-limits": "1000 requests per day",
        "features": ["Full authentication features", "Standard support"],
        "price": "$49/month"
      },
      "premium": {
        "description": "Enhanced access for enterprise applications",
        "rate-limits": "10000 requests per day",
        "features": ["Full authentication features", "Priority support", "Advanced analytics"],
        "price": "$199/month"
      }
    },
    "x-rate-limits": {
      "default": {
        "rate": "100 requests per 15 minutes",
        "burst": "150 requests"
      },
      "premium": {
        "rate": "1000 requests per 15 minutes",
        "burst": "1500 requests"
      }
    },
    "x-sla": {
      "uptime": "99.9% guaranteed uptime for premium subscribers",
      "response-time": "Average response time under 200ms",
      "support": {
        "standard": "24-hour response time",
        "premium": "4-hour response time"
      }
    },
    "x-versioning": {
      "current": "v1.0.0",
      "supported": ["v1.0.0"],
      "deprecation-policy": "APIs are supported for at least 12 months after deprecation notice"
    },
    "x-monitoring": {
      "metrics": "Available via /api/metrics endpoint for authenticated users",
      "status": "Service status available at https://status.rodit-tech.com"
    },
    "x-compliance": {
      "gdpr": "Compliant with EU General Data Protection Regulation",
      "ccpa": "Compliant with California Consumer Privacy Act",
      "security": "Regular security audits and penetration testing"
    }
  },
  apis: ["./src/app.js", "./src/routes/*.js"],
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Write the generated Swagger spec to /api-docs/swagger.json for external consumption
try {
  const docsDir = path.join(__dirname, '..', 'api-docs');
  const outPath = path.join(docsDir, 'swagger.json');
  fs.mkdirSync(docsDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(swaggerSpec, null, 2));
  console.log(`Swagger spec written to ${outPath}`);
} catch (e) {
  console.warn('Failed to write swagger.json to /api-docs. Continuing without static file.', e?.message || e);
}

// Create Express app
const app = express();

// Configure Express to trust proxies for correct client IP detection
// Using a specific configuration instead of 'true' to prevent IP spoofing
app.set('trust proxy', 1);

// Configure middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Apply logging middleware from SDK
app.use(loggingmw);

// API versioning middleware
app.use(auth.versioning.middleware({
  strict: false // Set to true to reject requests with unsupported versions
}));

// Setup Swagger UI
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Serve the raw OpenAPI JSON as well
app.get('/api-docs/swagger.json', (req, res) => {
  res.json(swaggerSpec);
});

// Add request ID to all error responses
app.use((req, res, next) => {
  const originalJson = res.json;
  res.json = function(body) {
    // If this is an error response, add the request ID
    if (body && (body.error || body.success === false) && req.requestId) {
      body.requestId = req.requestId;
    }
    return originalJson.call(this, body);
  };
  next();
});

// Performance monitoring middleware
app.use((req, res, next) => {
  const crypto = require('crypto');
  req.startTime = Date.now();
  req.requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || ulid();
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  
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

// Apply rate limiting to all routes
// app.use((req, res, next) => ratelimiter(req, res, next));

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
      service: req.logService || config.get("SERVICE_NAME"),
      resource: req.resource || req.path
    });
  }
  next();
});

/**
 * @swagger
 * /:
 *   get:
 *     summary: Welcome page
 *     description: Returns information about available endpoints
 *     responses:
 *       200:
 *         description: Welcome message and endpoint information
 */
app.use("/", homeRoute);

// Authentication routes
app.use("/api", loginRoute);
app.use("/api", logoutRoute);

/**
 * @swagger
 * /api/logout:
 *   post:
 *     summary: User logout
 *     description: Invalidate the current session
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logout successful
 *       401:
 *         description: Not authenticated
 */
app.post('/api/logout', auth.authenticate, (req, res) => {
  req.logAction = "logout-attempt";
  auth.logout(req, res);
});


// Mount session routes for backward compatibility
app.use("/api/sessions", sessionRoutes);

// Protected routes
app.use("/api/echo", auth.authenticate, echoprotectedRoute);
app.use("/api/cruda", auth.authenticate, auth.validatePermissions, crudaprotectedRoute);

// Public routes
app.use("/api/metrics", metricsRoutes);
app.use("/api/mcp", mcpRoutes);
app.use("/api", signclientRoute);

/**
 * @swagger
 * /api/rodit/info:
 *   get:
 *     summary: Get current RODiT configuration and metadata
 *     description: Returns the current RODiT configuration loaded at runtime, including token metadata and service provider info.
 *     tags: [RODiT]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current RODiT configuration
 *       401:
 *         description: Not authenticated
 */
app.get('/api/rodit/info', auth.authenticate, async (req, res) => {
  try {
    const configObject = await stateManager.getConfigOwnRodit();
    return res.json({
      requestId: req.requestId,
      config: configObject || null
    });
  } catch (error) {
    logger.error('Failed to retrieve RODiT configuration', {
      method: 'GET /api/rodit/info',
      error: error.message,
      requestId: req.requestId
    });
    return res.status(500).json({
      error: 'Failed to retrieve RODiT configuration',
      requestId: req.requestId
    });
  }
});

/**
 * @swagger
 * /api/token/claims:
 *   get:
 *     summary: Inspect current JWT claims
 *     description: Returns the authenticated user's claims as parsed by the SDK middleware.
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user claims
 *       401:
 *         description: Not authenticated
 */
app.get('/api/token/claims', auth.authenticate, (req, res) => {
  return res.json({
    requestId: req.requestId,
    user: req.user || null
  });
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  const crypto = require('crypto');
  const requestId = req.requestId || ulid();
  const traceId = req.traceId || crypto.randomUUID();
  const isProduction = process.env.NODE_ENV === "production";
  
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
      errorCode: err.code || "106",
      route: req.route ? req.route.path : "unknown",
      requestId: requestId,
      traceId: traceId,
      timestamp: new Date().toISOString(),
      service: req.logService || config.get("SERVICE_NAME"),
      action: req.logAction || "unspecified",
      statusCode: err.statusCode || 500,
      stack: isProduction ? undefined : err.stack
    },
    err // Pass the error object directly
  );
  
  res.status(500).json({ 
    error: "Error 106: Internal Server Error",
    requestId: requestId,
    timestamp: new Date().toISOString()
  });
});

// Update rate limit once obtained config
function updateRateLimit(maxRequests, maxRqWindow) {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: "RateLimiter",
    method: "updateRateLimit",
    maxRequests,
    windowDuration: maxRqWindow
  });
  
  try {
    // Use SDK-exported ratelimitmw to rebuild middleware with new limits
    ratelimiter = ratelimitmw(maxRequests, maxRqWindow);
    
    const duration = Date.now() - startTime;
    logger.infoWithContext("Rate limit settings updated", {
      ...baseContext,
      duration,
      result: "success"
    });
    
    // Add metric for rate limit update
    logger.metric("rate_limit_operations", duration, {
      operation: "updateRateLimit",
      result: "success"
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Failed to update rate limit settings",
      {
        ...baseContext,
        duration
      },
      error,
      "rate_limit_error",
      {
        operation: "updateRateLimit",
        result: "error",
        duration
      }
    );
    
    throw error;
  }
}

// Store server instance for graceful shutdown
let server;
let db;

// Function to update Swagger servers configuration from RODIT token
function updateSwaggerServers(subjectuniqueidentifier_url) {
  const requestId = ulid();
  const baseContext = createLogContext({
    requestId,
    component: "SwaggerConfig",
    method: "updateSwaggerServers",
    apiUrl: subjectuniqueidentifier_url
  });

  try {
    if (subjectuniqueidentifier_url && subjectuniqueidentifier_url !== 'N/A') {
      // Update the swagger specification with the dynamic URL
      swaggerSpec.servers = [
        {
          url: subjectuniqueidentifier_url,
          description: "RODiT API Server (from token)"
        }
      ];
      
      logger.infoWithContext("Swagger servers updated with RODIT token URL", {
        ...baseContext,
        serverUrl: subjectuniqueidentifier_url
      });
    } else {
      // Fallback to default servers if no URL in token
      swaggerSpec.servers = [
        {
          url: "https://api-url-not-set.example.com",
          description: "RODiT Development server (fallback)"
        }
      ];
      
      logger.warnWithContext("No valid API URL in RODIT token, using fallback servers", baseContext);
    }
  } catch (error) {
    logger.error("Failed to update Swagger servers configuration", {
      ...baseContext,
      error: error.message
    });
    
    // Use fallback configuration on error
    swaggerSpec.servers = [
      {
        url: "https://api-url-not-set.example.com",
        description: "RODiT Development server (error fallback)"
      }
    ];
  }
}

// Function to display RODIT token information during startup
async function displayRoditInfo(configObject) {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: "RoditInfo",
    method: "displayRoditInfo"
  });
  
  try {
    const own_rodit = configObject.own_rodit;
    const metadata = own_rodit.metadata;
    const token_id = own_rodit.token_id;
    
    // Get SDK version from package.json
    const packageJson = require('../package.json');
    const sdkVersion = packageJson.dependencies['@rodit/rodit-auth-be'] || 'unknown';
    
    // Extract network and contract from environment or metadata
    const nearContractId = process.env.NEAR_CONTRACT_ID || metadata.serviceprovider_id?.split(';')[1]?.replace('sc=', '') || 'unknown';
    const network = nearContractId.includes('testnet') ? 'testnet' : 'mainnet';
    
    logger.info('\n=== RODiT Authentication System ===');
    logger.info(`Version ${sdkVersion.replace('^', '')} running on ${network} at Smart Contract ${nearContractId}`);
    logger.info('Get help with: npm run help\n');
    
    logger.info('RODiT Contents');
    logger.info('▹▸▹▹▹ Authentication token information loaded...\n');
    
    // Display token information in a structured format
    const roditData = {
      token_id: token_id,
      metadata: {
        allowed_cidr: metadata.allowed_cidr || 'N/A',
        allowed_iso3166list: metadata.allowed_iso3166list || 'N/A',
        jwt_duration: metadata.jwt_duration || 'N/A',
        max_requests: metadata.max_requests || '0',
        maxrq_window: metadata.maxrq_window || '0',
        not_after: metadata.not_after || 'N/A',
        not_before: metadata.not_before || 'N/A',
        openapijson_url: metadata.openapijson_url || 'N/A',
        permissioned_routes: metadata.permissioned_routes || 'N/A',
        serviceprovider_id: metadata.serviceprovider_id || 'N/A',
        serviceprovider_signature: metadata.serviceprovider_signature || 'N/A',
        subjectuniqueidentifier_url: metadata.subjectuniqueidentifier_url || 'N/A',
        userselected_dn: metadata.userselected_dn || 'N/A',
        webhook_cidr: metadata.webhook_cidr || 'N/A',
        webhook_url: metadata.webhook_url || 'N/A'
      }
    };
    
    // Log the RODIT data in JSON format for easy reading
    logger.info(JSON.stringify(roditData, null, 2));
    logger.info('');
    
    // Update Swagger servers configuration with the API URL from RODIT token
    updateSwaggerServers(metadata.subjectuniqueidentifier_url);
    
    const duration = Date.now() - startTime;
    logger.infoWithContext("RODIT token information displayed successfully", {
      ...baseContext,
      duration,
      tokenId: token_id,
      network,
      contractId: nearContractId
    });
    
    // Add metric for RODIT info display
    logger.metric("rodit_info_operations", duration, {
      operation: "display",
      result: "success"
    });
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Failed to display RODIT token information",
      {
        ...baseContext,
        duration
      },
      error,
      "rodit_info_error",
      {
        operation: "display",
        result: "error",
        duration
      }
    );
    
    // Don't throw the error - just log it and continue
    logger.warn("RODIT token information could not be displayed, continuing with startup...");
  }
}

// Start the server with proper initialization
async function startServer() {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: "AppLifecycle",
    method: "startServer",
    nodeEnv: process.env.NODE_ENV || 'development',
    pid: process.pid
  });
  
  logger.infoWithContext("Server starting", baseContext);
  
  try {
    // Initialize performance service
    auth.performanceService.initialize();
    
    logger.infoWithContext("Initializing RODiT configuration", {
      ...baseContext,
      status: "initializing"
    });
    
    // Initialize credentials store and load RODiT configuration via SDK helper
    await auth.initConfig('server');

    logger.info("RODiT configuration initialized", {
      component: "vault",
      status: "initialized"
    });

    // Get and apply configuration
    const configObject = await stateManager.getConfigOwnRodit();
    if (!configObject) {
      throw new Error("Failed to initialize RODiT configuration");
    }

    // Display RODIT token information
    await displayRoditInfo(configObject);

    // Update rate limits if applicable
    const own_rodit = configObject.own_rodit;
    if (own_rodit.metadata.maxrequests && own_rodit.metadata.maxrqwindow) {
      updateRateLimit(
        own_rodit.metadata.maxrequests,
        own_rodit.metadata.maxrqwindow
      );
    }

    // Start the HTTP server
    const port = configObject.port || 8080;
    server = app.listen(port, () => {
      const serverStartDuration = Date.now() - startTime;
      
      const serverContext = createLogContext({
        ...baseContext,
        port,
        duration: serverStartDuration,
        protocol: "http",
        swagger: `/api-docs`
      });
      
      logger.infoWithContext("HTTP server started successfully", serverContext);
      
      // Add metric for server startup
      logger.metric("server_operations", serverStartDuration, {
        operation: "startup",
        result: "success"
      });
      
      logger.info(`\nRODiT Authentication API Server running on port ${port}`);
      
      const endpoints = [
        '  GET  / - Public welcome page',
        '  POST /api/login - Login with RODiT credentials',
        '  POST /api/logout - Logout (requires authentication)',
        '  GET  /api/echo - Echo service (requires authentication)',
        '  GET  /api/cruda - CRUD operations (requires authentication + permissions)',
        '  GET  /api-docs - Swagger API documentation'
      ];
      
      logger.info('Available endpoints:');
      endpoints.forEach(endpoint => logger.info(endpoint));
      logger.info('');
    });
    
    // Graceful shutdown handling
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Server initialization failed",
      {
        ...baseContext,
        duration
      },
      error,
      "server_startup_error",
      {
        operation: "startServer",
        result: "error",
        duration
      }
    );
    
    process.exit(1);
  }
}

// Graceful shutdown function
async function gracefulShutdown(signal) {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: "AppLifecycle",
    method: "gracefulShutdown",
    signal: signal || "unknown"
  });
  
  logger.infoWithContext("Shutting down gracefully", baseContext);
  
  try {
    if (server) {
      server.close(async () => {
        const duration = Date.now() - startTime;
        logger.infoWithContext("HTTP server closed", { 
          ...baseContext,
          component: "http-server",
          duration 
        });
        
        // Add metric for server shutdown
        logger.metric("server_operations", duration, {
          operation: "shutdown",
          result: "success"
        });
        
        // Close database connections
        await closeAllDatabases();
        
        process.exit(0);
      });
    } else {
      await closeAllDatabases();
      
      const duration = Date.now() - startTime;
      logger.infoWithContext("Server shutdown completed (no active HTTP server)", {
        ...baseContext,
        duration
      });
      
      process.exit(0);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Error during graceful shutdown",
      {
        ...baseContext,
        duration
      },
      error,
      "server_shutdown_error",
      {
        operation: "gracefulShutdown",
        result: "error",
        duration
      }
    );
    
    // Force exit in case of shutdown errors
    process.exit(1);
  }
}

// Helper function to close all database connections
async function closeAllDatabases() {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext({
    requestId,
    component: "DatabaseManager",
    method: "closeAllDatabases"
  });
  
  logger.debugWithContext("Closing all database connections", baseContext);
  
  // Check if db exists and has a close method before calling it
  if (db && typeof db.close === 'function') {
    try {
      await db.close();
      
      const duration = Date.now() - startTime;
      logger.infoWithContext("Main database connection closed", { 
        ...baseContext,
        component: "main-db",
        duration 
      });
      
      // Add metric for database close
      logger.metric("database_operations", duration, {
        operation: "close",
        database: "main-db",
        result: "success"
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Error closing main database",
        {
          ...baseContext,
          component: "main-db",
          duration
        },
        error,
        "database_error",
        {
          operation: "close",
          database: "main-db",
          result: "error",
          duration
        }
      );
    }
  }
  
  // Close the CRUDA database connection
  try {
    if (crudaprotectedRoute.closeDatabase) {
      const crudaStartTime = Date.now();
      await crudaprotectedRoute.closeDatabase();
      
      const crudaDuration = Date.now() - crudaStartTime;
      logger.infoWithContext("CRUDA database connection closed", { 
        ...baseContext,
        component: "cruda-db",
        duration: crudaDuration 
      });
      
      // Add metric for CRUDA database close
      logger.metric("database_operations", crudaDuration, {
        operation: "close",
        database: "cruda-db",
        result: "success"
      });
    }
  } catch (error) {
    const crudaDuration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Error closing CRUDA database",
      {
        ...baseContext,
        component: "cruda-db",
        duration: crudaDuration
      },
      error,
      "database_error",
      {
        operation: "close",
        database: "cruda-db",
        result: "error",
        duration: crudaDuration
      }
    );
  }
}

// Start the server
startServer();

// Export for testing purposes
module.exports = { app, startServer };
