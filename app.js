// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const config = require("config");
const express = require("express");
const bodyParser = require("body-parser");
const {
  set_rodit_config,
  get_rodit_config,
  login_server,
  authenticate_webhook,
} = require("./middleware/rodit");
const logger = require("./config/logger");

const {
  initializeAndUnsealVault,
  get_rodit_fromvault,
  get_rodit_fromfile,
  vault,
} = require("./middleware/vaultsetup");
let peer_bytes_ed25519_public_key;
let jwt_token;

// Secrets in File
// const RODIT_CONFIGURATION_FILE_PATH = config.get("RODIT_CONFIGURATION_FILE_PATH");
// Secrets in Vault
const VAULT_RODIT_KEYVALUE_PATH = config.get("VAULT_RODIT_KEYVALUE_PATH");

const WEBHOOKPORT = config.get("WEBHOOKPORT");
const TEST_CLIENT_DURATION = config.get("TEST_CLIENT_DURATION");
const TEST_INTERVAL = config.get("TEST_INTERVAL");

// Set up Express server
const app = express();
app.use(bodyParser.json());

const attachPeerKey = (peer_bytes_ed25519_public_key) => (req, res, next) => {
  req.peer_bytes_ed25519_public_key = peer_bytes_ed25519_public_key;
  next();
};

// Webhook endpoint

// CG: Improvement: Validate incoming headers for the presence of both x-signature and x-timestamp before proceeding with webhook authentication.
const crypto = require("crypto");
const nacl = require("tweetnacl");

app.post(
  "/webhook",
  attachPeerKey(peer_bytes_ed25519_public_key),
  async (req, res) => {
    try {
      const signature_hex_ofpayload = req.headers["x-signature"];
      const timestamp = req.headers["x-timestamp"];
      const payload = JSON.stringify(req.body);

      // Convert hex signature to Uint8Array
      const signature_ofpayload = new Uint8Array(
        Buffer.from(signature_hex_ofpayload, "hex")
      );

      // Authenticate the webhook
      const authResult = authenticate_webhook(
        payload,
        signature_hex_ofpayload,
        timestamp,
        peer_bytes_ed25519_public_key
      );

      if (!authResult.isValid) {
        throw new Error(authResult.error.message);
      }

      // If we've made it here, the signature is valid
      const { event, data, isError } = req.body;
      logger.info(
        `Info: Received authenticated webhook: ${event}, Request ID: ${authResult.requestId}`
      );
      logger.info("Data:", data);

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
        logger.warn(`Unhandled event type: ${event}`);
    }
    */

      res.sendStatus(200);
    } catch (error) {
      logger.error(`Error processing webhook: ${error.message}`);
      res.status(400).json({ error: error.message });
    }
  }
);

// Client-side functions
async function fetchWithErrorHandling(url, options) {
  try {
    // Add the current token to the request headers
    if (jwt_token) {
      options.headers = {
        ...options.headers,
        Authorization: `Bearer ${jwt_token}`,
      };
    }

    const response = await fetch(url, options);

    // Check for a new token in the response headers
    const newToken = response.headers.get("New-Token");
    if (newToken) {
      jwt_token = newToken;
      try {
        const config_own_rodit = await get_rodit_config();
        if (!config_own_rodit) {
          logger.error("Error:  Client configuration not initialized");
          return;
        }
        const { _, peer_rodit } = await validate_jwt_token(
          jwt_token,
          config_own_rodit.own_rodit
        );
      } catch (validationError) {
        throw new Error(
          `Error 139: Server validation failed: ${validationError.message}`
        );
      }
      console.debug("Info: Received an updated JWT token");
    }

    // Parse the response as JSON
    const responseData = await response.json();

    if (!response.ok) {
      // Check if it's a rate limiting error
      if (
        response.status === 429 &&
        responseData.error === "RateLimitExceeded"
      ) {
        const retryAfter = parseInt(
          response.headers.get("Retry-After") || "60",
          10
        );
        return {
          error: "RateLimitExceeded",
          message: responseData.message,
          retryAfter,
          maxRequests: responseData.maxRequests,
          windowMinutes: responseData.windowMinutes,
        };
      }

      // For other errors, throw with details
      throw new Error(
        `Error: Request failed: ${
          response.statusText
        }, Details: ${JSON.stringify(responseData)}`
      );
    }

    return responseData;
  } catch (error) {
    logger.error(`Error: fetchWithErrorHandling: ${error.message}`);

    // If the error is due to JSON parsing (i.e., the response wasn't JSON)
    if (error instanceof SyntaxError && error.message.includes("JSON")) {
      return {
        error: "Error: InvalidResponse",
        message: "The server returned an invalid response",
      };
    }

    return {
      error: "RequestFailed",
      message: error.message,
    };
  }
}

async function testCRUDAOperations(apiendpoint) {
  const getHeaders = () => ({
    "Content-Type": "application/json",
  });

  let createdItemId1, createdItemId2;

  async function performOperation(operationName, func) {
    console.info(`Info: Testing ${operationName} operation...`);
    const result = await func();
    if (result.error) {
      logger.error(`Error in ${operationName} operation:`, result.message);
      if (result.error === "RateLimitExceeded") {
        logger.info(
          `Rate limit exceeded. Try again in ${result.retryAfter} seconds.`
        );
        logger.info(
          `Limit: ${result.maxRequests} requests per ${result.windowMinutes} minutes.`
        );
      }
      return null;
    }
    console.info(`Info: ${operationName} operation result:`, result);
    return result;
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

  console.debug("Info: CRUD operations test completed");
}

async function accessProtectedRouteEcho(apiendpoint, echoInput) {
  const headers = {
    "Content-Type": "application/json",
  };
  console.debug("Info: Testing ECHO operation...");
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
    logger.error(`Error: ECHO operation: ${result.message}`);
    if (result.error === "RateLimitExceeded") {
      logger.error(
        `Error: Rate limit exceeded. Try again in ${result.retryAfter} seconds.`
      );
      logger.error(
        `Error: Limit: ${result.maxRequests} requests per ${result.windowMinutes} minutes.`
      );
    }
  } else {
    console.debug(`Info: Server Response: ${JSON.stringify(result)}`);
  }
}

async function runTests(apiendpoint) {
  try {
    logger.info("Info: Starting test run...");

    // Run ECHO test
    await accessProtectedRouteEcho(apiendpoint, "Hello, World!");

    // Run CRUDA operations test
    await testCRUDAOperations(apiendpoint);

    logger.info("Info: Test run completed successfully.");
  } catch (error) {
    logger.error(`Error during test run: ${error.message}`);
  }
}

async function sampleclient() {
  try {
    // Initialize and unseal Vault
    await initializeAndUnsealVault();

    const { own_rodit_hex_accountid, own_string_private_key } =
      await get_rodit_fromvault(vault, VAULT_RODIT_KEYVALUE_PATH);
    await set_rodit_config(own_rodit_hex_accountid, own_string_private_key);

    const config_own_rodit = await get_rodit_config();
    console.debug(`own_rodit: `, own_rodit);
    const loginResult = await login_server(config_own_rodit.own_rodit);
    jwt_token = loginResult.jwt_token; // Update the global jwt_token

    if (jwt_token) {
      const startTime = Date.now();
      const endTime = startTime + TEST_CLIENT_DURATION;

      logger.info(
        `Info: Client will run tests for ${TEST_CLIENT_DURATION / 1000} seconds`
      );
      logger.info(`Info: Tests will run every ${TEST_INTERVAL / 1000} seconds`);

      // Run tests in a loop
      while (Date.now() < endTime) {
        await runTests(loginResult.apiendpoint);

        // Wait for the next test interval or until the end time, whichever comes first
        const timeUntilNextTest = Math.min(TEST_INTERVAL, endTime - Date.now());
        await new Promise((resolve) => setTimeout(resolve, timeUntilNextTest));
      }

      logger.info("Info: Client finished running tests");
    } else {
      logger.error("Error: Failed to obtain JWT token");
    }
  } catch (error) {
    logger.error(`Error: Sample client function error: ${error.message}`);
  }
}

// Start the server and run the client
app.listen(WEBHOOKPORT, async () => {
  console.info(`Webhook server listening on port ${WEBHOOKPORT}`);

  try {
    // Run the client operations
    await sampleclient();
    console.info("Server ready to accept webhook requests");
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
});

process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
