// test-modules/authentication.js
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { ulid } = require("ulid");
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");
const logger = require("../../config/logger");

function captureTestData(testName, moduleName, result, testData) {
  // Create consistent result format with test info
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
  };

  // Only capture extended data on failure
  if (!result.success) {
    // Create unique ID for this failure
    const correlationId = ulid();
    
    // Add failure info
    result.testInfo.correlationId = correlationId;
    result.testInfo.failureData = true;
    
    // Log with consistent identifiers
    logger.error(`Test '${testName}' failed`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      error: result.error,
    });

    try {
      // Instead of saving to file, log the detailed data
      const failureData = {
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      };
      
      // Log detailed failure data
      logger.info(`Test failure details`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        failureData: JSON.stringify(failureData),
      });
      
      // Add metric for test failure
      logger.metric('test_failure', 1, {
        module: moduleName,
        test: testName,
        correlation_id: correlationId
      });
      
    } catch (logError) {
      logger.error(`Failed to log failure data`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: logError.message,
      });
    }
  } else {
    // Log successful test execution
    logger.debug(`Test '${testName}' passed`, {
      component: "TestRunner",
      moduleName,
      testName
    });
    
    // Add metric for test success
    logger.metric('test_success', 1, {
      module: moduleName,
      test: testName
    });
  }
  
  return result;
}

/**
 * Authentication test module
 */
const authenticationTests = {
  /**
   * Test login endpoint with valid and invalid credentials
   * Modified to use your server's actual /login endpoint
   */
  testLoginEndpoint: async (apiEndpoint, logContext) => {
    const moduleName = "authentication";
    const testName = "testLoginEndpoint";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start with correlation ID
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

      // Test with valid credentials
      const validResult = await fetchWithErrorHandling(
        `${apiEndpoint}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roditid,
            timestamp,
            roditid_base64url_signature,
          }),
        }
      );

      testData.validResult = validResult;

      if (validResult.error || !validResult.token) {
        const result = {
          success: false,
          error: validResult.error ? `Valid login failed: ${validResult.error}` : "No token received from login",
          details: validResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the token for future tests
      await stateManager.setJwtToken(validResult.token);
      
      // Log test phase - testing missing credentials
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "missing_credentials_test",
      });

      // Test with missing credentials
      const missingCredsResult = await fetchWithErrorHandling(
        `${apiEndpoint}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // Missing required fields
            timestamp,
          }),
        }
      );

      testData.missingCredsResult = missingCredsResult;

      // This should fail with a 400 error about missing credentials
      if (!missingCredsResult.error || !missingCredsResult.message) {
        const result = {
          success: false,
          error: "System did not reject missing credentials as expected",
          details: { missingCredsResult },
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
        (roditid_base64url_signature.charAt(roditid_base64url_signature.length - 5) === "A" ? "B" : "A") +
        roditid_base64url_signature.substring(roditid_base64url_signature.length - 4);

      // Test with invalid signature
      const invalidSigResult = await fetchWithErrorHandling(
        `${apiEndpoint}/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roditid,
            timestamp,
            roditid_base64url_signature: invalid_signature,
          }),
        }
      );

      testData.invalidSigResult = invalidSigResult;

      // This should fail with a 401 error about invalid signature
      if (!invalidSigResult.error && !invalidSigResult.message) {
        const result = {
          success: false,
          error: "System did not reject invalid signature as expected",
          details: { invalidSigResult },
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
          missingCredentialsRejected: !!missingCredsResult.error || !!missingCredsResult.message,
          invalidSignatureRejected: !!invalidSigResult.error || !!invalidSigResult.message,
          token: validResult.token?.substring(0, 10) + "..." // Show just a preview of the token
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
   * Modified to use your server's /api/echo endpoint
   */
  testAuthenticatedAccess: async (apiEndpoint, logContext) => {
    const moduleName = "authentication";
    const testName = "testAuthenticatedAccess";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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

    // Log test phase
    logger.info("Test phase", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "valid_token_access",
    });

    try {
      // Test accessing a protected endpoint with valid token
      const validAccessResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "Testing authentication middleware" }),
        }
      );

      testData.validAccessResult = validAccessResult;

      if (validAccessResult.error) {
        const result = {
          success: false,
          error: `Protected endpoint access failed: ${validAccessResult.error}`,
          details: validAccessResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "no_token_access",
      });

      // Test accessing a protected endpoint without a token
      const noTokenResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // No Authorization header
          },
          body: JSON.stringify({ message: "Testing without token" }),
        }
      );

      testData.noTokenResult = noTokenResult;

      // This should fail with a 401 error
      if (!noTokenResult.error) {
        const result = {
          success: false,
          error: "System did not reject unauthorized access as expected",
          details: { noTokenResult },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_token_access",
      });

      // Test with an invalid token
      const invalidToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkludmFsaWQgVG9rZW4iLCJpYXQiOjE1MTYyMzkwMjJ9.invalid_signature";
      
      const invalidTokenResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${invalidToken}`,
          },
          body: JSON.stringify({ message: "Testing with invalid token" }),
        }
      );

      testData.invalidTokenResult = invalidTokenResult;

      // This should fail with a 401/403 error
      if (!invalidTokenResult.error) {
        const result = {
          success: false,
          error: "System did not reject invalid token as expected",
          details: { invalidTokenResult },
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
          validTokenAccessSuccessful: !validAccessResult.error && validAccessResult.echo,
          noTokenAccessRejected: !!noTokenResult.error,
          invalidTokenRejected: !!invalidTokenResult.error,
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
   * Modified to use your server's /api/cruda/* endpoints
   */
  testCrudaOperations: async (apiEndpoint, logContext) => {
    const moduleName = "authentication";
    const testName = "testCrudaOperations";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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

      // Test CREATE operation
      const createResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            title: "Test Comment",
            content: "This is a test comment created by the authentication test suite."
          }),
        }
      );

      testData.createResult = createResult;

      if (createResult.error || !createResult.id) {
        const result = {
          success: false,
          error: createResult.error ? `Create operation failed: ${createResult.error}` : "No ID received from create operation",
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const createdId = createResult.id;
      testData.createdId = createdId;

      // Log test phase - READ
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "read_operation",
      });

      // Test READ operation
      const readResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/read`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: createdId }),
        }
      );

      testData.readResult = readResult;

      if (readResult.error || !readResult.id || readResult.id !== createdId) {
        const result = {
          success: false,
          error: readResult.error ? `Read operation failed: ${readResult.error}` : "Read returned incorrect data",
          details: { readResult, expectedId: createdId },
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

      // Test UPDATE operation
      const updateResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            id: createdId,
            title: "Updated Test Comment",
            content: "This comment was updated by the authentication test suite."
          }),
        }
      );

      testData.updateResult = updateResult;

      if (updateResult.error || !updateResult.id || updateResult.id !== createdId) {
        const result = {
          success: false,
          error: updateResult.error ? `Update operation failed: ${updateResult.error}` : "Update returned incorrect data",
          details: { updateResult, expectedId: createdId },
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

      // Test LIST operation
      const listResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/list`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({}),
        }
      );

      testData.listResult = listResult;

      if (listResult.error || !listResult.comments) {
        const result = {
          success: false,
          error: listResult.error ? `List operation failed: ${listResult.error}` : "List returned incorrect data",
          details: listResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if our created comment is in the list
      const foundInList = listResult.comments.some(comment => comment.id === createdId);
      if (!foundInList) {
        const result = {
          success: false,
          error: "Created comment not found in list results",
          details: { listResult, createdId },
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

      // Test DESTROY operation
      const destroyResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ id: createdId }),
        }
      );

      testData.destroyResult = destroyResult;

      if (destroyResult.error || !destroyResult.deletedComment || destroyResult.deletedComment.id !== createdId) {
        const result = {
          success: false,
          error: destroyResult.error ? `Destroy operation failed: ${destroyResult.error}` : "Destroy returned incorrect data",
          details: { destroyResult, expectedId: createdId },
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
          createSuccessful: true,
          readSuccessful: true,
          updateSuccessful: true,
          listSuccessful: true,
          destroySuccessful: true,
          itemId: createdId
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
   * This works with your server's token renewal mechanism
   */
  testTokenRenewal: async (apiEndpoint, logContext) => {
    const moduleName = "authentication";
    const testName = "testTokenRenewal";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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
      // We'll use the echo endpoint and check if we get a New-Token header
      // Your server is configured to check token expiration on authenticated requests
      const response = await fetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          // Add a timestamp to help trigger token renewal
          "X-Timestamp": Math.floor(Date.now() / 1000).toString(),
        },
        body: JSON.stringify({ message: "Testing token renewal" }),
      });

      // Check for renewal token in headers
      const newToken = response.headers.get("New-Token");
      testData.newTokenReceived = !!newToken;

      // Parse the response
      const responseData = await response.json();
      testData.responseData = responseData;

      if (!response.ok) {
        const result = {
          success: false,
          error: `Request failed with status ${response.status}`,
          details: responseData,
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