// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const config = require("config");
const express = require('express');
const bodyParser = require('body-parser');
const {
  set_rodit_config,
  get_rodit_config,
  login_and_verify_server,
} = require("./middleware/rodit");
const logger = require("./config/logger");

const RODIT_CONFIGURATION_FILE_PATH = config.get(
  "RODIT_CONFIGURATION_FILE_PATH"
);

// Set up Express server
const app = express();
app.use(bodyParser.json());

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const { event, data } = req.body;
  logger.info(`Received webhook: ${event}`);
  logger.info('Data:', data);
  res.sendStatus(200);
});

// Client-side functions
async function fetchWithErrorHandling(url, options) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const errorDetails = response.status !== 204 ? await response.json() : null;
      throw new Error(
        `Request failed: ${response.statusText}, ${JSON.stringify(errorDetails)}`
      );
    }
    return response.status !== 204 ? response.json() : null;
  } catch (error) {
    console.error(`Error in fetchWithErrorHandling: ${error.message}`);
    return null;
  }
}

async function testCRUDAOperations(apiendpoint, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let createdItemId1, createdItemId2;

  async function performOperation(operationName, func) {
    try {
      console.info(`Testing ${operationName} operation...`);
      const result = await func();
      console.info(`${operationName} operation result:`, result);
      return result;
    } catch (error) {
      console.error(`Error in ${operationName} operation:`, error.message);
      return null;
    }
  }

  // CREATE operations
  const createdItem1 = await performOperation("CREATE item 1", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment 1",
        description: "This is the first test comment",
      }),
    })
  );
  if (createdItem1) createdItemId1 = createdItem1.id;

  const createdItem2 = await performOperation("CREATE item 2", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment 2",
        description: "This is the second test comment",
      }),
    })
  );
  if (createdItem2) createdItemId2 = createdItem2.id;

  // READ (list all)
  await performOperation("READ (list all)", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers,
    })
  );

  // READ (single comment)
  if (createdItemId1) {
    await performOperation("READ (single comment) item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("READ (single comment) item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // UPDATE operations
  if (createdItemId1) {
    await performOperation("UPDATE item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: createdItemId1,
          name: "Updated Test Comment 1",
          description: "This comment has been updated",
        }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("UPDATE item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: createdItemId2,
          name: "Updated Test Comment 2",
          description: "This comment has been updated",
        }),
      })
    );
  }

  // DESTROY operations
  if (createdItemId1) {
    await performOperation("DESTROY item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("DESTROY item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // Verify deletion
  await performOperation("Verify deletion", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers,
    })
  );

  console.info("CRUD operations test completed");
}

async function accessProtectedRouteEcho(apiendpoint, token, echoInput) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  try {
    console.info("Testing ECHO operation...");
    const echoeddata = await fetchWithErrorHandling(`${apiendpoint}/api/echo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment",
        description: "This is a test comment",
        message: echoInput,
      }),
    });
    if (echoeddata) {
      console.info(`Info: Server Response: ${JSON.stringify(echoeddata)}`);
    }
  } catch (error) {
    console.error(`Error in ECHO operation: ${error.message}`);
  }
}

async function sampleclient() {
  try {
    const { own_rodit, own_roditid_base64url_signature } =
      await set_rodit_config(RODIT_CONFIGURATION_FILE_PATH);

    const config_own_rodit = await get_rodit_config();
    if (!config_own_rodit) {
      console.error("Client configuration not initialized");
      return;
    }

    const apiendpoint = config_own_rodit.apiendpoint;
    const jwt_token = await login_and_verify_server(
      apiendpoint,
      own_roditid_base64url_signature,
      own_rodit
    );
    if (jwt_token) {
      await accessProtectedRouteEcho(apiendpoint, jwt_token, "Hello, World!");
      await testCRUDAOperations(apiendpoint, jwt_token);
    } else {
      console.error("Failed to obtain JWT token");
    }
  } catch (error) {
    console.error(`Sample client function error: ${error.message}`);
  }
}

// Start the server and run the client
const PORT = 3001;
app.listen(PORT, () => {
  logger.info(`Webhook server listening on port ${PORT}`);
  // Run the client operations after the server starts
  sampleclient();
});