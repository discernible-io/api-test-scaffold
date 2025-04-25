// app.js
const config = require("config");
const express = require("express");
const bodyParser = require("body-parser");
const logger = require("../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const {
  roditManager,
  stateManager,
  authenticate_webhook,
  login_server,
  fetchWithErrorHandling,
} = require("./middleware/rodit");

// Import enhanced client and configuration manager
const { enhancedClient, runTestSuite, runSingleTest } = require("./enhanced-client");
const configManager = require("./config-manager");

// Configuration constants
const VAULT_RODIT_KEYVALUE_PATH = config.get("VAULT_RODIT_KEYVALUE_PATH");
const WEBHOOKPORT = config.get("WEBHOOKPORT");

// Set up Express server
const app = express();
app.use(bodyParser.json());

const attachPeerKey = (peer_bytes_ed25519_public_key) => (req, res, next) => {
  req.peer_bytes_ed25519_public_key = peer_bytes_ed25519_public_key;
  next();
};

// Webhook endpoint
app.post(
  "/webhook",
  async (req, res, next) => {
    const requestId = crypto.randomUUID();
    const logContext = {
      requestId,
      endpoint: "/webhook",
      method: "POST",
    };

    try {
      // Get peer key from state manager
      logger.infoWithContext("Fetching peer public key", logContext);
      const config = await stateManager.getConfigOwnRodit();
      if (
        !config ||
        !config.peer_rodit ||
        !config.peer_rodit.bytes_ed25519_public_key
      ) {
        logger.errorWithContext("Peer public key not available", logContext);
        throw new Error("Peer public key not available");
      }
      req.peer_bytes_ed25519_public_key =
        config.peer_rodit.bytes_ed25519_public_key;
      logContext.peerKeyFound = true;
      logger.debugWithContext("Peer key attached to request", logContext);
      next();
    } catch (error) {
      logger.errorWithContext("Error getting peer key", logContext, error);
      res.status(500).json({ error: "Internal server error" });
    }
  },
  async (req, res) => {
    const requestId = crypto.randomUUID();
    const logContext = {
      requestId,
      endpoint: "/webhook",
      method: "POST",
    };

    try {
      const signature_hex_ofpayload = req.headers["x-signature"];
      const timestamp = req.headers["x-timestamp"];
      const payload = JSON.stringify(req.body);

      logContext.hasSignature = !!signature_hex_ofpayload;
      logContext.hasTimestamp = !!timestamp;

      // Authenticate the webhook
      logger.debugWithContext("Authenticating webhook", logContext);
      const authResult = authenticate_webhook(
        payload,
        signature_hex_ofpayload,
        timestamp,
        req.peer_bytes_ed25519_public_key
      );

      if (!authResult.isValid) {
        logContext.authError = authResult.error?.message;
        logger.warnWithContext("Invalid webhook signature", logContext);
        throw new Error(authResult.error.message);
      }

      // If we've made it here, the signature is valid
      const { event, data, isError } = req.body;
      logContext.event = event;
      logContext.hasData = !!data;
      logContext.isError = isError;
      logContext.webhookRequestId = authResult.requestId;

      logger.infoWithContext(
        `Received authenticated webhook: ${event}`,
        logContext
      );

      // Process webhook based on event type
      switch (event) {
        case 'test_config_update':
          // Handle dynamic test configuration update
          if (data && data.config) {
            try {
              await configManager.updateConfig(data.config);
              res.status(200).json({ 
                success: true, 
                message: "Configuration updated successfully" 
              });
            } catch (error) {
              logger.errorWithContext("Error updating configuration", {
                ...logContext,
                error: error.message
              });
              res.status(500).json({ 
                error: "Failed to update configuration",
                message: error.message
              });
            }
          } else {
            res.status(400).json({ error: "Invalid configuration data" });
          }
          break;
          
        case 'run_test_suite':
          // Handle request to run a specific test suite
          if (data && data.suiteName) {
            // Run the test suite asynchronously
            runTestSuite(data.apiEndpoint, data.suiteName)
              .catch(error => {
                logger.errorWithContext(`Error running test suite ${data.suiteName}`, {
                  ...logContext,
                  error: error.message
                });
              });
            
            // Respond immediately
            res.status(200).json({ 
              success: true, 
              message: `Test suite ${data.suiteName} started` 
            });
          } else {
            res.status(400).json({ error: "Invalid test suite data" });
          }
          break;
          
        case 'run_single_test':
          // Handle request to run a specific test
          if (data && data.suiteName && data.testName) {
            // Run the test asynchronously
            runSingleTest(data.apiEndpoint, data.suiteName, data.testName)
              .catch(error => {
                logger.errorWithContext(`Error running test ${data.testName}`, {
                  ...logContext,
                  error: error.message
                });
              });
            
            // Respond immediately
            res.status(200).json({ 
              success: true, 
              message: `Test ${data.suiteName}.${data.testName} started` 
            });
          } else {
            res.status(400).json({ error: "Invalid test data" });
          }
          break;
          
        default:
          logger.warnWithContext(`Unhandled event type: ${event}`, logContext);
          res.sendStatus(200);
      }
    } catch (error) {
      logger.errorWithContext("Error processing webhook", logContext, error);
      res.status(400).json({ error: error.message });
    }
  }
);

// Add new API endpoints for test management
app.get("/api/test/config", async (req, res) => {
  try {
    const config = await configManager.getConfig();
    res.json(config);
  } catch (error) {
    logger.errorWithContext("Error getting configuration", {
      endpoint: "/api/test/config",
      method: "GET",
      error: error.message
    }, error);
    res.status(500).json({ error: "Failed to get configuration" });
  }
});

app.post("/api/test/config", async (req, res) => {
  try {
    const updates = req.body;
    const updatedConfig = await configManager.updateConfig(updates);
    res.json({
      success: true,
      config: updatedConfig
    });
  } catch (error) {
    logger.errorWithContext("Error updating configuration", {
      endpoint: "/api/test/config",
      method: "POST",
      error: error.message
    }, error);
    res.status(500).json({ error: "Failed to update configuration" });
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
    runTestSuite(apiEndpoint, suiteName)
      .catch(error => {
        logger.errorWithContext(`Error running test suite ${suiteName}`, {
          error: error.message
        });
      });
    
    res.json({
      success: true,
      message: `Test suite ${suiteName} started`
    });
  } catch (error) {
    logger.errorWithContext("Error initiating test suite", {
      endpoint: `/api/test/run-suite/${req.params.suiteName}`,
      method: "POST",
      error: error.message
    }, error);
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
    runSingleTest(apiEndpoint, suiteName, testName)
      .catch(error => {
        logger.errorWithContext(`Error running test ${suiteName}.${testName}`, {
          error: error.message
        });
      });
    
    res.json({
      success: true,
      message: `Test ${suiteName}.${testName} started`
    });
  } catch (error) {
    logger.errorWithContext("Error initiating test", {
      endpoint: `/api/test/run-test/${req.params.suiteName}/${req.params.testName}`,
      method: "POST",
      error: error.message
    }, error);
    res.status(500).json({ error: "Failed to start test" });
  }
});

// Start the server and run the client
const server = app.listen(WEBHOOKPORT, async () => {
  const serverContext = {
    component: "server",
    port: WEBHOOKPORT,
    startTime: new Date().toISOString(),
  };

  logger.infoWithContext(
    `Webhook server listening on port ${WEBHOOKPORT}`,
    serverContext
  );

  try {
    // Load configuration
    const testConfig = await configManager.getConfig();
    
    // Run the enhanced client
    logger.infoWithContext("Starting enhanced client", serverContext);
    await enhancedClient(testConfig);
    
    serverContext.status = "ready";
    logger.infoWithContext(
      "Server ready to accept webhook requests",
      serverContext
    );
  } catch (error) {
    serverContext.status = "error";
    logger.errorWithContext(
      "Error during server startup",
      serverContext,
      error
    );
    process.exit(1);
  }
});

process.on("SIGINT", () => {
  const shutdownContext = {
    component: "server",
    signal: "SIGINT",
    shutdownTime: new Date().toISOString(),
  };

  logger.infoWithContext(
    "SIGINT signal received: closing HTTP server",
    shutdownContext
  );
  server.close(() => {
    logger.infoWithContext("HTTP server closed", shutdownContext);
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  const shutdownContext = {
    component: "server",
    signal: "SIGTERM",
    shutdownTime: new Date().toISOString(),
  };

  logger.infoWithContext(
    "SIGTERM signal received: closing HTTP server",
    shutdownContext
  );
  server.close(() => {
    logger.infoWithContext("HTTP server closed", shutdownContext);
    process.exit(0);
  });
});

module.exports = app;