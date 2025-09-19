// app.js
const crypto = require("crypto");
const express = require("express");
const { ulid } = require("ulid");

// Import SDK and create temporary client to access logger (following servertest-rodit pattern)
const { 
  RoditClient,
  roditManager, 
  stateManager, 
  sessionManager, 
  blockchainService,
  authenticate_apicall,
  validatePermissions,
  login_server,
  logout_client,
  login_client_withnep413
} = require('../sdk');

const tempClient = new RoditClient();
const logger = tempClient.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;
const loggingmw = tempClient.getLoggingMiddleware();

// Import additional SDK services
const config = require('../sdk/services/configsdk');

// Configure Loki transport for logging if LOKI_URL is set
(() => {
  try {
    console.log("=== Enhanced winston-loki debugging ===");
    const lokiUrl = process.env.LOKI_URL;
    const logLevel = process.env.LOG_LEVEL || "info";
    const skipTls = String(process.env.LOKI_TLS_SKIP_VERIFY || "").toLowerCase() === "true";
    const basicAuth = process.env.LOKI_BASIC_AUTH;

    console.log("Environment variables:");
    console.log("  LOKI_URL:", lokiUrl || "NOT SET");
    console.log("  LOKI_TLS_SKIP_VERIFY:", process.env.LOKI_TLS_SKIP_VERIFY || "NOT SET");
    console.log("  LOKI_BASIC_AUTH:", basicAuth ? "SET" : "NOT SET");
    console.log("  LOG_LEVEL:", logLevel);

    const winston = require('winston');
    const LokiTransport = require('winston-loki');

    const transports = [
      new winston.transports.Console({ format: winston.format.json(), level: logLevel })
    ];

    if (lokiUrl) {
      console.log("Creating winston-loki transport...");
      const lokiOptions = {
        host: lokiUrl,
        labels: { 
          app: "clienttestapi", 
          component: "sdk"
        },
        json: true,
        level: logLevel,
        batching: true,
        gracefulShutdown: true,
        replaceTimestamp: true,
        timeout: 5000,
      };

      if (basicAuth) {
        lokiOptions.basicAuth = basicAuth;
        console.log("Added basic auth to Loki lokioptionsionsions");
      }
      if (skipTls) {
        lokiOptions.ssl = { rejectUnauthorized: false };
        console.log("Added TLS skip verification to Loki lokioptions");
      }

      console.log("Loki transport lokioptions:", JSON.stringify(lokiOptions, null, 2));

      const lokiTransport = new LokiTransport(lokiOptions);
      
      lokiTransport.on('error', (err) => {
        console.error("❌ winston-loki transport ERROR:", err.message);
        console.error("Error details:", err);
      });

      lokiTransport.on('warn', (warn) => {
        console.warn("⚠️ winston-loki transport WARN:", warn);
      });

      transports.push(lokiTransport);
      console.log("✅ winston-loki transport added to transports");
    } else {
      console.log("❌ LOKI_URL not set - winston-loki transport will not be created");
    }

    const customLogger = winston.createLogger({
      level: logLevel,
      format: winston.format.json(),
      transports,
    });

    console.log("Created custom logger with", transports.length, "transports");
    logger.setLogger(customLogger);
    console.log("✅ Custom logger injected into SDK");
    
    // Test the logger immediately
    customLogger.info("winston-loki transport test log", { 
      timestamp: new Date().toISOString(),
      test: true,
      component: "winston-loki-setup"
    });
    console.log("✅ Test log sent through custom logger");
    
  } catch (e) {
    console.warn("❌ SDK Loki logger injection failed:", e?.message || e);
    console.error("Full error:", e);
  }
})();

// Initialize Express app
const app = express();

// Log application startup
logger.info("Starting RODiT Authentication API Server", {
  nodeEnv: process.env.NODE_ENV || "development",
  pid: process.pid,
  version: process.env.npm_package_version,
  nodeVersion: process.version,
});

// Apply logging middleware
app.use(loggingmw);

// Test endpoint for verifying logging functionality
app.get('/api/test/logging', (req, res) => {
  try {
    // Test different log levels
    logger.debug('This is a DEBUG level message', { test: 'debug', timestamp: new Date().toISOString() });
    logger.info('This is an INFO level message', { test: 'info', timestamp: new Date().toISOString() });
    logger.warn('This is a WARN level message', { test: 'warn', timestamp: new Date().toISOString() });
    logger.error('This is an ERROR level message', { 
      test: 'error', 
      timestamp: new Date().toISOString(),
      error: new Error('Test error with stack trace')
    });

    // Test structured logging with context
    logger.infoWithContext('Structured log with context', {
      component: 'logging-test',
      requestId: req.requestId || 'none',
      testData: {
        string: 'test string',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        object: { key: 'value' }
      }
    });

    res.json({
      success: true,
      message: 'Test logs generated successfully',
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  } catch (error) {
    logger.error('Error in logging test endpoint', { 
      error: error.message, 
      stack: error.stack,
      requestId: req.requestId 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to generate test logs',
      message: error.message,
      requestId: req.requestId
    });
  }
});

// Request context and performance monitoring middleware
app.use((req, res, next) => {
  req.startTime = Date.now();
  req.requestId = req.headers['x-request-id'] || req.headers['x-correlation-id'] || ulid();
  req.traceId = req.headers['x-trace-id'] || crypto.randomUUID();
  
  // Add response tracking
  res.on('finish', () => {
    const duration = Date.now() - req.startTime;
    
    // Log performance metrics
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

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Request error', {
    error: {
      message: err.message,
      stack: err.stack,
      ...(err.code && { code: err.code })
    },
    request: {
      method: req.method,
      url: req.originalUrl,
      requestId: req.requestId,
      traceId: req.traceId
    }
  });

  res.status(500).json({
    error: 'Internal Server Error',
    requestId: req.requestId
  });
});

// Import webhook functionality from SDK
const { 
  createWebhookHandler,
  WebhookEventHandlerFactory 
} = require("../sdk/lib/middleware/webhookhandler");

// Import client and test system
const { runSdkTests, runTestSuite, runSingleTest } = require("./test-system");

// Get configuration after SDK is initialized
const WEBHOOKPORT = config.get("WEBHOOKPORT");

// Create webhook handler with all necessary middleware
const webhookHandler = createWebhookHandler(stateManager);

// Apply webhook middleware to the app
webhookHandler.applyMiddleware(app, express);

// Create webhook event handler factory with dependencies
const webhookEventHandlerFactory = new WebhookEventHandlerFactory({
  configManager: null, // Will need to be implemented or imported
  runTestSuite,
  runSingleTest
});

// Set up the webhook route with authentication middleware
app.post(
  "/webhook",
  // Use the authentication middleware from the webhook handler
  webhookHandler.authenticationMiddleware,
  
  // Process the webhook event
  async (req, res) => {
    const requestId = req.webhookAuthResult?.requestId || crypto.randomUUID();
    const logContext = {
      requestId,
      endpoint: "/webhook",
      method: "POST",
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
      bodySize: req.rawBody ? req.rawBody.length : 0
    };
    
    try {
      // Process the webhook event using the SDK
      const event = webhookHandler.processWebhookEvent(req, logContext);
      
      if (event.error) {
        return res.status(400).json({ error: event.error });
      }
      
      // Handle the event using the event handler factory
      const result = await webhookEventHandlerFactory.handleEvent(event, req, res);
      
      // Send the response
      res.status(result.success ? 200 : 400).json(result);
    } catch (error) {
      logger.error("Error processing webhook", {
        ...logContext,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({ error: error.message });
    }
  }
);

// Start the server and run the client
// Store the RoditClient instance and server
let roditClient;
let server;

// Start the server
async function startServer() {
  try {
    // Initialize the RODiT SDK with a single function call
    const configObject = await roditManager.initializeRoditConfig("client");
    
    logger.info(`RODiT SDK initialized successfully`, {
      component: "server",
      environment: configObject.environment || "unknown"
    });
    
    // The configObject contains the RODiT configuration including own_rodit
    const { own_rodit } = configObject;

    // Start the HTTP server
    server = app.listen(WEBHOOKPORT, () => {
      logger.info(`HTTP Server started on port ${WEBHOOKPORT}`, {
        component: "server",
        environment: configObject.environment || "unknown"
      });
    });

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("SIGTERM signal received: closing HTTP server", {
        component: "server"
      });
      server.close(() => {
        logger.info("HTTP server closed", { component: "server" });
        process.exit(0);
      });
    });

    return server;
  } catch (error) {
    logger.error(`Error 907: Failed to start server: ${error.message}`, {
      component: "server",
      error: error.stack
    });
    process.exit(1);
  }
}

// Start the server
startServer().catch(error => {
  logger.error("Fatal error in server startup:", error);
  process.exit(1);
});

// Initialize and start the test client
(async () => {
  try {
    const serverContext = {
      component: "client",
      status: "initializing",
      startTime: new Date().toISOString()
    };

    logger.info("Initializing RODiT configuration", serverContext);
    
    // Create and initialize the client in one step
    roditClient = await RoditClient.create('client');
    
    // Store the client in app.locals for access throughout the application
    app.locals.roditClient = roditClient;
    
    logger.info("RoditClient initialized successfully", {
      component: "client",
      status: "initialized"
    });
    
    // Initialize performance service if available
    if (blockchainService && blockchainService.performanceService) {
      blockchainService.performanceService.initialize();
    }
    
    logger.info("RODiT configuration initialized", {
      component: "client",
      status: "initialized"
    });
    
    // Get and verify configuration
    const configObject = await stateManager.getConfigOwnRodit();
    if (!configObject) {
      throw new Error("Failed to initialize RODiT configuration");
    }
    
    // Run all tests (SDK and native) using the updated runSdkTests function
    logger.info("Running all test suites", serverContext);
    
    // Run both SDK and native tests
    const testResults = await runSdkTests(app).catch(error => {
      logger.error("Error running tests", {
        ...serverContext,
        error: error.message,
        stack: error.stack
      });
      return { error: error.message };
    });
    
    // Log test results summary
    if (testResults && !testResults.error) {
      logger.info("All tests completed", {
        ...serverContext,
        sdkTestsSuccess: testResults.sdk?.success || false,
        nativeTestsSuccess: testResults.native?.success || false
      });
    }

    serverContext.status = "ready";
    logger.info("Server ready to accept webhook requests", serverContext);
  } catch (error) {
    logger.error("Error during server startup", {
      component: "client",
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
})();

process.on("SIGINT", () => {
  const shutdownContext = {
    component: "client",
    signal: "SIGINT",
    shutdownTime: new Date().toISOString(),
  };

  logger.info("SIGINT signal received: closing HTTP server", shutdownContext);
  server.close(() => {
    logger.info("HTTP server closed", shutdownContext);
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  const shutdownContext = {
    component: "client",
    signal: "SIGTERM",
    shutdownTime: new Date().toISOString(),
  };

  logger.info("SIGTERM signal received: closing HTTP server", shutdownContext);
  server.close(() => {
    logger.info("HTTP server closed", shutdownContext);
    process.exit(0);
  });
});

// Export the app
module.exports = {
  app
};