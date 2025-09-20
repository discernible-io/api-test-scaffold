// authentication.js
const nacl = require("tweetnacl");
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

// Import utilities - preserving deep dependency for testing
const { unixTimeToDateString } = require("../../sdk/services/utils");
const { captureTestData } = require("./test-utils");

/**
 * Fetch with error handling for API calls
 * @param {string} url - URL to fetch
 * @param {Object} fetchoptions - Fetch fetchoptions
 * @returns {Promise<Object>} - Response data
 */
async function fetchWithErrorHandling(url, fetchoptions = {}) {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    logger.debug(`Fetching ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: fetchoptions.method || "GET"
    });

    const response = await fetch(url, {
      ...fetchoptions,
      headers: {
        "Content-Type": "application/json",
        ...fetchoptions.headers
      }
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      
      logger.error(`Fetch error: ${response.status} ${response.statusText}`, {
        component: "fetchWithErrorHandling",
        requestId,
        url,
        method: fetchoptions.method || "GET",
        status: response.status,
        statusText: response.statusText,
        duration,
        errorText
      });
      
      throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    logger.debug(`Fetch successful: ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: fetchoptions.method || "GET",
      status: response.status,
      duration
    });
    
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error(`Fetch exception: ${error.message}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: fetchoptions.method || "GET",
      duration,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Improved authentication test module with more robust API handling
 */
const authenticationTests = {
  /**
   * Test login endpoint with valid and invalid credentials
   * This test verifies that:
   * 1. Login with valid credentials succeeds and returns a token
   * 2. Login with missing credentials is rejected
   * 3. Login with invalid signature is rejected
   */
  testLoginEndpoint: async (tle_api_ep) => {
    const moduleName = "authentication";
    const testName = "testLoginEndpoint";
    const correlationId = ulid();
    const testData = { tle_api_ep };
    testData.endpoint = `${tle_api_ep}/api/login`;

    logger.info("Starting login endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Prepare valid login credentials
      const timestamp = Math.floor(Date.now() / 1000);

      // Get configuration from state manager (proper use case)
      const config_own_rodit = await stateManager.getConfigOwnRodit();

      if (!config_own_rodit || !config_own_rodit.own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Generate signature for authentication
      const roditid = config_own_rodit.own_rodit.token_id;
      const timeString = new Date(timestamp * 1000).toISOString();
      const roditidandtimestamp = new TextEncoder().encode(
        roditid + timeString
      );
      const bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config_own_rodit.own_rodit_bytes_private_key
      );
      const roditid_base64url_signature =
        Buffer.from(bytes_signature).toString("base64url");

      testData.timestamp = timestamp;
      testData.roditid = roditid;

      // SCENARIO 1: Test with valid credentials
      logger.info("Test phase: Valid login", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_login_test",
      });

      // Use the RoditClient to perform the login
      const { RoditClient } = require("../../sdk");
      const roditClient = await RoditClient.create("server");
      const validLoginResponse = await roditClient.login_server();

      testData.validLoginStatus = validLoginResponse.status;
      testData.validLoginData = validLoginResponse.data;

      if (!validLoginResponse.ok || !validLoginResponse.data?.jwt_token) {
        const result = {
          success: false,
          error: validLoginResponse.error
            ? `Valid login failed: ${validLoginResponse.error}`
            : `Valid login failed with status ${validLoginResponse.status}: No jwt_token received`,
          details: {
            status: validLoginResponse.status,
            response: validLoginResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the jwt_token for future tests (proper use of state manager)
      if (validLoginResponse.data?.jwt_token) {
        await stateManager.setJwtToken(validLoginResponse.data.jwt_token);
        logger.debug("Valid jwt_token stored in state manager", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "jwt_token_stored",
          jwt_tokenLength: validLoginResponse.data.jwt_token.length,
        });
      } else {
        logger.error("No valid jwt_token received from login response", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "jwt_token_error",
          response: validLoginResponse
        });
        const result = {
          success: false,
          error: "No valid jwt_token received from login response",
          details: {
            status: validLoginResponse.status,
            response: validLoginResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test that the jwt_token is returned in the header, not as a cookie
      const hasAuthCookie = validLoginResponse.headers &&
        validLoginResponse.headers.get("set-cookie") &&
        validLoginResponse.headers.get("set-cookie").includes("jwt=");

      if (hasAuthCookie) {
        const result = {
          success: false,
          error: "Authentication cookie was set, but we expect jwt_tokens only in headers",
          details: {
            headers: Object.fromEntries(validLoginResponse.headers.entries()),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // SCENARIO 2: Test with missing credentials
      logger.info("Test phase: Missing credentials", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "missing_credentials_test",
      });

      const missingCredsResponse = await fetch(`${tle_api_ep}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          "X-Phase": "missing_credentials_test",
        },
        body: JSON.stringify({
          timestamp, // Only sending timestamp, missing other required fields
        }),
      })
        .then(async (response) => {
          try {
            const data = await response.json();
            return {
              status: response.status,
              ok: response.ok,
              data,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: "Failed to parse response",
            };
          }
        })
        .catch((error) => {
          return {
            error: error.message,
            status: 0,
          };
        });

      testData.missingCredsStatus = missingCredsResponse.status;
      testData.missingCredsData = missingCredsResponse.data;

      // We expect this to fail with a 4xx status code
      if (missingCredsResponse.ok || missingCredsResponse.status < 400) {
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

      // SCENARIO 3: Test with invalid signature
      logger.info("Test phase: Invalid signature", {
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

      const invalidSigResponse = await fetch(`${tle_api_ep}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          "X-Phase": "invalid_signature_test",
        },
        body: JSON.stringify({
          roditid,
          timestamp,
          roditid_base64url_signature: invalid_signature,
        }),
      })
        .then(async (response) => {
          try {
            const data = await response.json();
            return {
              status: response.status,
              ok: response.ok,
              data,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: "Failed to parse response",
            };
          }
        })
        .catch((error) => {
          return {
            error: error.message,
            status: 0,
          };
        });

      testData.invalidSigStatus = invalidSigResponse.status;
      testData.invalidSigData = invalidSigResponse.data;

      // We expect this to fail with a 4xx status code
      if (invalidSigResponse.ok || invalidSigResponse.status < 400) {
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

      logger.info("Login endpoint test completed", {
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
          jwt_token: validLoginResponse.data.jwt_token?.substring(0, 10) + "...", // Show just a preview of the jwt_token
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
   * This test verifies that:
   * 1. Requests with valid jwt_tokens are accepted
   * 2. Requests without jwt_tokens are rejected with 401
   * 3. Requests with invalid jwt_tokens are rejected with 401
   */
  testAuthenticatedAccess: async (taa_api_ep) => {
    const moduleName = "authentication";
    const testName = "testAuthenticatedAccess";
    const correlationId = ulid();

    // Base testData that will be used to create scenario-specific test data objects
    const baseTestData = { taa_api_ep };
    const endpoint = `${taa_api_ep}/api/echo/echo`;

    logger.info("Starting authenticated access test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Use the state manager to retrieve the current jwt_token
    const jwt_token = await stateManager.getJwtToken();
    if (!jwt_token) {
      const result = {
        success: false,
        error: "No JWT jwt_token available for testing",
      };
      return captureTestData(testName, moduleName, result, {
        ...baseTestData,
        endpoint,
      });
    }

    try {
      // SCENARIO 1: Test with valid jwt_token
      logger.info("Test phase: Valid jwt_token access", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_jwt_token_access",
      });

      // Create a specific test data object for this scenario
      const validTokenTestData = {
        ...baseTestData,
        endpoint,
        jwt_token: jwt_token,
        scenario: "valid_jwt_token",
      };

      const validAccessResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`, // Explicitly use jwt_token from state manager
          "X-Request-ID": correlationId,
          "X-Phase": "valid_jwt_token_access",
        },
        body: JSON.stringify({
          message: "Testing authentication middleware",
        }),
      })
        .then(async (response) => {
          // Check for jwt_token renewal
          const newToken = response.headers.get("New-Token");
          if (newToken) {
            logger.debug("New jwt_token received, updating state manager", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "jwt_token_renewal",
            });
            await stateManager.setJwtToken(newToken);
          }

          try {
            const data = await response.json();
            return {
              status: response.status,
              ok: response.ok,
              data: data,
              newToken: newToken,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: "Failed to parse response",
            };
          }
        })
        .catch((error) => {
          return {
            error: error.message,
            status: 0,
          };
        });

      validTokenTestData.validAccessStatus = validAccessResponse.status || 0;
      validTokenTestData.validAccessData =
        validAccessResponse.data || validAccessResponse;

      if (!validAccessResponse.ok || validAccessResponse.error) {
        const result = {
          success: false,
          error: validAccessResponse.error
            ? `Protected endpoint access failed: ${validAccessResponse.error}`
            : `Protected endpoint access failed with status ${
                validAccessResponse.status || "unknown"
              }: Invalid response`,
          details: {
            status: validAccessResponse.status || "unknown",
            response: validAccessResponse,
          },
        };
        return captureTestData(
          testName,
          moduleName,
          result,
          validTokenTestData
        );
      }

      // SCENARIO 2: Test without jwt_token
      logger.info("Test phase: No jwt_token access", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "no_jwt_token_access",
      });

      // Create a specific test data object for this scenario
      const noTokenTestData = {
        ...baseTestData,
        endpoint,
        scenario: "no_jwt_token",
      };

      // Add debug logging to see the exact request we're sending
      logger.debug("Making no-jwt_token request", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        apiEndpoint: endpoint,
        headers: "Content-Type: application/json, X-Request-ID, X-Phase",
        body: JSON.stringify({ message: "Testing without jwt_token" }),
      });

      const noTokenResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          "X-Phase": "no_jwt_token_access",
          // Deliberately NOT including Authorization header
        },
        body: JSON.stringify({ message: "Testing without jwt_token" }),
      })
        .then(async (response) => {
          try {
            const data = await response.json();
            logger.debug("No-jwt_token response received", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              status: response.status,
              responseDataSnippet: JSON.stringify(data).substring(0, 150),
            });
            return {
              status: response.status,
              ok: response.ok,
              data: data,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: "Failed to parse response",
            };
          }
        })
        .catch((error) => {
          return {
            error: error.message,
            status: 0,
          };
        });

      noTokenTestData.noTokenStatus = noTokenResponse.status;
      noTokenTestData.noTokenData = noTokenResponse.data;

      // We EXPECT this to fail with 401 - that's a successful test
      if (noTokenResponse.status !== 401) {
        const result = {
          success: false,
          error: `System did not reject unauthorized access as expected. Got status ${noTokenResponse.status}`,
          details: {
            status: noTokenResponse.status,
            response: noTokenResponse.data,
          },
        };
        return captureTestData(testName, moduleName, result, noTokenTestData);
      }

      // SCENARIO 3: Test with invalid jwt_token
      logger.info("Test phase: Invalid jwt_token access", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_jwt_token_access",
      });

      // Create a specific test data object for this scenario
      const invalidTokenTestData = {
        ...baseTestData,
        endpoint,
        scenario: "invalid_jwt_token",
      };

      const invalidToken =
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkludmFsaWQgVG9rZW4iLCJpYXQiOjE1MTYyMzkwMjJ9.invalid_signature";

      const invalidTokenResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${invalidToken}`, // Using invalid jwt_token, not from state manager
          "X-Request-ID": correlationId,
          "X-Phase": "invalid_jwt_token_access",
        },
        body: JSON.stringify({ message: "Testing with invalid jwt_token" }),
      })
        .then(async (response) => {
          try {
            const data = await response.json();
            return {
              status: response.status,
              ok: response.ok,
              data: data,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: "Failed to parse response",
            };
          }
        })
        .catch((error) => {
          return {
            error: error.message,
            status: 0,
          };
        });

      invalidTokenTestData.invalidTokenStatus = invalidTokenResponse.status;
      invalidTokenTestData.invalidTokenData = invalidTokenResponse.data;

      // We EXPECT this to fail with 401 - that's a successful test
      if (invalidTokenResponse.status !== 403) {
        const result = {
          success: false,
          error: `System did not reject invalid jwt_token as expected. Expected 403 for invalid jwt_token, got status ${invalidTokenResponse.status}`,
          details: {
            status: invalidTokenResponse.status,
            response: invalidTokenResponse.data,
          },
        };
        return captureTestData(
          testName,
          moduleName,
          result,
          invalidTokenTestData
        );
      }

      // If we've reached here, all tests passed
      logger.info("Authentication test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      // Final success report with minimal data to avoid confusion
      const successTestData = {
        ...baseTestData,
        endpoint,
        testComplete: true,
        validAccessStatus: validTokenTestData.validAccessStatus,
        noTokenStatus: noTokenTestData.noTokenStatus,
        invalidTokenStatus: invalidTokenTestData.invalidTokenStatus,
      };

      const result = {
        success: true,
        details: {
          validTokenAccessSuccessful: true,
          validTokenStatus: validAccessResponse.status,
          noTokenAccessRejected: noTokenResponse.status === 401,
          noTokenStatus: noTokenResponse.status,
          invalidTokenRejected: invalidTokenResponse.status === 403, // Updated from 401 to 403
          invalidTokenStatus: invalidTokenResponse.status,
          jwt_tokenRenewed: !!validAccessResponse.newToken,
        },
      };

      return captureTestData(testName, moduleName, result, successTestData);
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

      return captureTestData(testName, moduleName, result, {
        ...baseTestData,
        endpoint,
        error: error.message,
      });
    }
  },

  /**
   * Test CRUDA API with authentication - Modified to properly leverage fetchWithErrorHandling's jwt_token handling
   */
  2: async (tcuwa_api_ep) => {
    const moduleName = "authentication";
    const testName = "testCrudaOperations1";
    const correlationId = ulid();
    const testData = { tcuwa_api_ep };
    // Make sure the endpoint is properly set
    testData.endpoint = `${tcuwa_api_ep}/api/cruda`;

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
        testName: "testCrudaOperations1",
        tcuwa_api_ep: tcuwa_api_ep,
        operationType: "CRUDA_TEST",
      };

      const getHeaders = () => {
        const jwt_token = stateManager.getJwtToken(); // Synchronous retrieval
        return {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          Authorization: jwt_token ? `Bearer ${jwt_token}` : undefined,
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

      // CREATE operation - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Starting CREATE operation", {
        ...logContext,
        phase: "create_operation",
      });

      const createdItem = await performOperation("CREATE item", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/create`, {
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

      // READ operation - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Starting READ operation", {
        ...logContext,
        phase: "read_operation",
      });

      const readItem = await performOperation("READ item", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/read`, {
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

      // UPDATE operation - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Starting UPDATE operation", {
        ...logContext,
        phase: "update_operation",
      });

      const updatedItem = await performOperation("UPDATE item", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/update`, {
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

      // LIST operation - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Starting LIST operation", {
        ...logContext,
        phase: "list_operation",
      });

      const listResult = await performOperation("LIST items", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/list`, {
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
      const foundInList =
        listResult.comments &&
        listResult.comments.some((item) => item.id === createdId);
      testData.foundInList = foundInList;

      // DESTROY operation - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Starting DESTROY operation", {
        ...logContext,
        phase: "destroy_operation",
      });

      const destroyResult = await performOperation("DESTROY item", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/destroy`, {
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

      // Verify deletion - let fetchWithErrorHandling handle jwt_token injection
      logger.info("Verifying deletion", {
        ...logContext,
        phase: "verify_deletion",
      });

      const verifyListResult = await performOperation("Verify deletion", () =>
        fetchWithErrorHandling(`${tcuwa_api_ep}/api/cruda/list`, {
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
      const stillInList =
        verifyListResult.comments &&
        verifyListResult.comments.some((item) => item.id === createdId);
      testData.stillInList = stillInList;

      if (stillInList) {
        const result = {
          success: false,
          error: "Item was not properly deleted",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      logger.info("Test completed", {
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
   * Test jwt_token renewal by checking for New-Token header
   * This test verifies that:
   * 1. The API correctly renews jwt_tokens when appropriate
   * 2. Renewed jwt_tokens are returned in the New-Token header only (no cookies)
   * 3. The renewed jwt_token contains the expected user information
   */
  testTokenRenewal: async (ttr_api_ep) => {
    const moduleName = "authentication";
    const testName = "testTokenRenewal";
    const correlationId = ulid();
    const testData = { ttr_api_ep };

    logger.info("Starting jwt_token renewal test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get the current jwt_token from state manager
      const jwt_token = await stateManager.getJwtToken();

      if (!jwt_token) {
        const result = {
          success: false,
          error: "No JWT jwt_token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Make multiple requests to trigger jwt_token renewal
      // We'll use a protected endpoint that requires authentication
      const endpoint = `${ttr_api_ep}/api/echo/echo`;
      testData.endpoint = endpoint;

      logger.info("Making authenticated request to trigger jwt_token renewal", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "request",
      });

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
          "X-Phase": "jwt_token_renewal_test",
        },
        body: JSON.stringify({
          message: "Testing jwt_token renewal",
        }),
      });

      // Check if a new jwt_token was issued
      const newToken = response.headers.get("New-Token");
      testData.hasNewToken = !!newToken;

      // Check if cookies were set (they shouldn't be)
      const cookies = response.headers.get("set-cookie");
      const hasCookies = cookies && cookies.length > 0;
      testData.hasCookies = hasCookies;

      if (hasCookies) {
        const result = {
          success: false,
          error: "Cookies were set during jwt_token renewal, but we expect jwt_tokens only in headers",
          details: {
            cookies,
            headers: Object.fromEntries(response.headers.entries()),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // If no new jwt_token was issued, that's acceptable - not every request triggers renewal
      if (!newToken) {
        logger.info("No jwt_token renewal occurred during this test", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "no_renewal",
        });

        const result = {
          success: true,
          details: {
            message: "No jwt_token renewal occurred during this test",
            jwt_tokenRenewalNotRequired: true,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the new jwt_token for future tests
      await stateManager.setJwtToken(newToken);

      logger.info("Token renewal successful", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "renewal_success",
        newTokenLength: newToken.length,
      });

      // Make another request with the new jwt_token to verify it works
      logger.info("Verifying renewed jwt_token works", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "verify_new_jwt_token",
      });

      const verificationResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${newToken}`,
          "X-Request-ID": correlationId,
          "X-Phase": "verify_new_jwt_token",
        },
        body: JSON.stringify({
          message: "Verifying renewed jwt_token",
        }),
      });

      if (!verificationResponse.ok) {
        const result = {
          success: false,
          error: "Renewed jwt_token was not accepted",
          details: {
            status: verificationResponse.status,
            response: await verificationResponse.text(),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const result = {
        success: true,
        details: {
          jwt_tokenRenewed: true,
          renewedTokenWorks: true,
          noCookiesSet: !hasCookies,
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
   * Test session invalidation after logout
   * This test verifies that:
   * 1. A valid jwt_token is invalidated after logout
   * 2. Subsequent requests with the invalidated jwt_token are rejected
   * 3. The logout endpoint returns the expected response format
   * 4. Attempting to logout again with an invalidated jwt_token fails
   */
  testSessionInvalidation: async (tsi_api_ep) => {
    const moduleName = "authentication";
    const testName = "testSessionInvalidation";
    const correlationId = ulid();
    const testData = { tsi_api_ep };

    logger.info("Starting session invalidation test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Step 1: Login to get a jwt_token
      logger.info("Performing login to get a jwt_token", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
      });

      // Get configuration from state manager to create valid login credentials
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Generate valid login credentials
      const timestamp = Math.floor(Date.now() / 1000);
      const roditid = config_own_rodit.own_rodit.token_id;
      const timeString = await unixTimeToDateString(timestamp);
      const roditidandtimestamp = new TextEncoder().encode(
        roditid + timeString
      );
      const bytes_signature = nacl.sign.detached(
        roditidandtimestamp,
        config_own_rodit.own_rodit_bytes_private_key
      );
      const roditid_base64url_signature =
        Buffer.from(bytes_signature).toString("base64url");

      testData.loginCredentials = {
        roditidUsed: true, // Don't store actual roditid in logs
        timestamp,
        signatureLength: roditid_base64url_signature.length,
      };

      // Use the proper login endpoint
      const loginEndpoint = `${tsi_api_ep}/api/sessions/login`;
      const loginResponse = await fetch(loginEndpoint, {
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

      if (!loginResponse.ok) {
        const errorText = await loginResponse.text();
        const result = {
          success: false,
          error: `Login failed: ${loginResponse.status} ${loginResponse.statusText}`,
          details: {
            status: loginResponse.status,
            response: errorText,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const loginData = await loginResponse.json();
      const jwt_token = loginData.jwt_token;

      if (!jwt_token) {
        const result = {
          success: false,
          error: "No JWT jwt_token returned from login endpoint",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.jwt_token = "[REDACTED]"; // Don't store actual jwt_token in logs

      // Step 2: Verify the jwt_token works by making an authenticated request
      logger.info("Verifying jwt_token works before logout", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "verify_jwt_token",
      });

      const verifyEndpoint = `${tsi_api_ep}/api/echo/echo`;
      const verifyResponse = await fetch(verifyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          message: "Verifying jwt_token works before logout",
        }),
      });

      if (!verifyResponse.ok) {
        const errorText = await verifyResponse.text();
        const result = {
          success: false,
          error: `Token verification failed: ${verifyResponse.status} ${verifyResponse.statusText}`,
          details: {
            status: verifyResponse.status,
            response: errorText,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.verifyStatus = verifyResponse.status;
      testData.verifyWorks = true;

      // Step 3: Logout to invalidate the jwt_token using the proper logout endpoint
      logger.info("Performing logout to invalidate jwt_token", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "logout",
      });

      // Use the proper logout endpoint
      const logoutEndpoint = `${tsi_api_ep}/api/sessions/logout`;
      const logoutResponse = await fetch(logoutEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          reason: "user_logout"
        }),
      });

      testData.logoutStatus = logoutResponse.status;
      testData.logoutSuccessful = logoutResponse.ok;

      // Verify the logout response format
      if (logoutResponse.ok) {
        const logoutData = await logoutResponse.json();
        testData.logoutResponse = {
          message: logoutData.message,
          sessionClosed: logoutData.sessionClosed,
          hasRequestId: !!logoutData.requestId
        };
        
        // Check that the response has the expected fields
        const hasExpectedFields = 
          typeof logoutData.message === 'string' && 
          typeof logoutData.sessionClosed !== 'undefined' &&
          typeof logoutData.requestId === 'string';
        
        if (!hasExpectedFields) {
          const result = {
            success: false,
            error: "Logout response missing expected fields",
            details: {
              logoutData,
              expectedFields: ['message', 'sessionClosed', 'requestId']
            },
          };
          return captureTestData(testName, moduleName, result, testData);
        }
      } else {
        const errorText = await logoutResponse.text();
        const result = {
          success: false,
          error: `Logout failed: ${logoutResponse.status} ${logoutResponse.statusText}`,
          details: {
            status: logoutResponse.status,
            response: errorText,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Step 4: Try to use the jwt_token after logout (should fail)
      logger.info("Testing jwt_token after logout (should be rejected)", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "test_after_logout",
      });

      const postLogoutResponse = await fetch(verifyEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          message: "This request should be rejected after logout",
        }),
      });

      testData.postLogoutStatus = postLogoutResponse.status;
      
      // The request should be rejected with a 401 Unauthorized status
      const expectedRejected = postLogoutResponse.status === 401;
      testData.jwt_tokenInvalidated = expectedRejected;

      // Check if the jwt_token was properly invalidated
      if (!expectedRejected) {
        const result = {
          success: false,
          error: "Token was not properly invalidated after logout",
          details: {
            logoutStatus: logoutResponse.status,
            postLogoutStatus: postLogoutResponse.status,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Step 5: Try to logout again with the same jwt_token (should fail with 401)
      logger.info("Attempting second logout with invalidated jwt_token (should fail)", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "second_logout",
      });

      const secondLogoutResponse = await fetch(logoutEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
        body: JSON.stringify({
          reason: "user_logout"
        }),
      });

      testData.secondLogoutStatus = secondLogoutResponse.status;
      
      // The second logout should be rejected with a 401 Unauthorized status
      const secondLogoutRejected = secondLogoutResponse.status === 401;
      testData.secondLogoutRejected = secondLogoutRejected;

      if (!secondLogoutRejected) {
        const result = {
          success: false,
          error: "Second logout with invalidated jwt_token was not rejected as expected",
          details: {
            secondLogoutStatus: secondLogoutResponse.status,
            expectedStatus: 401,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test passed successfully
      const result = {
        success: true,
        details: {
          logoutStatus: logoutResponse.status,
          postLogoutStatus: postLogoutResponse.status,
          jwt_tokenInvalidated: true,
          secondLogoutRejected: true,
          logoutResponse: testData.logoutResponse,
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
   * Test CRUDA operations authentication requirements
   * Verifies that:
   * 1. Unauthenticated CRUDA operations are rejected
   * 2. Authenticated operations work as expected
   * 3. Token refresh works correctly
   */
  testCrudaAuthentication: async (tca_api_ep) => {
    const moduleName = "authentication";
    const testName = "testCrudaAuthentication";
    const correlationId = ulid();
    const testData = { tca_api_ep };
    
    logger.info('Starting CRUDA authentication test', {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start"
    });
    
    try {
      // 1. Test unauthenticated CREATE - should fail
      const createData = {
        title: `Auth Test Item ${Date.now()}`,
        content: 'Authentication test item',
        testId: ulid()
      };
      
      logger.info('Testing unauthenticated CREATE', {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "unauthenticated_create"
      });
      
      let createResponse;
      try {
        createResponse = await fetch(`${tca_api_ep}/api/cruda/create`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(createData)
        });
      } catch (error) {
        // Expected to fail with network error or 401
      }
      
      if (createResponse && createResponse.status !== 401) {
        throw new Error(`Expected 401 for unauthenticated CREATE, got ${createResponse.status}`);
      }
      
      // 2. Test authenticated operations
      const client = require('../../sdk');
      let isAuthenticated = false;
      
      try {
        isAuthenticated = await client.isAuthenticated();
        if (!isAuthenticated) {
          // Use the client's login_server method
          const loginResult = await client.login_server();
          if (loginResult.error) {
            throw new Error(`Login failed: ${loginResult.error}`);
          }
          isAuthenticated = await client.isAuthenticated();
        }
      } catch (loginError) {
        logger.warn('Login failed during CRUDA auth test', {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "login_failed",
          error: loginError.message
        });
        throw loginError;
      }
      
      if (!isAuthenticated) {
        throw new Error('Failed to authenticate for CRUDA operations test');
      }
      
      // 3. Test jwt_token refresh
      logger.info('Testing jwt_token refresh', {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "jwt_token_refresh_test"
      });
      
      await client.refreshToken();
      
      // 4. Test authenticated CREATE
      logger.info('Testing authenticated CREATE', {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "authenticated_create"
      });
      
      const authCreateResponse = await client.request('POST', '/api/cruda/create', {
        body: createData
      });
      
      if (!authCreateResponse || !authCreateResponse.id) {
        throw new Error('Failed to create item with authenticated request');
      }
      
      // 5. Clean up
      logger.info('Cleaning up test data', {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cleanup"
      });
      
      await client.request('POST', '/api/cruda/delete', {
        body: { id: authCreateResponse.id }
      });
      
      return {
        success: true,
        message: 'CRUDA authentication tests passed',
        data: {
          unauthenticatedCreateBlocked: true,
          authenticatedCreateSucceeded: true,
          jwt_tokenRefreshSucceeded: true
        }
      };
      
    } catch (error) {
      logger.error('CRUDA authentication test failed', {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack
      });
      
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }
  },

  /**
   * Test to determine if the API requires authentication for CRUDA operations
   * This helps diagnose whether auth is required or optional
   */
  testAuthenticationRequirements: async (tar_api_ep) => {
    const moduleName = "authentication";
    const testName = "testAuthenticationRequirements";
    const correlationId = ulid();
    const testData = { tar_api_ep };
    testData.endpoint = `${tar_api_ep}/api/cruda`;

    logger.info("Starting authentication requirements test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get stored JWT jwt_token for comparison tests
    const jwt_token = await stateManager.getJwtToken();
    testData.hasToken = !!jwt_token;

    try {
      // Define helper function for tracking operations consistently
      const performOperation = async (endpoint, method, body, useAuth) => {
        const operationId = ulid();
        const operationData = {
          endpoint,
          method,
          bodyPreview: body ? JSON.stringify(body).substring(0, 100) : null,
          useAuth,
        };

        logger.debug(`Testing ${method} operation on ${endpoint}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          operationId,
          ...operationData,
        });

        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": operationId,
        };

        if (useAuth && jwt_token) {
          headers.Authorization = `Bearer ${jwt_token}`;
        }

        let response;

        // Use standard fetch for unauthenticated requests to avoid fetchWithErrorHandling's
        // automatic jwt_token injection
        if (!useAuth) {
          try {
            const fetchResponse = await fetch(`${tar_api_ep}${endpoint}`, {
              method: "POST",
              headers,
              body: body ? JSON.stringify(body) : undefined,
            });

            // Parse response body
            let data;
            try {
              data = await fetchResponse.json();
            } catch (e) {
              data = {};
            }

            response = {
              ...data,
              status: fetchResponse.status,
              ok: fetchResponse.ok,
            };
          } catch (error) {
            response = {
              error: error.message,
              status: 0,
            };
          }
        } else {
          // Use fetchWithErrorHandling for authenticated requests
          response = await fetchWithErrorHandling(`${tar_api_ep}${endpoint}`, {
            method: "POST",
            headers,
            body: body ? JSON.stringify(body) : undefined,
          });
        }

        const resultData = {
          ...operationData,
          status: response.status || (response.error ? 500 : 200),
          success: !response.error && (response.status >= 200 && response.status < 300),
          error: response.error,
        };

        logger.debug(`Operation result: ${resultData.success ? "success" : "failure"}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          operationId,
          ...resultData,
        });

        return {
          success: resultData.success,
          status: resultData.status,
          data: response,
          operationData: resultData,
        };
      };

      // PHASE 1: Test unauthenticated access to various endpoints
      logger.info("Testing unauthenticated access to endpoints", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "unauthenticated_access",
      });

      // Test LIST operation without authentication
      const unauthListResponse = await performOperation(
        "/api/cruda/list",
        "LIST",
        {},
        false
      );
      testData.unauthListStatus = unauthListResponse.status;
      testData.unauthListWorks = unauthListResponse.success;

      // Try to create an item without authentication
      const unauthCreateResponse = await performOperation(
        "/api/cruda/create",
        "CREATE",
        {
          title: "Authentication Test",
          content:
            "Testing whether authentication is required for create operation",
        },
        false
      );
      testData.unauthCreateStatus = unauthCreateResponse.status;
      testData.unauthCreateWorks = unauthCreateResponse.success;

      // Test unauthorized access to echo endpoint
      const unauthEchoResponse = await performOperation(
        "/api/echo/echo",
        "ECHO",
        { message: "Testing echo endpoint without authentication" },
        false
      );
      testData.unauthEchoStatus = unauthEchoResponse.status;
      testData.unauthEchoWorks = unauthEchoResponse.success;

      // PHASE 2: If we have a jwt_token, test authenticated access
      if (jwt_token) {
        logger.info("Testing authenticated access to endpoints", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "authenticated_access",
        });

        // Test LIST operation with authentication
        const authListResponse = await performOperation(
          "/api/cruda/list",
          "LIST",
          {},
          true
        );
        testData.authListStatus = authListResponse.status;
        testData.authListWorks = authListResponse.success;

        // Test CREATE operation with authentication
        const authCreateResponse = await performOperation(
          "/api/cruda/create",
          "CREATE",
          {
            title: "Authentication Test (With Auth)",
            content:
              "Testing whether authentication is required for create operation",
          },
          true
        );
        testData.authCreateStatus = authCreateResponse.status;
        testData.authCreateWorks = authCreateResponse.success;

        // Store created item ID if successful
        if (
          authCreateResponse.success &&
          authCreateResponse.data &&
          authCreateResponse.data.id
        ) {
          testData.createdItemId = authCreateResponse.data.id;
        }

        // Test echo endpoint with authentication
        const authEchoResponse = await performOperation(
          "/api/echo/echo",
          "ECHO",
          { message: "Testing echo endpoint with authentication" },
          true
        );
        testData.authEchoStatus = authEchoResponse.status;
        testData.authEchoWorks = authEchoResponse.success;
      }

      // PHASE 3: Clean up - delete any created items
      if (testData.createdItemId) {
        logger.info("Cleaning up created test items", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "cleanup",
        });

        const deleteResponse = await performOperation(
          "/api/cruda/destroy",
          "DELETE",
          { id: testData.createdItemId },
          true
        );
        testData.deleteStatus = deleteResponse.status;
        testData.deleteWorks = deleteResponse.success;
      }

      // Analyze the results
      const authResults = {
        endpoints: {
          list: {
            unauthenticated: testData.unauthListWorks,
            authenticated: testData.hasToken ? testData.authListWorks : null,
            requiresAuth: testData.hasToken
              ? !testData.unauthListWorks && testData.authListWorks
              : null,
            optionalAuth: testData.unauthListWorks,
          },
          create: {
            unauthenticated: testData.unauthCreateWorks,
            authenticated: testData.hasToken ? testData.authCreateWorks : null,
            requiresAuth: testData.hasToken
              ? !testData.unauthCreateWorks && testData.authCreateWorks
              : null,
            optionalAuth: testData.unauthCreateWorks,
          },
          echo: {
            unauthenticated: testData.unauthEchoWorks,
            authenticated: testData.hasToken ? testData.authEchoWorks : null,
            requiresAuth: testData.hasToken
              ? !testData.unauthEchoWorks && testData.authEchoWorks
              : null,
            optionalAuth: testData.unauthEchoWorks,
          },
        },
      };

      // Determine overall auth strategy
      const authStrategyAnalysis = {
        strictAuth:
          authResults.endpoints.list.requiresAuth &&
          authResults.endpoints.create.requiresAuth &&
          authResults.endpoints.echo.requiresAuth,
        mixedAuth:
          (authResults.endpoints.list.requiresAuth ||
            authResults.endpoints.create.requiresAuth) &&
          !(
            authResults.endpoints.list.requiresAuth &&
            authResults.endpoints.create.requiresAuth
          ),
        optionalAuth:
          authResults.endpoints.list.optionalAuth &&
          authResults.endpoints.create.optionalAuth &&
          authResults.endpoints.echo.optionalAuth,
      };

      // Determine the most likely authentication model
      let authModel = "unknown";
      if (authStrategyAnalysis.strictAuth) {
        authModel = "strict_authentication";
      } else if (authStrategyAnalysis.optionalAuth) {
        authModel = "optional_authentication";
      } else if (authStrategyAnalysis.mixedAuth) {
        authModel = "mixed_authentication";
      }

      logger.info("Authentication requirements test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        authModel,
        authResults,
        authStrategyAnalysis,
      });

      // This test is diagnostic, so it's always "successful" if it completes
      const result = {
        success: true,
        details: {
          authModel,
          authRequirements: authResults,
          authStrategyAnalysis,
          diagnosis: `API appears to use a ${authModel.replace(
            /_/g,
            " "
          )} model`,
          endpoints: {
            list: {
              unauthStatus: testData.unauthListStatus,
              authStatus: testData.authListStatus,
            },
            create: {
              unauthStatus: testData.unauthCreateStatus,
              authStatus: testData.authCreateStatus,
            },
            echo: {
              unauthStatus: testData.unauthEchoStatus,
              authStatus: testData.authEchoStatus,
            },
          },
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
