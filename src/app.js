// app.js
const config = require("config");
const express = require("express");
const bodyParser = require("body-parser");
const logger = require("../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { stateManager, authenticate_webhook } = require("./middleware/rodit");

// Import enhanced client and configuration manager
const {
  enhancedClient,
  runTestSuite,
  runSingleTest,
} = require("./enhanced-client");
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
      // Get authorization header
      const authHeader = req.headers["authorization"];
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        logger.errorWithContext(
          "Missing authorization token in webhook request",
          logContext
        );
        return res.status(401).json({ error: "Authorization token required" });
      }

      // Extract and decode the token
      const token = authHeader.replace("Bearer ", "");

      // Get the own_rodit configuration
      const roditConfig = await stateManager.getConfigOwnRodit();
      if (!roditConfig || !roditConfig.own_rodit) {
        logger.errorWithContext(
          "Own RODiT configuration not available",
          logContext
        );
        return res.status(500).json({ error: "Server configuration error" });
      }

      // Validate the token and get peer_rodit
      try {
        const validation = await validate_jwt_token_be(
          token,
          roditConfig.own_rodit
        );
        const peer_rodit = validation.peer_rodit;

        if (!peer_rodit || !peer_rodit.owner_id) {
          logger.errorWithContext("Invalid peer RODiT information in token", {
            ...logContext,
            hasPeerRodit: !!peer_rodit,
            hasOwnerId: peer_rodit ? !!peer_rodit.owner_id : false,
          });
          return res
            .status(401)
            .json({ error: "Invalid authentication token data" });
        }

        // Convert peer_rodit.owner_id (hex) to bytes for verification
        req.peer_bytes_ed25519_public_key = new Uint8Array(
          Buffer.from(peer_rodit.owner_id, "hex")
        );

        logContext.peerKeyFound = true;
        logContext.peerRoditId = peer_rodit.token_id;
        logger.debugWithContext(
          "Peer key extracted from JWT token",
          logContext
        );
        next();
      } catch (validationError) {
        logger.errorWithContext("JWT token validation failed", {
          ...logContext,
          error: validationError.message,
          stack: validationError.stack,
        });
        return res.status(401).json({ error: "Invalid authentication token" });
      }
    } catch (error) {
      logger.errorWithContext(
        "Error processing webhook authentication",
        logContext,
        error
      );
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
        case "test_config_update":
          // Handle dynamic test configuration update
          if (data && data.config) {
            try {
              await configManager.updateConfig(data.config);
              res.status(200).json({
                success: true,
                message: "Configuration updated successfully",
              });
            } catch (error) {
              logger.errorWithContext("Error updating configuration", {
                ...logContext,
                error: error.message,
              });
              res.status(500).json({
                error: "Failed to update configuration",
                message: error.message,
              });
            }
          } else {
            res.status(400).json({ error: "Invalid configuration data" });
          }
          break;

        case "run_test_suite":
          // Handle request to run a specific test suite
          if (data && data.suiteName) {
            // Run the test suite asynchronously
            runTestSuite(data.apiEndpoint, data.suiteName).catch((error) => {
              logger.errorWithContext(
                `Error running test suite ${data.suiteName}`,
                {
                  ...logContext,
                  error: error.message,
                }
              );
            });

            // Respond immediately
            res.status(200).json({
              success: true,
              message: `Test suite ${data.suiteName} started`,
            });
          } else {
            res.status(400).json({ error: "Invalid test suite data" });
          }
          break;

        case "run_single_test":
          // Handle request to run a specific test
          if (data && data.suiteName && data.testName) {
            // Run the test asynchronously
            runSingleTest(
              data.apiEndpoint,
              data.suiteName,
              data.testName
            ).catch((error) => {
              logger.errorWithContext(`Error running test ${data.testName}`, {
                ...logContext,
                error: error.message,
              });
            });

            // Respond immediately
            res.status(200).json({
              success: true,
              message: `Test ${data.suiteName}.${data.testName} started`,
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
    logger.errorWithContext(
      "Error getting configuration",
      {
        endpoint: "/api/test/config",
        method: "GET",
        error: error.message,
      },
      error
    );
    res.status(500).json({ error: "Failed to get configuration" });
  }
});

app.post("/api/test/config", async (req, res) => {
  try {
    const updates = req.body;
    const updatedConfig = await configManager.updateConfig(updates);
    res.json({
      success: true,
      config: updatedConfig,
    });
  } catch (error) {
    logger.errorWithContext(
      "Error updating configuration",
      {
        endpoint: "/api/test/config",
        method: "POST",
        error: error.message,
      },
      error
    );
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
    runTestSuite(apiEndpoint, suiteName).catch((error) => {
      logger.errorWithContext(`Error running test suite ${suiteName}`, {
        error: error.message,
      });
    });

    res.json({
      success: true,
      message: `Test suite ${suiteName} started`,
    });
  } catch (error) {
    logger.errorWithContext(
      "Error initiating test suite",
      {
        endpoint: `/api/test/run-suite/${req.params.suiteName}`,
        method: "POST",
        error: error.message,
      },
      error
    );
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
      logger.errorWithContext(`Error running test ${suiteName}.${testName}`, {
        error: error.message,
      });
    });

    res.json({
      success: true,
      message: `Test ${suiteName}.${testName} started`,
    });
  } catch (error) {
    logger.errorWithContext(
      "Error initiating test",
      {
        endpoint: `/api/test/run-test/${req.params.suiteName}/${req.params.testName}`,
        method: "POST",
        error: error.message,
      },
      error
    );
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
    const testConfig = await configManager.getConfig();

    testConfig.API_OPTIONS = testConfig.API_OPTIONS || {};
    if (!testConfig.API_OPTIONS.TEST_CLIENT_DURATION) {
      testConfig.API_OPTIONS.TEST_CLIENT_DURATION = config.has(
        "API_OPTIONS.TEST_CLIENT_DURATION"
      )
        ? config.get("API_OPTIONS.TEST_CLIENT_DURATION")
        : "1";
    }

    if (!testConfig.API_OPTIONS.TEST_INTERVAL) {
      testConfig.API_OPTIONS.TEST_INTERVAL = config.has(
        "API_OPTIONS.TEST_INTERVAL"
      )
        ? config.get("API_OPTIONS.TEST_INTERVAL")
        : "1";
    }

    // Log the config being used for debug purposes
    logger.debugWithContext("Starting enhanced client with config", {
      ...serverContext,
      configValues: {
        testDuration: testConfig.API_OPTIONS.TEST_CLIENT_DURATION,
        testInterval: testConfig.API_OPTIONS.TEST_INTERVAL,
      },
    });

    // Run the enhanced client with the properly configured testConfig
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