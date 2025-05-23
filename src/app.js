// app.js
const config = require("config");
const express = require("express");
const bodyParser = require("body-parser");
const logger = require("../config/logger");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const stateManager = require("./blockchain/statemanager");
const { authenticate_webhook } = require("./auth/authentication");

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
      headers: Object.keys(req.headers),
      hasSignature: !!req.headers["x-signature"],
      hasTimestamp: !!req.headers["x-timestamp"],
      bodyKeys: Object.keys(req.body || {}),
    };

    try {
      // Log webhook receipt
      logger.infoWithContext("Webhook received", {
        ...logContext,
        contentType: req.headers["content-type"],
        contentLength: req.headers["content-length"],
      });

      // Get the own_rodit configuration
      const roditConfig = await stateManager.getConfigOwnRodit();
      if (!roditConfig || !roditConfig.own_rodit) {
        logger.errorWithContext(
          "Own RODiT configuration not available",
          logContext
        );
        return res.status(500).json({ error: "Server configuration error" });
      }

      // Get the peer public key for signature verification
      try {
        // Get the peer public key from the state manager
        const peerBase64urlJwkPublicKey = stateManager.getPeerBase64urlJwkPublicKey();
        
        if (!peerBase64urlJwkPublicKey) {
          logger.errorWithContext("Peer public key not available in state manager", logContext);
          return res.status(500).json({ error: "Peer public key not available" });
        }
        
        // Log that we're using the peer public key
        logger.infoWithContext("Using peer public key from state manager", {
          ...logContext,
          keyFormat: "JWK",
          keyFound: true
        });
        
        // Convert the JWK public key to the raw bytes format needed for verification
        // This follows the pattern used elsewhere in the codebase
        try {
          // Based on our code analysis, we know that peerBase64urlJwkPublicKey is actually a hex value
          // converted to base64url, not a JWK. It's stored this way in stateManager by roditmanager.js.
          // So we need to handle it correctly here.
          
          logger.debugWithContext("Processing peer public key", {
            ...logContext,
            keyLength: peerBase64urlJwkPublicKey ? peerBase64urlJwkPublicKey.length : 0,
            keyFormat: "base64url_encoded_hex"
          });
          
          // Decode the base64url to get the original hex string
          const decodedBuffer = Buffer.from(peerBase64urlJwkPublicKey, 'base64url');
          
          // Use the decoded buffer directly as the public key
          req.peer_bytes_ed25519_public_key = new Uint8Array(decodedBuffer);
          req.server_bytes_ed25519_public_key = req.peer_bytes_ed25519_public_key;
          
          logContext.peerKeySet = true;
          logContext.serverKeySet = true;
          logContext.keySource = "hex_from_base64url";
          
          logger.infoWithContext(
            "Successfully processed peer public key for webhook authentication",
            {
              ...logContext,
              keyLength: decodedBuffer.length
            }
          );
          
          next();
          return;
        } catch (jwkError) {
          logger.errorWithContext("Error converting JWK peer public key", {
            ...logContext,
            error: jwkError.message
          });
          return res.status(500).json({ error: "Error processing peer public key" });
        }
      } catch (error) {
        logger.errorWithContext("Error extracting server public key", {
          ...logContext,
          error: error.message,
          stack: error.stack,
        });
        return res.status(500).json({ error: "Server configuration error" });
      }
    } catch (error) {
      logger.errorWithContext(
        "Error processing webhook request",
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
      headers: Object.keys(req.headers),
      bodyKeys: Object.keys(req.body || {}),
    };

    try {
      const signature_hex_ofpayload = req.headers["x-signature"];
      const timestamp = req.headers["x-timestamp"];
      const payload = JSON.stringify(req.body);

      logContext.hasSignature = !!signature_hex_ofpayload;
      logContext.hasTimestamp = !!timestamp;
      
      // Log more details about the webhook
      logger.infoWithContext("Processing webhook authentication", {
        ...logContext,
        signatureLength: signature_hex_ofpayload ? signature_hex_ofpayload.length : 0,
        timestampValue: timestamp,
        payloadSize: payload.length,
        hasServerKey: !!req.server_bytes_ed25519_public_key
      });

      // Authenticate the webhook using the server's public key
      logger.debugWithContext("Authenticating webhook", logContext);
      const authResult = authenticate_webhook(
        payload,
        signature_hex_ofpayload,
        timestamp,
        req.server_bytes_ed25519_public_key
      );

      if (!authResult.isValid) {
        logContext.authError = authResult.error?.message;
        logger.warnWithContext("Invalid webhook signature", {
          ...logContext,
          error: authResult.error?.message,
          code: authResult.error?.code || 'UNKNOWN_ERROR'
        });
        return res.status(401).json({ 
          error: "Invalid webhook signature", 
          message: authResult.error?.message,
          code: authResult.error?.code || 'INVALID_SIGNATURE'
        });
      }

      logger.infoWithContext("Webhook authenticated successfully", {
        ...logContext,
        authDuration: authResult.duration,
        component: "WebhookReceiver"
      });

      // Extract and log the webhook payload details
      try {
        // Check if the body is valid before attempting to destructure
        if (!req.body || typeof req.body !== 'object') {
          logger.errorWithContext("Invalid webhook payload format", {
            ...logContext,
            component: "WebhookReceiver",
            bodyType: typeof req.body,
            bodyIsNull: req.body === null,
            contentType: req.headers['content-type']
          });
          return res.status(400).json({ error: "Invalid payload format" });
        }
        
        const { event, data, isError, timestamp: payloadTimestamp, requestId: payloadRequestId } = req.body;
        
        logger.infoWithContext("Processing webhook payload", {
          ...logContext,
          component: "WebhookReceiver",
          event,
          isError,
          payloadTimestamp,
          payloadRequestId,
          dataKeys: data ? Object.keys(data) : [],
          dataType: typeof data,
          dataSize: data ? JSON.stringify(data).length : 0,
          isTest: data && data.test_id ? true : false,
          testId: data && data.test_id ? data.test_id : null
        });

        // Additional logging for specific event types
        if (event && event.includes('comment_')) {
          logger.infoWithContext(`Webhook event: ${event}`, {
            ...logContext,
            component: "WebhookReceiver",
            commentId: data && data.id ? data.id : null,
            commentTitle: data && data.title ? data.title : null,
            commentCount: data && data.count ? data.count : null,
            webhookEvent: event
          });
        }
      } catch (payloadError) {
        logger.warnWithContext("Error processing webhook payload", {
          ...logContext,
          component: "WebhookReceiver",
          error: payloadError.message,
          stack: payloadError.stack
        });
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

        // New cases for CRUD events
        case "comment_created":
          logger.infoWithContext("Comment created webhook received", {
            ...logContext,
            commentId: data.id,
            title: data.title,
            isTest: !!data.test_id
          });
          res.status(200).json({ success: true, message: "Comment creation acknowledged" });
          break;
          
        case "comment_updated":
          logger.infoWithContext("Comment updated webhook received", {
            ...logContext,
            commentId: data.id,
            title: data.title,
            isTest: !!data.test_id
          });
          res.status(200).json({ success: true, message: "Comment update acknowledged" });
          break;
          
        case "comment_deleted":
          logger.infoWithContext("Comment deleted webhook received", {
            ...logContext,
            commentId: data.id,
            isTest: !!data.test_id
          });
          res.status(200).json({ success: true, message: "Comment deletion acknowledged" });
          break;
          
        case "comments_listed":
          logger.infoWithContext("Comments listed webhook received", {
            ...logContext,
            count: data.count,
            isTest: !!data.test_id
          });
          res.status(200).json({ success: true, message: "Comments listing acknowledged" });
          break;
          
        // Error events
        case "create_comment_error":
        case "update_comment_error":
        case "delete_comment_error":
        case "read_comment_error":
          logger.warnWithContext(`Error event received: ${event}`, {
            ...logContext,
            error: data.error,
            commentId: data.id,
            isTest: !!data.test_id
          });
          res.status(200).json({ success: true, message: "Error event acknowledged" });
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

// Add a new endpoint to get all test results
app.get("/api/test/results", (req, res) => {
  try {
    const { getTestExecutionState } = require("./enhanced-client");
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
    logger.errorWithContext(
      "Error retrieving test results",
      {
        endpoint: "/api/test/results",
        method: "GET",
        error: error.message,
      },
      error
    );
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