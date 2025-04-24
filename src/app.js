// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

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

// Configuration constants
const VAULT_RODIT_KEYVALUE_PATH = config.get("VAULT_RODIT_KEYVALUE_PATH");
const WEBHOOKPORT = config.get("WEBHOOKPORT");
const TEST_CLIENT_DURATION = config.get("API_OPTIONS.TEST_CLIENT_DURATION");
const TEST_INTERVAL = config.get("API_OPTIONS.TEST_INTERVAL");

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

      // Process the webhook based on the event type
      /*
      switch (event) {
        case 'user_created':
          // Handle user creation
          break;
        case 'order_placed':
          // Handle order placement
          break;
        // Add more cases as needed
        default:
          logger.warnWithContext(`Unhandled event type: ${event}`, logContext);
      }
      */

      res.sendStatus(200);
    } catch (error) {
      logger.errorWithContext("Error processing webhook", logContext, error);
      res.status(400).json({ error: error.message });
    }
  }
);

async function testCRUDAOperations(apiendpoint) {
  const operationId = crypto.randomUUID();
  const logContext = {
    operationId,
    apiEndpoint: apiendpoint,
    operationType: "CRUDA_TEST",
  };

  const getHeaders = () => ({
    "Content-Type": "application/json",
  });

  let createdItemId1, createdItemId2;

  async function performOperation(operationName, func) {
    const currentContext = {
      ...logContext,
      operation: operationName,
      timestamp: new Date().toISOString(),
    };

    logger.infoWithContext(
      `Testing ${operationName} operation`,
      currentContext
    );

    try {
      const result = await func();

      if (result.error) {
        currentContext.errorType = result.error;
        currentContext.errorMessage = result.message;

        logger.errorWithContext(
          `Error in ${operationName} operation`,
          currentContext
        );

        if (result.error === "RateLimitExceeded") {
          currentContext.retryAfter = result.retryAfter;
          currentContext.maxRequests = result.maxRequests;
          currentContext.windowMinutes = result.windowMinutes;

          logger.infoWithContext(
            `Rate limit exceeded. Try again in ${result.retryAfter} seconds`,
            currentContext
          );
        }
        return null;
      }

      currentContext.resultStatus = "success";
      currentContext.resultId = result.id;

      logger.infoWithContext(
        `${operationName} operation successful`,
        currentContext
      );
      return result;
    } catch (error) {
      currentContext.unexpectedError = true;
      logger.errorWithContext(
        `Unexpected error in ${operationName}`,
        currentContext,
        error
      );
      return null;
    }
  }

  // CREATE operations
  const createdItem1 = await performOperation("CREATE item 1", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        title: "Lore Ipsum",
        content: "This is the first test comment",
      }),
    })
  );
  if (createdItem1) createdItemId1 = createdItem1.id;

  const createdItem2 = await performOperation("CREATE item 2", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        title: "I also say Lore Ipsum",
        content: "This is the second test comment",
      }),
    })
  );
  if (createdItem2) createdItemId2 = createdItem2.id;

  // READ (list all)
  await performOperation("READ (list all)", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  // READ (single comment)
  if (createdItemId1) {
    await performOperation("READ (single comment) item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("READ (single comment) item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // UPDATE operations
  if (createdItemId1) {
    await performOperation("UPDATE item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          id: createdItemId1,
          title: "Updated Lore Ipsum",
          content: "This comment has been updated",
        }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("UPDATE item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          id: createdItemId2,
          title: "Updated I also say Lore Ipsum",
          content: "This comment has been updated",
        }),
      })
    );
  }

  // DESTROY operations
  if (createdItemId1) {
    await performOperation("DESTROY item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("DESTROY item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // Verify deletion
  await performOperation("Verify deletion", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  logger.debugWithContext("CRUD operations test completed", logContext);
}

async function accessProtectedRouteEcho(apiendpoint, echoInput) {
  const operationId = crypto.randomUUID();
  const logContext = {
    operationId,
    apiEndpoint: apiendpoint,
    operation: "ECHO_TEST",
  };

  const headers = {
    "Content-Type": "application/json",
  };

  logger.debugWithContext("Testing ECHO operation", logContext);

  try {
    const result = await fetchWithErrorHandling(`${apiendpoint}/api/echo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment",
        description: "This is a test comment",
        message: echoInput,
      }),
    });

    if (result.error) {
      logContext.errorType = result.error;
      logContext.errorMessage = result.message;

      logger.errorWithContext("ECHO operation failed", logContext);

      if (result.error === "RateLimitExceeded") {
        logContext.retryAfter = result.retryAfter;
        logContext.maxRequests = result.maxRequests;
        logContext.windowMinutes = result.windowMinutes;

        logger.errorWithContext(
          `Rate limit exceeded. Try again in ${result.retryAfter} seconds`,
          logContext
        );
      }
    } else {
      logContext.responseReceived = true;
      logger.debugWithContext("Server responded to ECHO operation", logContext);
    }
  } catch (error) {
    logger.errorWithContext(
      "Unexpected error in ECHO operation",
      logContext,
      error
    );
  }
}

async function runTests(apiendpoint) {
  const testRunId = crypto.randomUUID();
  const logContext = {
    testRunId,
    apiEndpoint: apiendpoint,
    startTime: new Date().toISOString(),
  };

  try {
    logger.infoWithContext("Starting test run", logContext);

    // Run ECHO test
    await accessProtectedRouteEcho(apiendpoint, "Hello, World!");

    // Run CRUDA operations test
    await testCRUDAOperations(apiendpoint);

    logContext.endTime = new Date().toISOString();
    logContext.status = "completed";
    logger.infoWithContext("Test run completed successfully", logContext);
  } catch (error) {
    logContext.endTime = new Date().toISOString();
    logContext.status = "failed";
    logger.errorWithContext("Error during test run", logContext, error);
  }
}

async function sampleclient() {
  const clientId = crypto.randomUUID();
  const logContext = {
    clientId,
    component: "sampleclient",
    startTime: new Date().toISOString(),
  };

  try {
    // Initialize vault using the manager
    logger.infoWithContext("Initializing vault", logContext);
    await roditManager.initializeVault();

    // Initialize RODIT configuration with the "account_client" namespace
    logger.infoWithContext(
      "Initializing RODIT config with 'client' namespace",
      logContext
    );
    await roditManager.initializeRoditConfig("client");

    // Get configuration from state manager
    logger.debugWithContext("Retrieving config from state manager", logContext);
    const config = await stateManager.getConfigOwnRodit();

    if (!config) {
      logger.errorWithContext(
        "Failed to initialize RODiT configuration",
        logContext
      );
      throw new Error("Failed to initialize RODiT configuration");
    }

    logger.infoWithContext("Attempting server login", logContext);
    const loginResult = await login_server(config.own_rodit);

    // Store JWT token in the state manager
    if (loginResult.jwt_token) {
      logger.infoWithContext("JWT token received", {
        ...logContext,
        tokenReceived: true,
        apiEndpoint: loginResult.apiendpoint,
      });

      await stateManager.setJwtToken(loginResult.jwt_token);

      const startTime = Date.now();
      const endTime = startTime + TEST_CLIENT_DURATION;

      const testContext = {
        ...logContext,
        testDuration: TEST_CLIENT_DURATION / 1000,
        testInterval: TEST_INTERVAL / 1000,
        plannedEndTime: new Date(endTime).toISOString(),
      };

      logger.infoWithContext(
        `Client will run tests for ${TEST_CLIENT_DURATION / 1000} seconds`,
        testContext
      );

      // Run tests in a loop
      let testCount = 0;
      while (Date.now() < endTime) {
        testCount++;
        const iterationContext = {
          ...testContext,
          testIteration: testCount,
          iterationStartTime: new Date().toISOString(),
        };

        logger.infoWithContext(
          `Starting test iteration ${testCount}`,
          iterationContext
        );
        await runTests(loginResult.apiendpoint);

        iterationContext.iterationEndTime = new Date().toISOString();
        logger.infoWithContext(
          `Completed test iteration ${testCount}`,
          iterationContext
        );

        // Wait for the next test interval or until the end time, whichever comes first
        const timeUntilNextTest = Math.min(
          TEST_INTERVAL,
          Math.max(0, endTime - Date.now()) // Ensure we don't get negative values
        );

        if (timeUntilNextTest > 0) {
          logger.debugWithContext(
            `Waiting ${timeUntilNextTest}ms until next test`,
            {
              ...iterationContext,
              nextTestIn: timeUntilNextTest,
            }
          );
          await new Promise((resolve) =>
            setTimeout(resolve, timeUntilNextTest)
          );
        }
      }

      logContext.endTime = new Date().toISOString();
      logContext.totalTests = testCount;
      logContext.status = "completed";
      logger.infoWithContext("Client finished running tests", logContext);
    } else {
      logContext.status = "failed";
      logContext.failureReason = "JWT token not received";
      logger.errorWithContext("Failed to obtain JWT token", logContext);
    }
  } catch (error) {
    logContext.status = "failed";
    logContext.endTime = new Date().toISOString();
    logger.errorWithContext("Sample client function error", logContext, error);
  }
}

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
    // Run the client operations
    await sampleclient();
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
