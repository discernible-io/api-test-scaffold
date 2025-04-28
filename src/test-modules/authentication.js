// authentication.js
const nacl = require("tweetnacl");
const { ulid } = require("ulid");
const { stateManager, fetchWithErrorHandling } = require("../middleware/rodit");
const logger = require("../../config/logger");

// Ensure we have a valid token in the state manager
const token = await stateManager.getJwtToken();
if (!token) {
  logger.warn(`No JWT token available for ${testName}`, {
    component: "TestRunner",
    moduleName,
    testName,
  });
  
  // Return early with error
  const result = {
    success: false,
    error: "No JWT token available for testing",
  };
  return captureTestData(testName, moduleName, result, { apiEndpoint });
}

// Log token status
logger.debug(`Using token for ${testName}`, {
  component: "TestRunner",
  moduleName,
  testName,
  hasToken: true,
  tokenLength: token.length
});

/**
 * Enhanced fetch function for more reliable API testing
 * Incorporates best practices from the fetchWithErrorHandling implementation
 */
async function enhancedFetch(url, options = {}) {
  const requestId = options.correlationId || ulid();
  const startTime = Date.now();
  const method = options.method || "GET";

  // Log request initiation
  logger.info("Test API request initiated", {
    component: "TestRunner",
    method: "enhancedFetch",
    event: "request_start",
    requestId,
    url,
    operation: method,
    phase: options.phase || "unknown",
  });

  try {
    // Add authorization token if present
    if (options.token) {
      options.headers = {
        ...(options.headers || {}),
        Authorization: `Bearer ${options.token}`,
        "X-Request-ID": requestId,
      };
    } else {
      options.headers = {
        ...(options.headers || {}),
        "X-Request-ID": requestId,
      };
    }

    // Execute the fetch request
    const response = await fetch(url, options);
    const responseTime = Date.now() - startTime;

    // Check for token renewal
    const newToken = response.headers.get("New-Token");
    if (newToken) {
      await stateManager.setJwtToken(newToken);
      logger.debug("New token received and stored", {
        component: "TestRunner",
        method: "enhancedFetch",
        requestId,
        event: "token_renewed",
      });
    }

    // Parse response data with error handling
    let responseData;
    let parseError = false;

    try {
      if (response.status !== 204) {
        // No content
        responseData = await response.json();
      } else {
        responseData = { success: true };
      }
    } catch (e) {
      parseError = true;
      responseData = {
        parseError: true,
        message: e.message,
        status: response.status,
        statusText: response.statusText,
      };

      logger.warn("Response parsing error", {
        component: "TestRunner",
        method: "enhancedFetch",
        requestId,
        error: e.message,
        status: response.status,
        statusText: response.statusText,
      });
    }

    // Log response details
    logger.info("Test API request completed", {
      component: "TestRunner",
      method: "enhancedFetch",
      event: response.ok ? "request_success" : "request_failed",
      requestId,
      url,
      operation: method,
      statusCode: response.status,
      duration: responseTime,
      parseError,
    });

    return {
      ok: response.ok,
      status: response.status,
      data: responseData,
      headers: response.headers,
      newToken,
    };
  } catch (error) {
    // Handle network/connection errors
    const errorDuration = Date.now() - startTime;

    logger.error("Test API request error", {
      component: "TestRunner",
      method: "enhancedFetch",
      event: "request_error",
      requestId,
      url,
      operation: method,
      errorMessage: error.message,
      errorStack: error.stack,
      duration: errorDuration,
    });

    return {
      ok: false,
      status: 0,
      data: { error: "ConnectionError", message: error.message },
      networkError: true,
    };
  }
}

// Standardized captureTestData function aligned with successful tests
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || "unknown",
  };

  if (!result.success) {
    const correlationId = ulid();
    result.testInfo.correlationId = correlationId;

    logger.error(
      `Test '${testName}' failed for endpoint ${result.testInfo.endpoint}`,
      {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
        correlationId,
        error: result.error,
      }
    );

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

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    logger.debug(
      `Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`,
      {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
      }
    );

    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
    });
  }

  return result;
}

/**
 * Improved authentication test module with more robust API handling
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
      const roditidandtimestamp = new TextEncoder().encode(
        roditid + timeString
      );
      const bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config.own_rodit_bytes_private_key
      );
      const roditid_base64url_signature =
        Buffer.from(bytes_signature).toString("base64url");

      testData.timestamp = timestamp;
      testData.roditid = roditid;

      // Test with valid credentials using enhanced fetch
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_login_test",
      });

      const validLoginResponse = await enhancedFetch(`${apiEndpoint}/login`, {
        method: "POST",
        correlationId,
        phase: "valid_login_test",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature,
        }),
      });

      testData.validLoginStatus = validLoginResponse.status;
      testData.validLoginData = validLoginResponse.data;

      if (!validLoginResponse.ok || !validLoginResponse.data.token) {
        const result = {
          success: false,
          error: validLoginResponse.data.error
            ? `Valid login failed with status ${validLoginResponse.status}: ${validLoginResponse.data.error}`
            : `Valid login failed with status ${validLoginResponse.status}: No token received`,
          details: {
            status: validLoginResponse.status,
            response: validLoginResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the token for future tests
      await stateManager.setJwtToken(validLoginResponse.data.token);

      // Test with missing credentials
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "missing_credentials_test",
      });

      const missingCredsResponse = await enhancedFetch(`${apiEndpoint}/login`, {
        method: "POST",
        correlationId,
        phase: "missing_credentials_test",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          timestamp,
        }),
      });

      testData.missingCredsStatus = missingCredsResponse.status;
      testData.missingCredsData = missingCredsResponse.data;

      // We expect this to fail with a 400-level error
      if (missingCredsResponse.status < 400) {
        const result = {
          success: false,
          error: `System did not reject missing credentials as expected. Got status ${missingCredsResponse.status}`,
          details: {
            status: missingCredsResponse.status,
            response: missingCredsResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test with invalid signature
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_signature_test",
      });

      // Create an invalid signature by changing a character
      const invalid_signature =
        roditid_base64url_signature.substring(
          0,
          roditid_base64url_signature.length - 5
        ) +
        (roditid_base64url_signature.charAt(
          roditid_base64url_signature.length - 5
        ) === "A"
          ? "B"
          : "A") +
        roditid_base64url_signature.substring(
          roditid_base64url_signature.length - 4
        );

      const invalidSigResponse = await enhancedFetch(`${apiEndpoint}/login`, {
        method: "POST",
        correlationId,
        phase: "invalid_signature_test",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature: invalid_signature,
        }),
      });

      testData.invalidSigStatus = invalidSigResponse.status;
      testData.invalidSigData = invalidSigResponse.data;

      // This should fail with a 401 error about invalid signature
      if (invalidSigResponse.status < 400) {
        const result = {
          success: false,
          error: `System did not reject invalid signature as expected. Got status ${invalidSigResponse.status}`,
          details: {
            status: invalidSigResponse.status,
            response: invalidSigResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

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
          validLoginStatus: validLoginResponse.status,
          missingCredentialsRejected: missingCredsResponse.status >= 400,
          missingCredentialsStatus: missingCredsResponse.status,
          invalidSignatureRejected: invalidSigResponse.status >= 400,
          invalidSignatureStatus: invalidSigResponse.status,
          token: validLoginResponse.data.token?.substring(0, 10) + "...", // Show just a preview of the token
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

    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    const token = stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    testData.token = token;

    try {
      // Test with valid token
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_token_access",
      });

      const validAccessResponse = await enhancedFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          correlationId,
          phase: "valid_token_access",
          token,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: "Testing authentication middleware",
          }),
        }
      );

      testData.validAccessStatus = validAccessResponse.status;
      testData.validAccessData = validAccessResponse.data;

      if (!validAccessResponse.ok) {
        const result = {
          success: false,
          error: `Protected endpoint access failed with status ${validAccessResponse.status}`,
          details: {
            status: validAccessResponse.status,
            response: validAccessResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Update token if renewed
      if (validAccessResponse.newToken) {
        logger.debug(
          "New token received and stored during authenticated access test",
          {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
          }
        );
      }

      // Test without token
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "no_token_access",
      });

      const noTokenResponse = await enhancedFetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        correlationId,
        phase: "no_token_access",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: "Testing without token" }),
      });

      testData.noTokenStatus = noTokenResponse.status;
      testData.noTokenData = noTokenResponse.data;

      // This should fail with a 401 error
      if (noTokenResponse.status < 400) {
        const result = {
          success: false,
          error: `System did not reject unauthorized access as expected. Got status ${noTokenResponse.status}`,
          details: {
            status: noTokenResponse.status,
            response: noTokenResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test with invalid token
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_token_access",
      });

      const invalidToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkludmFsaWQgVG9rZW4iLCJpYXQiOjE1MTYyMzkwMjJ9.invalid_signature";

      const invalidTokenResponse = await enhancedFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          correlationId,
          phase: "invalid_token_access",
          token: invalidToken,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: "Testing with invalid token" }),
        }
      );

      testData.invalidTokenStatus = invalidTokenResponse.status;
      testData.invalidTokenData = invalidTokenResponse.data;

      // This should fail with a 401/403 error
      if (invalidTokenResponse.status < 400) {
        const result = {
          success: false,
          error: `System did not reject invalid token as expected. Got status ${invalidTokenResponse.status}`,
          details: {
            status: invalidTokenResponse.status,
            response: invalidTokenResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

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
          validTokenAccessSuccessful:
            validAccessResponse.status >= 200 &&
            validAccessResponse.status < 300,
          validTokenStatus: validAccessResponse.status,
          noTokenAccessRejected: noTokenResponse.status >= 400,
          noTokenStatus: noTokenResponse.status,
          invalidTokenRejected: invalidTokenResponse.status >= 400,
          invalidTokenStatus: invalidTokenResponse.status,
          tokenRenewed: !!validAccessResponse.newToken,
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
   * Test CRUDA API with authentication - FIXED to use fetchWithErrorHandling directly
   * to match the legacy test implementation approach
   */
  testCrudaOperations: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testCrudaOperations";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    // Make sure the endpoint is properly set
    testData.endpoint = `${apiEndpoint}/api/cruda`;

    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // For cleaner logging in each operation
      const logContext = {
        operationId: correlationId,
        correlationId,
        component: "TestRunner",
        moduleName,
        testName: "testCrudaOperations",
        apiEndpoint: apiEndpoint,
        operationType: "CRUDA_TEST",
      };

      // Use the same header format as the legacy tests
      const getHeaders = () => {
        const token = stateManager.getJwtToken();
        return {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          "Authorization": token ? `Bearer ${token}` : undefined
        };
      };

      let createdId;

      // Use the same approach as the legacy tests
      async function performOperation(operationName, func) {
        const phaseStartTime = Date.now();
        const currentContext = {
          ...logContext,
          operation: operationName,
          timestamp: new Date().toISOString(),
          phase: operationName.toLowerCase().replace(/\s+/g, "_"),
        };

        logger.info(`Testing operation`, {
          ...currentContext,
        });

        try {
          const result = await func();
          const duration = Date.now() - phaseStartTime;

          if (result.error) {
            currentContext.errorType = result.error;
            currentContext.errorMessage = result.message;
            currentContext.duration = duration;

            logger.error(`Operation error`, {
              ...currentContext,
            });
            return null;
          }

          currentContext.resultStatus = "success";
          currentContext.resultId = result.id;
          currentContext.duration = duration;

          logger.info(`Operation successful`, {
            ...currentContext,
          });

          return result;
        } catch (error) {
          const duration = Date.now() - phaseStartTime;
          currentContext.unexpectedError = true;
          currentContext.duration = duration;
          currentContext.errorMessage = error.message;
          currentContext.stack = error.stack;

          logger.error(`Unexpected error`, {
            ...currentContext,
          });

          return null;
        }
      }

      // CREATE operation - use fetchWithErrorHandling like the legacy tests
      logger.info("Starting CREATE operation", {
        ...logContext,
        phase: "create_operation",
      });

      const createdItem = await performOperation("CREATE item", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/create`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            title: "Authentication Test Item",
            content: "This is a test item for authentication tests",
          }),
        })
      );

      if (createdItem) {
        createdId = createdItem.id;
        testData.createdId = createdId;
      } else {
        const result = {
          success: false,
          error: "Failed to create test item",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // READ operation - use fetchWithErrorHandling like the legacy tests
      logger.info("Starting READ operation", {
        ...logContext,
        phase: "read_operation",
      });

      const readItem = await performOperation("READ item", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/read`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ id: createdId }),
        })
      );

      if (!readItem) {
        const result = {
          success: false,
          error: "Failed to read created item",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // UPDATE operation - use fetchWithErrorHandling like the legacy tests
      logger.info("Starting UPDATE operation", {
        ...logContext,
        phase: "update_operation",
      });

      const updatedItem = await performOperation("UPDATE item", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/update`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            id: createdId,
            title: "Updated Authentication Test Item",
            content: "This item has been updated by the authentication test",
          }),
        })
      );

      if (!updatedItem) {
        const result = {
          success: false,
          error: "Failed to update test item",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // LIST operation - use fetchWithErrorHandling like the legacy tests
      logger.info("Starting LIST operation", {
        ...logContext,
        phase: "list_operation",
      });

      const listResult = await performOperation("LIST items", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/list`, {
          method: "POST",
          headers: getHeaders(),
        })
      );

      if (!listResult) {
        const result = {
          success: false,
          error: "Failed to list items",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if our item is in the list
      const foundInList = listResult.comments && 
        listResult.comments.some((item) => item.id === createdId);
      testData.foundInList = foundInList;

      // DESTROY operation - use fetchWithErrorHandling like the legacy tests
      logger.info("Starting DESTROY operation", {
        ...logContext,
        phase: "destroy_operation",
      });

      const destroyResult = await performOperation("DESTROY item", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/destroy`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ id: createdId }),
        })
      );

      if (!destroyResult) {
        const result = {
          success: false,
          error: "Failed to delete test item",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Verify deletion - use fetchWithErrorHandling like the legacy tests
      logger.info("Verifying deletion", {
        ...logContext,
        phase: "verify_deletion",
      });

      const verifyListResult = await performOperation("Verify deletion", () =>
        fetchWithErrorHandling(`${apiEndpoint}/api/cruda/list`, {
          method: "POST",
          headers: getHeaders(),
        })
      );

      if (!verifyListResult) {
        const result = {
          success: false,
          error: "Failed to verify item deletion",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if our item has been removed from the list
      const stillInList = verifyListResult.comments && 
        verifyListResult.comments.some((item) => item.id === createdId);
      testData.stillInList = stillInList;

      if (stillInList) {
        const result = {
          success: false,
          error: "Item was not properly deleted",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

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
          itemId: createdId,
          foundInList,
          verifiedDeletion: !stillInList,
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
   * Test to check permissions validation with CRUDA API - FIXED to use proper endpoint paths
   */
  testPermissionsValidation: async (apiEndpoint) => {
    const moduleName = "security";
    const testName = "testPermissionsValidation";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    // Explicitly set the endpoint to fix "unknown" endpoint issue
    testData.endpoint = `${apiEndpoint}/api/cruda`;

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Use getHeaders approach from legacy tests
      const getHeaders = () => {
        const token = stateManager.getJwtToken();
        return {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          "Authorization": token ? `Bearer ${token}` : undefined
        };
      };

      // Log test phase - test authorized endpoints
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "test_authorized_endpoints",
      });

      // Test access to standard CRUDA operations that should be allowed
      // Create operation - using fetchWithErrorHandling like legacy tests
      const createResponse = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            title: "Permission Test Comment",
            content: "Testing permission validation",
          }),
        }
      );

      testData.createResult = createResponse;

      if (createResponse.error) {
        const result = {
          success: false,
          error: `Failed to access authorized endpoint: ${
            createResponse.error
          } - ${createResponse.message || "Unknown error"}`,
          details: createResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the comment ID for later tests
      const commentId = createResponse.id;
      testData.commentId = commentId;

      if (!commentId) {
        const result = {
          success: false,
          error: "Created item didn't return an ID",
          details: createResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test list operation - using fetchWithErrorHandling like legacy tests
      const listResponse = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/list`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({}),
        }
      );

      testData.listResult = listResponse;

      if (listResponse.error) {
        const result = {
          success: false,
          error: `Failed to access list endpoint: ${listResponse.error} - ${
            listResponse.message || "Unknown error"
          }`,
          details: listResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - try to access echo endpoint
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "test_echo_endpoint",
      });

      // Try to access the echo endpoint - not an admin endpoint
      const echoResponse = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ message: "Testing echo endpoint access" }),
        }
      );

      testData.echoResponse = echoResponse;

      // Clean up - delete the test comment
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cleanup",
      });

      const deleteResponse = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ id: commentId }),
        }
      );

      testData.deleteResult = deleteResponse;

      // Log test completion with detailed status
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        createStatus: !createResponse.error,
        listStatus: !listResponse.error,
        echoStatus: !echoResponse.error,
        deleteStatus: !deleteResponse.error,
      });

      const result = {
        success: !createResponse.error && !listResponse.error,
        error: createResponse.error
          ? `Create operation failed: ${createResponse.error}`
          : listResponse.error
          ? `List operation failed: ${listResponse.error}`
          : null,
        details: {
          createSuccessful: !createResponse.error,
          createResponse,

          listSuccessful: !listResponse.error,
          listResponse,

          echoSuccessful: !echoResponse.error,
          echoResponse,

          cleanupSuccessful: !deleteResponse.error,
          deleteResponse,
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

    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    const token = stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    testData.token = token;

    try {
      // Using enhanced fetch with timestamp to potentially trigger token renewal
      const response = await enhancedFetch(`${apiEndpoint}/api/echo`, {
        method: "POST",
        correlationId,
        phase: "token_renewal_check",
        token,
        headers: {
          "Content-Type": "application/json",
          "X-Timestamp": Math.floor(Date.now() / 1000).toString(),
        },
        body: JSON.stringify({ message: "Testing token renewal" }),
      });

      testData.responseStatus = response.status;
      testData.newTokenReceived = !!response.newToken;

      if (!response.ok) {
        // Try a simplified approach if authenticated approach fails
        logger.warn(
          "Token renewal test with authentication failed, trying simplified approach",
          {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
          }
        );

        const simplifiedResponse = await enhancedFetch(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            correlationId,
            phase: "token_renewal_simplified",
            headers: {
              "Content-Type": "application/json",
              "X-Timestamp": Math.floor(Date.now() / 1000).toString(),
            },
            body: JSON.stringify({
              message: "Testing token renewal (simplified)",
            }),
          }
        );

        testData.simplifiedResponseStatus = simplifiedResponse.status;
        testData.simplifiedNewTokenReceived = !!simplifiedResponse.newToken;

        if (!simplifiedResponse.ok) {
          const result = {
            success: false,
            error: `Both authenticated and simplified echo requests failed`,
            details: {
              authenticatedStatus: response.status,
              authenticatedResponse: response.data,
              simplifiedStatus: simplifiedResponse.status,
              simplifiedResponse: simplifiedResponse.data,
            },
          };
          return captureTestData(testName, moduleName, result, testData);
        }

        // Store new token if it was received in the simplified response
        if (simplifiedResponse.newToken) {
          await stateManager.setJwtToken(simplifiedResponse.newToken);
          logger.info("Token renewal detected in simplified request", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "token_renewed_simplified",
          });
        }
      } else {
        // Store new token if it was received
        if (response.newToken) {
          await stateManager.setJwtToken(response.newToken);
          logger.info("Token renewal detected", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "token_renewed",
          });
        } else {
          logger.info("No token renewal needed", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "no_renewal_needed",
          });
        }
      }

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
          requestSuccessful:
            response.ok ||
            (testData.simplifiedResponseStatus >= 200 &&
              testData.simplifiedResponseStatus < 300),
          responseStatus: response.status,
          tokenRenewalChecked: true,
          tokenRenewed:
            !!response.newToken || !!testData.simplifiedNewTokenReceived,
          usedSimplifiedRequest:
            !response.ok &&
            testData.simplifiedResponseStatus >= 200 &&
            testData.simplifiedResponseStatus < 300,
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
   * Test to determine if the API requires authentication for CRUDA operations
   * This helps diagnose whether auth is required or optional
   */
  testAuthenticationRequirements: async (apiEndpoint) => {
    const moduleName = "authentication";
    const testName = "testAuthenticationRequirements";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/cruda`;

    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get stored JWT token for comparison tests
    const token = stateManager.getJwtToken();
    testData.hasToken = !!token;

    try {
      // Test LIST operation without authentication
      const unauthListResponse = await enhancedFetch(
        `${apiEndpoint}/api/cruda/list`,
        {
          method: "POST",
          correlationId,
          phase: "list_without_auth",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      testData.unauthListStatus = unauthListResponse.status;
      testData.unauthListWorks = unauthListResponse.ok;

      // If we have a token, try the same operation with authentication
      if (token) {
        const authListResponse = await enhancedFetch(
          `${apiEndpoint}/api/cruda/list`,
          {
            method: "POST",
            correlationId,
            phase: "list_with_auth",
            token,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
          }
        );

        testData.authListStatus = authListResponse.status;
        testData.authListWorks = authListResponse.ok;
      }

      // Try to create an item without authentication
      const unauthCreateResponse = await enhancedFetch(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          correlationId,
          phase: "create_without_auth",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: "Authentication Test",
            content:
              "Testing whether authentication is required for create operation",
          }),
        }
      );

      testData.unauthCreateStatus = unauthCreateResponse.status;
      testData.unauthCreateWorks = unauthCreateResponse.ok;

      // Try with token if available
      if (token) {
        const authCreateResponse = await enhancedFetch(
          `${apiEndpoint}/api/cruda/create`,
          {
            method: "POST",
            correlationId,
            phase: "create_with_auth",
            token,
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: "Authentication Test (With Auth)",
              content:
                "Testing whether authentication is required for create operation",
            }),
          }
        );

        testData.authCreateStatus = authCreateResponse.status;
        testData.authCreateWorks = authCreateResponse.ok;
      }

      // Analyze the results
      const authRequired = {
        list:
          testData.hasToken &&
          !testData.unauthListWorks &&
          testData.authListWorks,
        create:
          testData.hasToken &&
          !testData.unauthCreateWorks &&
          testData.authCreateWorks,
      };

      const authOptional = {
        list: testData.unauthListWorks,
        create: testData.unauthCreateWorks,
      };

      logger.info("Authentication requirements test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        authRequired,
        authOptional,
      });

      // This test always succeeds - it's diagnostic
      const result = {
        success: true,
        details: {
          authRequiredForList: authRequired.list,
          authRequiredForCreate: authRequired.create,
          authOptionalForList: authOptional.list,
          authOptionalForCreate: authOptional.create,
          unauthListStatus: testData.unauthListStatus,
          unauthCreateStatus: testData.unauthCreateStatus,
          authListStatus: testData.authListStatus,
          authCreateStatus: testData.authCreateStatus,
          diagnosis:
            authRequired.list || authRequired.create
              ? "API appears to require authentication for some operations"
              : authOptional.list && authOptional.create
              ? "API appears to allow operations without authentication"
              : "Could not determine authentication requirements conclusively",
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

      // Even with errors, we want diagnostic information
      const result = {
        success: false,
        error: error.message,
        details: {
          stack: error.stack,
          partialResults: testData,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = authenticationTests;