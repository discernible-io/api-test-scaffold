const config = require("config");
const {
  set_rodit_config,
  get_roditconfig,
  login_and_validate_server,
} = require("./middleware/rodit");

const RODIT_CONFIGURATION_FILE_PATH = config.get(
  "RODIT_CONFIGURATION_FILE_PATH"
);

async function fetchWithErrorHandling(url, options) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error: While fetching: ${error.message}`);
    throw error;
  }
}

async function testCRUDAOperations(apiendpoint, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    console.info("Testing CREATE operation...");
    const createdItem = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/create`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Test Comment",
          description: "This is a test comment",
        }),
      }
    );
    console.info(`Created comment: ${JSON.stringify(createdItem)}`);
    const createdItemId = createdItem.id;

    console.info("Testing READ (single comment) operation...");
    const singleComment = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/read`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId }),
      }
    );
    console.info(`Single comment: ${JSON.stringify(singleComment)}`);

    console.info("Testing UPDATE operation...");
    const updatedComment = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/update`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: createdItemId,
          name: "Updated Test Comment",
          description: "This comment has been updated",
        }),
      }
    );
    console.info(`Updated comment: ${JSON.stringify(updatedComment)}`);

    console.info("Testing DESTROY operation...");
    await fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: createdItemId }),
    });
    console.info("Comment destroyed successfully");

    console.info("Verifying deletion...");
    const remainingItems = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/list`,
      {
        method: "POST",
        headers,
      }
    );
    console.info(`Items after deletion: ${JSON.stringify(remainingItems)}`);

    console.info("CRUD operations test completed successfully");
  } catch (error) {
    console.error(`Error during CRUD operations test: ${error.message}`);
  }
}

async function accessProtectedRouteEcho(apiendpoint, token, echoInput) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  try {
    console.info("Testing ECHO operation...");
    const data = await fetchWithErrorHandling(`${apiendpoint}/api/echo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment",
        description: "This is a test comment",
        message: echoInput,
      }),
    });
    console.info(`Info: Server Response: ${JSON.stringify(data)}`);
  } catch (error) {
    console.error(`Error in ECHO operation: ${error.message}`);
  }
}

async function sampleclient() {
  try {
    const { own_rodit, own_roditid_base64url_signature } =
      await set_rodit_config(RODIT_CONFIGURATION_FILE_PATH);

    const config_own_rodit = await get_roditconfig();
    if (!config_own_rodit) {
      throw new Error("Client configuration not initialized");
    } else {
      const apiendpoint = config_own_rodit.apiendpoint;
      const jwt_token = await login_and_validate_server(
        apiendpoint,
        own_roditid_base64url_signature,
        own_rodit
      );
      if (jwt_token) {
        const echoInput = "Hello, World!";
        await accessProtectedRouteEcho(apiendpoint, jwt_token, echoInput);
        await testCRUDAOperations(apiendpoint, jwt_token);
      } else {
        console.error("Failed to obtain JWT token");
      }  
    }

  } catch (error) {
    console.error(`Sample client function error: ${error.message}`);
  }
}

sampleclient();
