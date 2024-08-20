// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const config = require("config");
const {
  set_rodit_config,
  get_rodit_config,
  login_and_verify_server,
} = require("./middleware/rodit");

const RODIT_CONFIGURATION_FILE_PATH = config.get(
  "RODIT_CONFIGURATION_FILE_PATH"
);

async function fetchWithErrorHandling(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorDetails = response.status !== 204 ? await response.json() : null;
    throw new Error(`Request failed: ${response.statusText}, ${JSON.stringify(errorDetails)}`);
  }
  return response.status !== 204 ? response.json() : null;
}

async function testCRUDAOperations(apiendpoint, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  try {
    // CREATE operations
    console.info("Testing CREATE operation for item 1...");
    const createdItem1 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/create`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Lore Ipsum",
          description: "This is the first test comment",
        }),
      }
    );
    console.info(`Created comment 1: ${JSON.stringify(createdItem1)}`);
    const createdItemId1 = createdItem1.id;

    console.info("Testing CREATE operation for item 2...");
    const createdItem2 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/create`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "I also say Lore Ipsum",
          description: "This is the second test comment",
        }),
      }
    );
    console.info(`Created comment 2: ${JSON.stringify(createdItem2)}`);
    const createdItemId2 = createdItem2.id;

    // READ (list all)
    console.info("Testing READ (list all) operation...");
    let response = await fetch(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers,
    });
    if (!response.ok) throw new Error("Failed to list comments");
    let data = await response.json();
    console.info(`All comments: ${JSON.stringify(data)}`);

    // READ (single comment)
    console.info("Testing READ (single comment) operation for item 1...");
    const singleComment1 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/read`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId1 }),
      }
    );
    console.info(`Single comment 1: ${JSON.stringify(singleComment1)}`);

    console.info("Testing READ (single comment) operation for item 2...");
    const singleComment2 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/read`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ id: createdItemId2 }),
      }
    );
    console.info(`Single comment 2: ${JSON.stringify(singleComment2)}`);

    // UPDATE operations
    console.info("Testing UPDATE operation for item 1...");
    const updatedComment1 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/update`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: createdItemId1,
          name: "Updated Lore Ipsum",
          description: "This comment has been updated",
        }),
      }
    );
    console.info(`Updated comment 1: ${JSON.stringify(updatedComment1)}`);

    console.info("Testing UPDATE operation for item 2...");
    const updatedComment2 = await fetchWithErrorHandling(
      `${apiendpoint}/api/cruda/update`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: createdItemId2,
          name: "Updated I also say Lore Ipsum",
          description: "This comment has been updated",
        }),
      }
    );
    console.info(`Updated comment 2: ${JSON.stringify(updatedComment2)}`);

    // DESTROY operations
    console.info("Testing DESTROY operation for item 1...");
    await fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: createdItemId1 }),
    });
    console.info("Comment 1 destroyed successfully");

    console.info("Testing DESTROY operation for item 2...");
    await fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: createdItemId2 }),
    });
    console.info("Comment 2 destroyed successfully");

    // Verify deletion
    console.info("Verifying deletion...");
    response = await fetch(`${apiendpoint}/api/cruda/list`, {
      method: 'POST',
      headers,
    });
    if (!response.ok) throw new Error('Failed to list comments after deletion');
    data = await response.json();
    console.info(`Items after deletion: ${JSON.stringify(data)}`);

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
    const echoeddata = await fetchWithErrorHandling(
      `${apiendpoint}/api/echo`, 
      {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: "Test Comment",
            description: "This is a test comment",
            message: echoInput
      }),
    });
    console.info(`Info: Server Response: ${JSON.stringify(echoeddata)}`);
  } catch (error) {
    console.error(`Error in ECHO operation: ${error.message}`);
  }
}

async function sampleclient() {

      const publicKeyPem = fs.readFileSync('public_key.pem', 'utf8');

      // Function to verify the certificate
      function verifyServerCertificate(serverCert) {
        const serverPublicKey = serverCert.pubkey;
        const expectedPublicKey = crypto.createPublicKey(publicKeyPem);

        return serverPublicKey.equals(expectedPublicKey.export({ type: 'spki', format: 'der' }));
      }

  try {
    const { own_rodit, own_roditid_base64url_signature } =
      await set_rodit_config(RODIT_CONFIGURATION_FILE_PATH);

    const config_own_rodit = await get_rodit_config();
    if (!config_own_rodit) {
      throw new Error("Client configuration not initialized");
    } else {
      const apiendpoint = config_own_rodit.apiendpoint;
      const jwt_token = await login_and_verify_server(
        apiendpoint,
        own_roditid_base64url_signature,
        own_rodit
      );
      if (jwt_token) {

      const options = {
        hostname: 'example.com',
        port: 443,
        path: '/',
        method: 'GET',
        checkServerIdentity: (hostname, cert) => {
          if (!verifyServerCertificate(cert)) {
            throw new Error('Server certificate public key does not match the pinned public key');
          }
        }
      };

      const req = https.request(options, (res) => {
        console.log('Server authenticated successfully');
        res.on('data', (chunk) => {
          console.log(`Received data: ${chunk}`);
        });
      });

      req.on('error', (error) => {
        console.error('Error:', error.message);
      });

      req.end();

        await accessProtectedRouteEcho(apiendpoint, jwt_token, "Hello, World!");
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
