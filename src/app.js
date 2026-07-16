// app.js
const crypto = require("crypto");
const express = require("express");
const { ulid } = require("ulid");

// Import SDK and create temporary client to access logger (following servertest-rodit pattern)
const { 
  RoditClient,
  roditManager, 
  stateManager, 
  blockchainService,
  sendError,
} = require('../sdk');

const tempClient = new RoditClient();
const logger = tempClient.getLogger();
const { createLogContext, logErrorWithMetrics } = logger;
const loggingmw = tempClient.getLoggingMiddleware();

// Import additional SDK services
const config = require('../sdk/services/configsdk');
const { verifyTlsConnectivity } = require('./utils/tls-check');

function redactLokiOptionsForLog(options) {
  const safe = {
    host: options.host,
    labels: options.labels,
    json: options.json,
    level: options.level,
    batching: options.batching,
    gracefulShutdown: options.gracefulShutdown,
    replaceTimestamp: options.replaceTimestamp,
    timeout: options.timeout,
    hasBasicAuth: Boolean(options.basicAuth),
    tlsSkipVerify: Boolean(options.ssl?.rejectUnauthorized === false),
  };
  return safe;
}

function validateStartupConfig() {
  config.validate(logger);
}

// Configure Loki transport for logging if LOKI_URL is set
(() => {
  const bootstrapContext = createLogContext("App", "lokiBootstrap", {
    component: "winston-loki-setup",
  });

  try {
    const lokiUrl = config.get("LOKI_URL");
    const logLevel = config.get("LOG_LEVEL");
    const skipTls = config.get("LOKI_TLS_SKIP_VERIFY") === true;
    const basicAuth = config.has("LOKI_BASIC_AUTH") ? config.get("LOKI_BASIC_AUTH") : null;
    const serviceName = config.get("SERVICE_NAME");

    logger.infoWithContext("Configuring logging transports", {
      ...bootstrapContext,
      lokiUrl: lokiUrl ?? null,
      lokiTlsSkipVerify: skipTls,
      lokiBasicAuthConfigured: Boolean(basicAuth),
      serviceName,
      logLevel,
    });

    const winston = require("winston");
    const LokiTransport = require("winston-loki");

    const transports = [
      new winston.transports.Console({
        format: winston.format.json(),
        level: logLevel,
      }),
    ];

    if (lokiUrl) {
      const lokiOptions = {
        host: lokiUrl,
        labels: {
          app: "clienttest-idc",
          component: "rodit-sdk",
          service_name: serviceName,
          service: serviceName,
        },
        json: true,
        level: logLevel,
        batching: false,
        gracefulShutdown: true,
        replaceTimestamp: true,
        timeout: 5000,
      };

      if (basicAuth) {
        lokiOptions.basicAuth = basicAuth;
      }
      if (skipTls) {
        lokiOptions.ssl = { rejectUnauthorized: false };
      }

      logger.debugWithContext("Creating winston-loki transport", {
        ...bootstrapContext,
        lokiOptions: redactLokiOptionsForLog(lokiOptions),
      });

      const lokiTransport = new LokiTransport(lokiOptions);

      lokiTransport.on("error", (err) => {
        logErrorWithMetrics(
          "winston-loki transport error",
          { ...bootstrapContext, error: err.message },
          err,
          "loki_transport_error"
        );
      });

      lokiTransport.on("warn", (warn) => {
        logger.warnWithContext("winston-loki transport warning", {
          ...bootstrapContext,
          warning: String(warn),
        });
      });

      transports.push(lokiTransport);
    } else {
      logger.infoWithContext("LOKI_URL not set; console transport only", bootstrapContext);
    }

    const customLogger = winston.createLogger({
      level: logLevel,
      format: winston.format.json(),
      transports,
    });

    logger.setLogger(customLogger);
    logger.infoWithContext("Logging transports configured", {
      ...bootstrapContext,
      transportCount: transports.length,
    });
  } catch (error) {
    logErrorWithMetrics(
      "Failed to configure Loki logging transport",
      { ...bootstrapContext, error: error.message },
      error,
      "loki_bootstrap_error"
    );
    throw error;
  }
})();

// Initialize Express app
const app = express();
app.locals.webhookReceipts = [];

// Log application startup
logger.info("Starting RODiT Authentication API Server", {
  nodeEnv: config.get("NODE_ENV"),
  pid: process.pid,
  version: process.env.npm_package_version,
  nodeVersion: process.version,
});

// Apply logging middleware
app.use(loggingmw);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: config.get("NODE_ENV"),
    service: config.get("SERVICE_NAME"),
  });
});

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
      environment: config.get("NODE_ENV")
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

  return sendError(res, {
    statusCode: err.statusCode || 500,
    requestId: req.requestId,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: 'Internal Server Error',
  });
});

// Import webhook functionality from SDK
const { 
  createWebhookHandler,
  WebhookEventHandlerFactory 
} = require("../sdk/lib/middleware/webhookhandlermw");

// Import client and test system
const { runSdkTests, runTestSuite, runSingleTest } = require("./test-system");

// Get configuration after SDK is initialized
const WEBHOOKPORT = config.get("API_DEFAULT_OPTIONS.WEBHOOKPORT");

// Create webhook handler with all necessary middleware
const webhookHandler = createWebhookHandler(stateManager);
const webhookEndpoints = ["/webhook", "/hooks/wake", "/hooks/agent"];

// Apply webhook middleware to the app
webhookHandler.applyMiddleware(app, express, { endpoints: webhookEndpoints });

// Create webhook event handler factory with dependencies
const webhookEventHandlerFactory = new WebhookEventHandlerFactory({
  configManager: null, // Will need to be implemented or imported
  runTestSuite,
  runSingleTest
});

const WEBHOOK_EVENT_ERROR_RESPONSES = {
  "Invalid payload format": {
    code: "INVALID_WEBHOOK_PAYLOAD",
    message: "Invalid payload format",
  },
  "Event type is required but was not provided": {
    code: "WEBHOOK_EVENT_REQUIRED",
    message: "Event type is required but was not provided",
  },
};

function resolveWebhookEventError(eventError) {
  if (typeof eventError === "string" && WEBHOOK_EVENT_ERROR_RESPONSES[eventError]) {
    return WEBHOOK_EVENT_ERROR_RESPONSES[eventError];
  }
  return {
    code: "WEBHOOK_PAYLOAD_ERROR",
    message: typeof eventError === "string" ? eventError : "Invalid webhook payload",
  };
}

async function handleIncomingWebhook(req, res) {
  const requestId = req.webhookAuthResult?.requestId || req.requestId || crypto.randomUUID();
  const logContext = {
    requestId,
    apiEndpoint: req.path,
    method: "POST",
    headers: Object.keys(req.headers),
    bodyKeys: Object.keys(req.body || {}),
    bodySize: req.rawBody ? req.rawBody.length : 0
  };

  try {
    // Process the webhook event using the SDK
    const event = webhookHandler.processWebhookEvent(req, logContext);

    if (event.error) {
      const { code, message } = resolveWebhookEventError(event.error);
      return sendError(res, {
        statusCode: 400,
        requestId,
        code,
        message,
      });
    }

    // Keep an in-memory trace of received webhook events for passive test assertions.
    // This lets tests validate that server-initiated webhooks were actually received.
    // Capture the rodit-auth-be 9.12.0 self-identifying signer + session-binding
    // fields the SDK middleware attaches, so tests can assert multi-peer-safe
    // reception (signer identity travels with the webhook; the verified binding
    // maps the signed session_id to the signer's implicit account).
    if (Array.isArray(app.locals.webhookReceipts)) {
      app.locals.webhookReceipts.push({
        requestId,
        path: req.path,
        event: event.type || event.event || null,
        timestamp: new Date().toISOString(),
        sessionId: req.webhook_session_id || null,
        signerImplicitAccount: req.webhook_signer_implicit_account || null,
        signerPublicKey: req.headers["x-rodit-public-key"] || null,
        signerTokenId: req.headers["x-rodit-token-id"] || null
      });
      if (app.locals.webhookReceipts.length > 200) {
        app.locals.webhookReceipts.shift();
      }
    }

    // Handle the event using the event handler factory
    const result = await webhookEventHandlerFactory.handleEvent(event, req, res);

    // Send the response
    return res.status(result.success ? 200 : 400).json(result);
  } catch (error) {
    logger.error("Error processing webhook", {
      ...logContext,
      error: error.message,
      stack: error.stack
    });
    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "WEBHOOK_PROCESSING_ERROR",
      message: "Error processing webhook",
    });
  }
}

// Apply route-level authentication to all webhook endpoints after SDK middleware.
for (const endpoint of webhookEndpoints) {
  app.post(endpoint, webhookHandler.authenticationMiddleware, handleIncomingWebhook);
}

// Start the server and run the client
// Store the RoditClient instance and server
let roditClient;
let server;

// Start the server
async function startServer() {
  try {
    validateStartupConfig();

    // Initialize the RODiT SDK and create RoditClient
    roditClient = await RoditClient.create('client');
    
    logger.info(`RODiT SDK initialized successfully`, {
      component: "server",
      environment: "server"
    });
    
    // Store the RoditClient in app.locals for test system access
    app.locals.roditClient = roditClient;
    
    logger.info(`RoditClient stored in app.locals for test system`, {
      component: "server",
      hasRoditClient: !!app.locals.roditClient
    });

    // Start the HTTP server
    server = app.listen(WEBHOOKPORT, () => {
      logger.info(`HTTP Server started on port ${WEBHOOKPORT}`, {
        component: "server",
        environment: "server"
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
    const { loadTestingEnvFile } = require("./test-utils/load-testing-env");
    const testingEnv = loadTestingEnvFile();
    if (testingEnv.loaded) {
      logger.info("Loaded test-only secrets from testing.env", {
        component: "client",
        path: testingEnv.path,
        keysLoaded: testingEnv.keys.length,
      });
    }

    const serverContext = {
      component: "client",
      status: "initializing",
      startTime: new Date().toISOString()
    };

    logger.info("Initializing RODiT configuration", serverContext);

    validateStartupConfig();

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
    // TLS check will be performed inside runSdkTests after RoditClient is fully initialized
    logger.info("Running all test suites", serverContext);

    const testResults = await runSdkTests(app).catch(error => {
      logger.error("Error running tests", {
        ...serverContext,
        error: error.message,
        stack: error.stack
      });
      return { error: error.message };
    });

    if (testResults && !testResults.error) {
      const sdkPassed = testResults.sdk?.passed === true;
      const nativePassed = testResults.native?.passed === true;
      const sdkSummary = testResults.sdk?.summary;
      const nativeSummary = testResults.native?.summary;
      const allTestsSuccess = sdkPassed && nativePassed;

      logger.info("All tests completed", {
        component: "client",
        status: allTestsSuccess ? "tests-complete" : "tests-not-passed",
        startTime: serverContext.startTime,
        endTime: new Date().toISOString(),
        sdkTestsSuccess: sdkPassed,
        nativeTestsSuccess: nativePassed,
        allTestsSuccess,
        sdk: sdkSummary,
        native: nativeSummary,
      });

      if (!allTestsSuccess) {
        logger.error("Deployment test suite not-passed — aborting startup", {
          component: "client",
          sdk: sdkSummary,
          native: nativeSummary,
        });
        process.exit(1);
      }
    } else if (testResults?.tls) {
      logger.warn("Tests skipped due to TLS connectivity issue", {
        ...serverContext,
        ...testResults.tls
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