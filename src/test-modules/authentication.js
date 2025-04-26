// refactored-authentication-tests.js
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { ulid } = require("ulid");
const { stateManager } = require("../middleware/rodit");
const logger = require("../../config/logger");

// Helper function to capture test data - kept similar but simplified
function captureTestData(testName, moduleName, result, testData) {
  // Create consistent result format with test info
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || "unknown",
  };

  // Only capture extended data on failure
  if (!result.success) {
    // Create unique ID for this failure
    const correlationId = ulid();
    
    // Add failure info
    result.testInfo.correlationId = correlationId;
    
    // Log with consistent identifiers
    logger.error(`Test '${testName}' failed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint,
      correlationId,
      error: result.error,
    });

    // Log detailed failure data
    logger.info(`Test failure details`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint,
      correlationId,
      failureData: JSON.stringify({
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      }),
    });

    // Add metric for test failure
    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    // Log successful test
    logger.debug(`Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint,
    });

    // Add metric for test success
    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
    });
  }

  return result;
}

/**
 * Modified authentication test module that uses fetch directly
 */
const authenticationTests = {
  /**
   * Test login endpoint with valid and invalid credentials
   */
  testLoginEndpoint: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testLoginEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/login`;
    
    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Prepare valid login credentials
      const timestamp = Math.floor(Date.now() / 1000);
      const config = await stateManager.getConfigOwnRodit();

      if (!config || !config.own_rodit || !config.own_rodit_bytes_private_key) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Generate signature for authentication
      const roditid = config.own_rodit.token_id;
      const timeString = new Date(timestamp * 1000).toISOString();
      const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);
      const bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config.own_rodit_bytes_private_key
      );
      const roditid_base64url_signature = Buffer.from(bytes_signature).toString("base64url");

      // Update test data
      testData.timestamp = timestamp;
      testData.roditid = roditid;

      // Log test phase - testing valid login
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_login_test",
      });

      // Test with valid credentials - USING DIRECT FETCH
      const validLoginResponse = await fetch(`${apiEndpoint}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature,
        }),
      });

      // Get raw response status and body
      const validLoginStatus = validLoginResponse.status;
      const validLoginData = await validLoginResponse.json();
      
      testData.validLoginStatus = validLoginStatus;
      testData.validLoginData = validLoginData;

      if (!validLoginResponse.ok || !validLoginData.token) {
        const result = {
          success: false,
          error: validLoginData.error 
            ? `Valid login failed with status ${validLoginStatus}: ${validLoginData.error}`
            : `Valid login failed with status ${validLoginStatus}: No token received`,
          details: { 
            status: validLoginStatus,
            response: validLoginData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the token for future tests
      await stateManager.setJwtToken(validLoginData.token);

      // Log test phase - testing missing credentials
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "missing_credentials_test",
      });

      // Test with missing credentials - USING DIRECT FETCH
      const missingCredsResponse = await fetch(`${apiEndpoint}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          // Missing required fields
          timestamp,
        }),
      });

      // Get raw response status and body
      const missingCredsStatus = missingCredsResponse.status;
      let missingCredsData;
      try {
        missingCredsData = await missingCredsResponse.json();
      } catch (e) {
        missingCredsData = { parseError: e.message };
      }
      
      testData.missingCredsStatus = missingCredsStatus;
      testData.missingCredsData = missingCredsData;

      // This should fail with a 400-level error
      if (missingCredsStatus < 400) {
        const result = {
          success: false,
          error: `System did not reject missing credentials as expected. Got status ${missingCredsStatus}`,
          details: { 
            status: missingCredsStatus,
            response: missingCredsData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - testing invalid signature
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_signature_test",
      });

      // Create an invalid signature by changing a character
      const invalid_signature =
        roditid_base64url_signature.substring(0, roditid_base64url_signature.length - 5) +
        (roditid_base64url_signature.charAt(roditid_base64url_signature.length - 5) === "A"
          ? "B"
          : "A") +
        roditid_base64url_signature.substring(roditid_base64url_signature.length - 4);

      // Test with invalid signature - USING DIRECT FETCH
      const invalidSigResponse = await fetch(`${apiEndpoint}/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature: invalid_signature,
        }),
      });

      // Get raw response status and body
      const invalidSigStatus = invalidSigResponse.status;
      let invalidSigData;
      try {
        invalidSigData = await invalidSigResponse.json();
      } catch (e) {
        invalidSigData = { parseError: e.message };
      }
      
      testData.invalidSigStatus = invalidSigStatus;
      testData.invalidSigData = invalidSigData;

      // This should fail with a 401 error about invalid signature
      if (invalidSigStatus < 400) {
        const result = {
          success: false,
          error: `System did not reject invalid signature as expected. Got status ${invalidSigStatus}`,
          details: { 
            status: invalidSigStatus,
            response: invalidSigData
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      const result = {
        success: true,
        details: {
          validLoginSuccessful: true,
          validLoginStatus,
          missingCredentialsRejected: missingCredsStatus >= 400,
          missingCredentialsStatus: missingCredsStatus,
          invalidSignatureRejected: invalidSigStatus >= 400,
          invalidSignatureStatus: invalidSigStatus,
          token: validLoginData.token?.substring(0, 10) + "...", // Show just a preview of the token
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test authenticated API access using the authentication middleware
   */
  testAuthenticatedAccess: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testAuthenticatedAccess";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/echo`;
    
    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get stored JWT token
    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    // Update test data
    testData.token = token;

    // Log test phase - valid token access
    logger.info("Test phase", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "valid_token_access",
    });

    try {
      // Test accessing a protected endpoint with valid token - USING DIRECT FETCH
      const validAccessResponse = await fetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          message: "Testing authentication middleware",
        }),
      });

      // Get raw response status and body
      const validAccessStatus = validAccessResponse.status;
      let validAccessData;
      try {
        validAccessData = await validAccessResponse.json();
      } catch (e) {
        validAccessData = { parseError: e.message };
      }
      
      testData.validAccessStatus = validAccessStatus;
      testData.validAccessData = validAccessData;

      if (!validAccessResponse.ok) {
        const result = {
          success: false,
          error: `Protected endpoint access failed with status ${validAccessStatus}`,
          details: { 
            status: validAccessStatus,
            response: validAccessData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for token renewal
      const newToken = validAccessResponse.headers.get("New-Token");
      if (newToken) {
        // Store the new token
        await stateManager.setJwtToken(newToken);
        logger.debug("New token received and stored during authenticated access test", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
        });
      }

      // Log test phase - no token access
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "no_token_access",
      });

      // Test accessing a protected endpoint without a token - USING DIRECT FETCH
      const noTokenResponse = await fetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          // No Authorization header
        },
        body: JSON.stringify({ message: "Testing without token" }),
      });

      // Get raw response status and body
      const noTokenStatus = noTokenResponse.status;
      let noTokenData;
      try {
        noTokenData = await noTokenResponse.json();
      } catch (e) {
        noTokenData = { parseError: e.message };
      }
      
      testData.noTokenStatus = noTokenStatus;
      testData.noTokenData = noTokenData;

      // This should fail with a 401 error
      if (noTokenStatus < 400) {
        const result = {
          success: false,
          error: `System did not reject unauthorized access as expected. Got status ${noTokenStatus}`,
          details: { 
            status: noTokenStatus,
            response: noTokenData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - invalid token access
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_token_access",
      });

      // Test with an invalid token - USING DIRECT FETCH
      const invalidToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkludmFsaWQgVG9rZW4iLCJpYXQiOjE1MTYyMzkwMjJ9.invalid_signature";

      const invalidTokenResponse = await fetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${invalidToken}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({ message: "Testing with invalid token" }),
      });

      // Get raw response status and body
      const invalidTokenStatus = invalidTokenResponse.status;
      let invalidTokenData;
      try {
        invalidTokenData = await invalidTokenResponse.json();
      } catch (e) {
        invalidTokenData = { parseError: e.message };
      }
      
      testData.invalidTokenStatus = invalidTokenStatus;
      testData.invalidTokenData = invalidTokenData;

      // This should fail with a 401/403 error
      if (invalidTokenStatus < 400) {
        const result = {
          success: false,
          error: `System did not reject invalid token as expected. Got status ${invalidTokenStatus}`,
          details: { 
            status: invalidTokenStatus,
            response: invalidTokenData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      const result = {
        success: true,
        details: {
          validTokenAccessSuccessful: validAccessStatus >= 200 && validAccessStatus < 300,
          validTokenStatus: validAccessStatus,
          noTokenAccessRejected: noTokenStatus >= 400,
          noTokenStatus: noTokenStatus,
          invalidTokenRejected: invalidTokenStatus >= 400,
          invalidTokenStatus: invalidTokenStatus,
          tokenRenewed: !!newToken,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test CRUDA API with authentication
   */
  testCrudaOperations: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testCrudaOperations";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/cruda`; // Base endpoint for CRUDA operations

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get stored JWT token
    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    // Update test data
    testData.token = token;

    try {
      // Log test phase - CREATE
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "create_operation",
      });

      // Test CREATE operation - USING DIRECT FETCH
      const createResponse = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          title: "Test Comment",
          content: "This is a test comment created by the authentication test suite.",
        }),
      });

      // Get raw response status and body
      const createStatus = createResponse.status;
      let createData;
      try {
        createData = await createResponse.json();
      } catch (e) {
        createData = { parseError: e.message };
      }
      
      testData.createStatus = createStatus;
      testData.createData = createData;

      // Check for new token in response headers
      const createNewToken = createResponse.headers.get("New-Token");
      if (createNewToken) {
        await stateManager.setJwtToken(createNewToken);
      }

      if (!createResponse.ok || !createData.id) {
        const result = {
          success: false,
          error: `Create operation failed with status ${createStatus}`,
          details: { 
            status: createStatus,
            response: createData 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const createdId = createData.id;
      testData.createdId = createdId;

      // Log test phase - READ
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "read_operation",
      });

      // Test READ operation - USING DIRECT FETCH
      const readResponse = await fetch(`${apiEndpoint}/api/cruda/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({ id: createdId }),
      });

      // Get raw response status and body
      const readStatus = readResponse.status;
      let readData;
      try {
        readData = await readResponse.json();
      } catch (e) {
        readData = { parseError: e.message };
      }
      
      testData.readStatus = readStatus;
      testData.readData = readData;

      // Check for new token in response headers
      const readNewToken = readResponse.headers.get("New-Token");
      if (readNewToken) {
        await stateManager.setJwtToken(readNewToken);
      }

      if (!readResponse.ok || !readData.id || readData.id !== createdId) {
        const result = {
          success: false,
          error: `Read operation failed with status ${readStatus}`,
          details: { 
            status: readStatus,
            response: readData,
            expectedId: createdId 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - UPDATE
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "update_operation",
      });

      // Test UPDATE operation - USING DIRECT FETCH
      const updateResponse = await fetch(`${apiEndpoint}/api/cruda/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          id: createdId,
          title: "Updated Test Comment",
          content: "This comment was updated by the authentication test suite.",
        }),
      });

      // Get raw response status and body
      const updateStatus = updateResponse.status;
      let updateData;
      try {
        updateData = await updateResponse.json();
      } catch (e) {
        updateData = { parseError: e.message };
      }
      
      testData.updateStatus = updateStatus;
      testData.updateData = updateData;

      // Check for new token in response headers
      const updateNewToken = updateResponse.headers.get("New-Token");
      if (updateNewToken) {
        await stateManager.setJwtToken(updateNewToken);
      }

      if (!updateResponse.ok || !updateData.id || updateData.id !== createdId) {
        const result = {
          success: false,
          error: `Update operation failed with status ${updateStatus}`,
          details: { 
            status: updateStatus,
            response: updateData,
            expectedId: createdId 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - LIST
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "list_operation",
      });

      // Test LIST operation - USING DIRECT FETCH
      const listResponse = await fetch(`${apiEndpoint}/api/cruda/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({}),
      });

      // Get raw response status and body
      const listStatus = listResponse.status;
      let listData;
      try {
        listData = await listResponse.json();
      } catch (e) {
        listData = { parseError: e.message };
      }
      
      testData.listStatus = listStatus;
      testData.listData = listData;

      // Check for new token in response headers
      const listNewToken = listResponse.headers.get("New-Token");
      if (listNewToken) {
        await stateManager.setJwtToken(listNewToken);
      }

      if (!listResponse.ok || !listData.comments) {
        const result = {
          success: false,
          error: `List operation failed with status ${listStatus}`,
          details: { 
            status: listStatus,
            response: listData
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if our created comment is in the list
      const foundInList = listData.comments.some((comment) => comment.id === createdId);
      if (!foundInList) {
        const result = {
          success: false,
          error: "Created comment not found in list results",
          details: { 
            listData,
            createdId 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - DESTROY
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "destroy_operation",
      });

      // Test DESTROY operation - USING DIRECT FETCH
      const destroyResponse = await fetch(`${apiEndpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({ id: createdId }),
      });

      // Get raw response status and body
      const destroyStatus = destroyResponse.status;
      let destroyData;
      try {
        destroyData = await destroyResponse.json();
      } catch (e) {
        destroyData = { parseError: e.message };
      }
      
      testData.destroyStatus = destroyStatus;
      testData.destroyData = destroyData;

      // Check for new token in response headers
      const destroyNewToken = destroyResponse.headers.get("New-Token");
      if (destroyNewToken) {
        await stateManager.setJwtToken(destroyNewToken);
      }

      if (!destroyResponse.ok || !destroyData.deletedComment || destroyData.deletedComment.id !== createdId) {
        const result = {
          success: false,
          error: `Destroy operation failed with status ${destroyStatus}`,
          details: { 
            status: destroyStatus,
            response: destroyData,
            expectedId: createdId 
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      const result = {
        success: true,
        details: {
          createSuccessful: createStatus >= 200 && createStatus < 300,
          createStatus,
          readSuccessful: readStatus >= 200 && readStatus < 300,
          readStatus,
          updateSuccessful: updateStatus >= 200 && updateStatus < 300,
          updateStatus,
          listSuccessful: listStatus >= 200 && listStatus < 300,
          listStatus,
          destroySuccessful: destroyStatus >= 200 && destroyStatus < 300,
          destroyStatus,
          itemId: createdId,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test token renewal by checking for New-Token header
   */
  testTokenRenewal: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testTokenRenewal";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/echo`;

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get stored JWT token
    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    // Update test data
    testData.token = token;

    try {
      // USING DIRECT FETCH - with timestamp to potentially trigger token renewal
      const response = await fetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": correlationId,
          // Add a timestamp to help trigger token renewal
          "X-Timestamp": Math.floor(Date.now() / 1000).toString(),
        },
        body: JSON.stringify({ message: "Testing token renewal" }),
      });

      // Get raw response status
      const responseStatus = response.status;
      testData.responseStatus = responseStatus;
      
      // Check for renewal token in headers
      const newToken = response.headers.get("New-Token");
      testData.newTokenReceived = !!newToken;

      // Get raw response body
      let responseData;
      try {
        responseData = await response.json();
      } catch (e) {
        responseData = { parseError: e.message };
      }
      testData.responseData = responseData;

      if (!response.ok) {
        const result = {
          success: false,
          error: `Request failed with status ${responseStatus}`,
          details: { 
            status: responseStatus,
            response: responseData
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the new token if we got one
      if (newToken) {
        await stateManager.setJwtToken(newToken);

        // Log token renewal
        logger.info("Token renewal detected", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "token_renewed",
        });
      } else {
        // If we didn't get a new token, that's okay - it may not have needed renewal
        logger.info("No token renewal needed", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "no_renewal_needed",
        });
      }

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      const result = {
        success: true,
        details: {
          requestSuccessful: true,
          responseStatus,
          tokenRenewalChecked: true,
          tokenRenewed: !!newToken,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = authenticationTests;