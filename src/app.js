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

// Create a simple raw body parser middleware specifically for the webhook endpoint
const rawBodyParser = (req, res, next) => {
  if (req.headers['content-type'] !== 'application/json') {
    return res.status(415).json({ error: 'Unsupported Media Type. Only application/json is supported.' });
  }
  
  let data = '';
  req.setEncoding('utf8');
  
  req.on('data', (chunk) => {
    data += chunk;
  });
  
  req.on('end', () => {
    // Store the raw body for signature verification
    req.rawBody = data;
    
    // Parse JSON for convenience
    try {
      req.body = JSON.parse(data);
      next();
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON payload' });
    }
  });
};

// Apply middleware based on route
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    rawBodyParser(req, res, next);
  } else {
    express.json()(req, res, next);
  }
});

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
      hasAuthorization: !!req.headers["authorization"],
      bodyKeys: Object.keys(req.body || {}),
    };
    
    // Log all headers for debugging (with sensitive values redacted)
    const redactedHeaders = {};
    Object.keys(req.headers).forEach((key) => {
      if (key.toLowerCase() === 'authorization' && req.headers[key]) {
        // Only show the first few characters of the token
        const authValue = req.headers[key];
        redactedHeaders[key] = authValue.substring(0, 15) + '...';
      } else if (key.toLowerCase() === 'x-signature' && req.headers[key]) {
        // Only show the first few characters of the signature
        const sigValue = req.headers[key];
        redactedHeaders[key] = sigValue.substring(0, 15) + '...';
      } else {
        redactedHeaders[key] = req.headers[key];
      }
    });
    
    logger.debugWithContext("Webhook request detailed headers", {
      ...logContext,
      detailedHeaders: redactedHeaders,
      authorizationPresent: !!req.headers["authorization"],
      signaturePresent: !!req.headers["x-signature"],
      timestampPresent: !!req.headers["x-timestamp"],
    });

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

      // Check if this is a test environment where we should bypass signature verification
      const isTestEnvironment = process.env.NODE_ENV === 'test' || process.env.BYPASS_WEBHOOK_VERIFICATION === 'true';
      
      // Get the peer public key for signature verification
      try {
        // Get the peer public key from the state manager
        const peerBase64urlJwkPublicKey = stateManager.getPeerBase64urlJwkPublicKey();
        
        // If the peer public key is not available and we're not in test mode, return an error
        if (!peerBase64urlJwkPublicKey && !isTestEnvironment) {
          logger.warnWithContext("Peer public key not available in state manager", logContext);
          
          // In production, we need the key
          if (process.env.NODE_ENV === 'production') {
            logger.errorWithContext("Peer public key not available in production environment", logContext);
            return res.status(500).json({ error: "Peer public key not available" });
          }
          
          // In development or test, we'll continue without the key and skip verification
          logger.infoWithContext("Continuing without peer public key in non-production environment", {
            ...logContext,
            environment: process.env.NODE_ENV || 'development'
          });
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
          
          // The key is already in base64url format and should be decoded directly to bytes
          // No need for double conversion or treating it as hex
          req.peer_bytes_ed25519_public_key = new Uint8Array(
            Buffer.from(peerBase64urlJwkPublicKey, "base64url")
          );
          req.server_bytes_ed25519_public_key = req.peer_bytes_ed25519_public_key;
          req.server_public_key_base64url = peerBase64urlJwkPublicKey;

          logger.debugWithContext("Processed peer public key", {
            ...logContext,
            keyLength: req.peer_bytes_ed25519_public_key.length,
            keyFormat: "base64url_decoded_to_bytes"
          });
          
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
      bodyKeys: Object.keys(req.jsonBody || req.body || {}),
      bodySize: req.jsonBody ? JSON.stringify(req.jsonBody).length : 0,
    };

    try {
      const signature_hex_ofpayload = req.headers["x-signature"];
      const timestamp = req.headers["x-timestamp"];
      
      // Use the raw body that was captured by our middleware
      // This ensures we're verifying the exact same payload that was signed
      const payload = req.rawBody;
      
      // Log the raw payload for debugging
      logger.debug("Webhook payload for verification", {
        ...logContext,
        payload: payload, // Log the full payload for complete visibility
        payloadFirstChars: payload.substring(0, 50) + (payload.length > 50 ? '...' : ''),
        payloadLength: payload.length
      });
      
      // Calculate a hash of the payload for debugging
      const payloadHash = crypto
        .createHash("sha256")
        .update(payload)
        .digest("hex");
      
      // Log the payload hash and signature for debugging
      logger.debug("Webhook payload hash and signature", {
        ...logContext,
        payloadHash: payloadHash,
        payloadWithTimestamp: payload + (req.headers["x-timestamp"] || ''),
        payloadWithTimestampHash: crypto
          .createHash("sha256")
          .update(payload + (req.headers["x-timestamp"] || ''))
          .digest("hex"),
        signature: req.headers["x-signature"],
        timestamp: req.headers["x-timestamp"]
      });
      
      // Log detailed authentication information
      logger.infoWithContext("Webhook authentication details", {
        ...logContext,
        authorizationHeader: req.headers.authorization ? 'Present' : 'Missing',
        signatureHeader: req.headers['x-signature'] ? 'Present' : 'Missing',
        timestampHeader: req.headers['x-timestamp'] ? 'Present' : 'Missing',
        signatureLength: req.headers['x-signature'] ? req.headers['x-signature'].length : 0,
        timestampValue: req.headers['x-timestamp'],
        requestPath: req.path,
        requestMethod: req.method,
        requestProtocol: req.protocol,
        requestHostname: req.hostname,
        requestIp: req.ip,
        requestOriginalUrl: req.originalUrl
      });
      
      // Update log context with body info
      if (Array.isArray(req.body)) {
        logContext.bodyIsArray = true;
        logContext.bodyLength = req.body.length;
      } else {
        logContext.bodyIsArray = false;
        logContext.bodyKeys = Object.keys(req.body || {});
      }
      
      logContext.bodySize = payload.length;
      
      logger.debug("Webhook payload for verification", {
        ...logContext,
        payloadFirstChars: payload.substring(0, 50) + '...',
        payloadLength: payload.length
      });

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

      // Log detailed information about the public key used for verification
      logger.infoWithContext("Webhook verification key information", {
        ...logContext,
        publicKeyHex: Buffer.from(req.server_bytes_ed25519_public_key).toString('hex'),
        publicKeyBase64: Buffer.from(req.server_bytes_ed25519_public_key).toString('base64'),
        keyLength: req.server_bytes_ed25519_public_key.length
      });
      
      // Authenticate the webhook using the server's public key
      logger.debugWithContext("Authenticating webhook", logContext);
      // Use the base64url encoded key directly for authentication
      const publicKeyBase64url = req.server_public_key_base64url;
      
      const authResult = await authenticate_webhook(
        payload,
        signature_hex_ofpayload,
        timestamp,
        publicKeyBase64url
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