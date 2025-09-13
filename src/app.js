// app.js
const express = require("express");
const crypto = require("crypto");
const path = require('path');
const fs = require('fs');
const { ulid } = require('ulid');

// Import SDK components first
const sdk = require('../sdk');
const { 
  config, 
  stateManager, 
  roditManager, 
  blockchainService,
  logger,
  loggingmw 
} = sdk;

// Configuration constants
const SERVICE_NAME = config.get("SERVICE_NAME", 'clienttestapi');
const isProduction = process.env.NODE_ENV === 'production';

// Initialize Express app
const app = express();

// Log application startup - using the logger from SDK
if (logger && typeof logger.info === 'function') {
  logger.info('Application starting', {
    service: SERVICE_NAME,
    environment: process.env.NODE_ENV || 'development',
    nodeVersion: process.version,
      hostname: require('os').hostname()
  });
} else {
  console.log('Logger not properly initialized, starting application in fallback mode');
  console.log('Service:', SERVICE_NAME);
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Node Version:', process.version);
  console.log('PID:', process.pid);
}

// Apply logging middleware
app.use(loggingmw);

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
} = require("../sdk/lib/webhook/webhookhandler.js");

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

// Add new API endpoints for test management
app.get("/api/test/config", async (req, res) => {
  try {
    // Using roditManager imported at the top of the file
    // Config already imported at top of file
    
    // Get RODiT configuration from the StateManager
    let roditConfig = await stateManager.getConfigOwnRodit();
    
    // Check if RODiT configuration is initialized
    if (!roditConfig) {
      // If not initialized, try to initialize it
      try {
        await roditManager.initializeRoditConfig("client");
        // Get the updated configuration
        roditConfig = await stateManager.getConfigOwnRodit();
      } catch (initError) {
        logger.warn("Could not initialize RODiT configuration", {
        endpoint: "/api/test/config",
        method: "GET",
        error: initError.message,
        stack: initError.stack
      });
      }
    }
    
    // Combine configuration from state managers and config module
    const appConfig = {
      // Get RODiT-specific configuration from the state manager
      own_rodit: roditConfig?.own_rodit || {},
      
      // Get other configuration from config module
      API_DEFAULT_OPTIONS: {
        // Use ISO values from the RODiT token metadata if available
        ISO639: (roditConfig.own_rodit?.metadata?.iso639) || config.get("API_DEFAULT_OPTIONS.ISO639"),
        ISO3166: (roditConfig.own_rodit?.metadata?.iso3166) || config.get("API_DEFAULT_OPTIONS.ISO3166"),
        ISO15924: (roditConfig.own_rodit?.metadata?.iso15924) || config.get("API_DEFAULT_OPTIONS.ISO15924"),
        TIMEOPTIONS: config.get("API_DEFAULT_OPTIONS.TIMEOPTIONS"),
        LOG_DIR: config.get("API_DEFAULT_OPTIONS.LOG_DIR"),
        TEST_CLIENT_DURATION: config.get("API_DEFAULT_OPTIONS.TEST_CLIENT_DURATION"),
        TEST_INTERVAL: config.get("API_DEFAULT_OPTIONS.TEST_INTERVAL"),
        ENABLED_TEST_SUITES: config.get("API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES")
      }
    };
    
    res.json(appConfig);
  } catch (error) {
    logger.error("Error getting configuration", {
        endpoint: "/api/test/config",
        method: "GET",
        error: error.message,
        stack: error.stack
      });
    res.status(500).json({ error: "Failed to get configuration" });
  }
});

app.post("/api/test/config", async (req, res) => {
  try {
    const updates = req.body;
    
    // Log the update request
    logger.info("Configuration update requested", {
      updates: Object.keys(updates)
    });
    
    // For RODiT-specific updates, we could potentially update the state manager
    // This would require implementing an update method in the RoditManager
    // For now, we'll just return the current configuration
    
    // Get RODiT configuration from the StateManager
    const roditConfig = await stateManager.getConfigOwnRodit();
    
    // Combine configuration from state managers and config module
    const updatedConfig = {
      // Get RODiT-specific configuration from the state manager
      own_rodit: roditConfig.own_rodit,
      
      // Get other configuration from config module
      API_DEFAULT_OPTIONS: {
        // Use ISO values from the RODiT token metadata if available
        ISO639: (roditConfig.own_rodit?.metadata?.iso639) || config.get("API_DEFAULT_OPTIONS.ISO639"),
        ISO3166: (roditConfig.own_rodit?.metadata?.iso3166) || config.get("API_DEFAULT_OPTIONS.ISO3166"),
        ISO15924: (roditConfig.own_rodit?.metadata?.iso15924) || config.get("API_DEFAULT_OPTIONS.ISO15924"),
        TIMEOPTIONS: config.get("API_DEFAULT_OPTIONS.TIMEOPTIONS"),
        LOG_DIR: config.get("API_DEFAULT_OPTIONS.LOG_DIR"),
        TEST_CLIENT_DURATION: config.get("API_DEFAULT_OPTIONS.TEST_CLIENT_DURATION"),
        TEST_INTERVAL: config.get("API_DEFAULT_OPTIONS.TEST_INTERVAL"),
        ENABLED_TEST_SUITES: config.get("API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES")
      }
    };
    res.json({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    logger.error("Error updating configuration", {
        endpoint: "/api/test/config",
        method: "POST",
        error: error.message,
        stack: error.stack
      });
    res.status(500).json({ error: "Failed to update configuration" });
  }
});

// Add a new endpoint to get all test results
app.get("/api/test/results", (req, res) => {
  try {
    const { getTestExecutionState } = require("./test-system");
    const state = getTestExecutionState();
    
    // Format the results for display
    const formattedResults = Object.entries(state.allTestResults).map(([fullTestName, result]) => ({
      fullTestName,
      suiteName: result.suiteName,
      testName: result.testName,
      result: result.result,
      endpoint: result.endpoint,
      timestamp: result.timestamp,
      duration: result.duration,
      error: result.error,
      details: result.details
    }));
    
    res.json({
      success: true,
      latestRun: state.latestRun,
      totalTests: formattedResults.length,
      results: formattedResults
    });
  } catch (error) {
    logger.error("Error retrieving test results", {
        endpoint: "/api/test/results",
        method: "GET",
        error: error.message,
        stack: error.stack
      });
    res.status(500).json({ error: "Failed to retrieve test results" });
  }
});

app.post("/api/test/run-suite/:suiteName", async (req, res) => {
  try {
    const { suiteName } = req.params;
    const { apiEndpoint } = req.body;

    if (!apiEndpoint) {
      return res.status(400).json({ error: "API endpoint is required" });
    }

    // Run the test suite asynchronously
    runTestSuite(apiEndpoint, suiteName).catch((error) => {
      logger.error(`Error running test suite ${suiteName}`, {
        error: error.message,
        stack: error.stack
      });
    });

    res.json({
      success: true,
      message: `Test suite ${suiteName} started`,
    });
  } catch (error) {
    logger.error("Error initiating test suite", {
      endpoint: `/api/test/run-suite/${req.params.suiteName}`,
      method: "POST",
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Failed to start test suite" });
  }
});

app.post("/api/test/run-test/:suiteName/:testName", async (req, res) => {
  try {
    const { suiteName, testName } = req.params;
    const { apiEndpoint } = req.body;

    if (!apiEndpoint) {
      return res.status(400).json({ error: "API endpoint is required" });
    }

    // Run the test asynchronously
    runSingleTest(apiEndpoint, suiteName, testName).catch((error) => {
      logger.error(`Error running test ${suiteName}.${testName}`, {
        error: error.message,
        stack: error.stack
      });
    });

    res.json({
      success: true,
      message: `Test ${suiteName}.${testName} started`,
    });
  } catch (error) {
    logger.error("Error initiating test", {
      endpoint: `/api/test/run-test/${req.params.suiteName}/${req.params.testName}`,
      method: "POST",
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: "Failed to start test" });
  }
});

// Start the server and run the client
const server = app.listen(WEBHOOKPORT, async () => {
  const serverContext = {
    component: "client",
    port: WEBHOOKPORT,
    startTime: new Date().toISOString(),
  };

  logger.info(`Webhook server listening on port ${WEBHOOKPORT}`, serverContext);

  try {
    logger.info("Initializing RODiT configuration", serverContext);
    
    // Initialize RODiT configuration using SDK helper
    await sdk.initConfig('client');
    
    // Initialize performance service if available
    if (blockchainService.performanceService) {
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
    const testResults = await runSdkTests().catch(error => {
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
    serverContext.status = "error";
    logger.error("Error during server startup", {
      ...serverContext,
      error: error.message,
      stack: error.stack
    });
    process.exit(1);
  }
});

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

module.exports = app;