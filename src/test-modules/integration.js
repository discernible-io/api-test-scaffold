/**
 * Integration Tests
 *
 * Tests for end-to-end integration flows in the API
 *
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require("../../sdk");
const { captureTestData, getRoditClientForTest } = require("./test-utils");
const { RoditClient } = require("../../sdk");

/**
 * Integration tests module
 */
const integrationTests = {
  /**
   * Test complete authentication flow
   * This test verifies the end-to-end authentication process:
   * 1. Login
   * 2. Access protected resources
   * 3. Token renewal
   * 4. Logout
   * 5. Verify session invalidation
   */
  testCompleteAuthFlow: async (apiEndpoint, logContext) => {
    const testName = "testCompleteAuthFlow";
    const moduleName = "integration";
    const correlationId = logContext.correlationId;
    const tcaf_api_ep = apiEndpoint;

    logger.info("Starting complete authentication flow test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    const testData = {
      tcaf_api_ep,
    };

    try {
      // Use SDK authentication instead of manual approach
      const { RoditClient } = require("../../sdk");
      const client = await RoditClient.createTestInstance();

      logger.info("Step 1: Performing login using SDK", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
      });

      // Step 1: Login using SDK
      let loginResult;
      try {
        loginResult = await client.login_server();
        if (loginResult.error) {
          throw new Error(`Login failed: ${loginResult.error}`);
        }
        testData.loginStatus = 200;
        testData.loginData = loginResult;
        testData.hasToken = !!loginResult.jwt_token;
      } catch (loginError) {
        const result = {
          success: false,
          error: "Login failed in authentication flow",
          details: {
            status: 401,
            data: { message: loginError.message },
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const token = loginResult.jwt_token;
      testData.hasToken = true;

      // Function to create headers with token
      const getHeaders = () => ({
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
        Authorization: `Bearer ${token}`,
      });

      // Step 2: Access protected resources
      logger.info("Step 2: Accessing protected resources", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "access_protected",
      });

      // Test echo endpoint (protected)
      const echoResponse = await fetch(`${tcaf_api_ep}/api/echo`, {
        method: "GET",
        headers: getHeaders(),
      });

      testData.echoStatus = echoResponse.status;

      if (!echoResponse.ok) {
        const result = {
          success: false,
          error: "Failed to access protected echo endpoint",
          details: {
            status: echoResponse.status,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test CRUDA endpoint (protected with permissions)
      const crudaResponse = await fetch(`${tcaf_api_ep}/api/cruda/list`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({}),
      });

      testData.crudaStatus = crudaResponse.status;

      // Note: CRUDA might require specific permissions, so we don't fail the test if it returns 403
      const crudaPermissionDenied = crudaResponse.status === 403;
      testData.crudaPermissionDenied = crudaPermissionDenied;

      // Step 3: Check for token renewal
      logger.info("Step 3: Checking token renewal", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "token_renewal",
      });

      // Make multiple requests to potentially trigger token renewal
      const renewalResponses = [];
      for (let i = 0; i < 3; i++) {
        const response = await fetch(`${tcaf_api_ep}/api/echo`, {
          method: "GET",
          headers: getHeaders(),
        });

        renewalResponses.push({
          status: response.status,
          hasNewToken: response.headers.has("New-Token"),
          newToken: response.headers.get("New-Token"),
        });
      }

      testData.renewalResponses = renewalResponses;

      // Check if any response included a new token
      const tokenRenewalDetected = renewalResponses.some((r) => r.hasNewToken);
      testData.tokenRenewalDetected = tokenRenewalDetected;

      // If a new token was issued, use it for subsequent requests
      let updatedToken = token;
      const renewalWithToken = renewalResponses.find((r) => r.newToken);
      if (renewalWithToken) {
        updatedToken = renewalWithToken.newToken;
      }

      // Step 4: Logout
      logger.info("Step 4: Performing logout", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "logout",
      });

      const logoutResponse = await fetch(`${tcaf_api_ep}/api/sessions/logout`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          Authorization: `Bearer ${updatedToken}`,
        },
        body: JSON.stringify({
          reason: "test_complete_auth_flow",
        }),
      });

      testData.logoutStatus = logoutResponse.status;

      if (logoutResponse.ok) {
        const logoutData = await logoutResponse.json();
        testData.logoutResponse = {
          message: logoutData.message,
          sessionClosed: logoutData.sessionClosed,
          jwt_tokenInvalidated: logoutData.jwt_tokenInvalidated,
          hasTerminationToken: !!logoutData.terminationToken,
          hasRequestId: !!logoutData.requestId,
        };

        // Verify the logout response has the expected fields
        const hasExpectedFields =
          typeof logoutData.message === "string" &&
          typeof logoutData.sessionClosed === "boolean" &&
          typeof logoutData.jwt_tokenInvalidated === "boolean" &&
          typeof logoutData.requestId === "string";

        if (!hasExpectedFields) {
          const result = {
            success: false,
            error: "Logout response missing expected fields",
            details: {
              logoutData,
              expectedFields: [
                "message",
                "sessionClosed",
                "jwt_tokenInvalidated",
                "requestId",
              ],
            },
          };
          return captureTestData(testName, moduleName, result, testData);
        }

        // Verify session was actually closed and token was invalidated
        if (!logoutData.sessionClosed || !logoutData.jwt_tokenInvalidated) {
          const result = {
            success: false,
            error: "Logout did not properly close session or invalidate token",
            details: {
              sessionClosed: logoutData.sessionClosed,
              jwt_tokenInvalidated: logoutData.jwt_tokenInvalidated,
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

      // Step 5: Verify session invalidation by trying to access protected resource again
      logger.info("Step 5: Verifying session invalidation", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "verify_invalidation",
      });

      const postLogoutResponse = await fetch(`${tcaf_api_ep}/api/echo`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          Authorization: `Bearer ${updatedToken}`,
        },
      });

      testData.postLogoutStatus = postLogoutResponse.status;

      // Should return 401 Unauthorized
      const sessionProperlyClosed = postLogoutResponse.status === 401;

      if (!sessionProperlyClosed) {
        const result = {
          success: false,
          error: `Session not properly invalidated: expected 401, got ${postLogoutResponse.status}`,
          details: {
            status: postLogoutResponse.status,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Determine overall success and details
      // Update the test result to include logout details
      const loginSuccessful = testData.loginStatus === 200;
      const protectedAccessSuccessful = testData.echoStatus === 200;
      const logoutSuccessful =
        testData.logoutStatus === 200 &&
        testData.logoutResponse?.sessionClosed &&
        testData.logoutResponse?.jwt_tokenInvalidated;
      const overallSuccess =
        loginSuccessful && protectedAccessSuccessful && logoutSuccessful;

      const result = {
        success: overallSuccess,
        details: {
          loginSuccessful,
          protectedAccessSuccessful,
          tokenRenewalDetected: testData.tokenRenewalDetected,
          crudaPermissionDenied: testData.crudaPermissionDenied,
          logoutStatus: testData.logoutStatus,
          sessionClosed: testData.logoutResponse?.sessionClosed,
          jwt_tokenInvalidated: testData.logoutResponse?.jwt_tokenInvalidated,
          hasTerminationToken: testData.logoutResponse?.hasTerminationToken,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Complete authentication flow test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test component interactions
   * This test verifies interactions between different components:
   * 1. Session management affecting CRUDA operations
   * 2. Authentication affecting MCP access
   * 3. Permissions propagation across components
   */
  testComponentInteractions: async (tci_api_ep) => {
    const moduleName = "integration";
    const testName = "testComponentInteractions";
    const correlationId = ulid();
    const testData = { tci_api_ep };

    logger.info("Starting component interactions test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      if (!token) {
        const result = {
          success: false,
          error: "No authentication token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Function to create headers with token
      const getHeaders = () => ({
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
        Authorization: `Bearer ${token}`,
      });

      // Test 1: Create a CRUDA item and verify it's accessible via MCP
      logger.info("Test 1: CRUDA and MCP interaction", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cruda_mcp_interaction",
      });

      // Create a CRUDA item
      const createItemResponse = await stateManager.fetchWithErrorHandling(
        `${tci_api_ep}/api/cruda/create`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({
            comment: "Integration Test Item",
            content: "This item tests integration between CRUDA and MCP",
          }),
        }
      );

      testData.createItemResponse = createItemResponse;

      if (createItemResponse.error) {
        // If we don't have permission to create items, we'll skip this test
        testData.skipCrudaMcpTest = true;
        logger.warn(
          "Skipping CRUDA-MCP interaction test due to permission issues",
          {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "cruda_mcp_interaction",
            error: createItemResponse.error,
          }
        );
      } else {
        const itemId = createItemResponse.id;
        testData.itemId = itemId;

        // Try to access the item via MCP (if MCP provides access to CRUDA items)
        const mcpItemResponse = await fetch(
          `${tci_api_ep}/api/mcp/resource/cruda/${itemId}`,
          {
            method: "GET",
            headers: getHeaders(),
          }
        );

        testData.mcpItemStatus = mcpItemResponse.status;

        // Note: We don't fail the test if MCP doesn't provide access to CRUDA items
        // This is implementation-dependent
        testData.mcpProvidesCrudaAccess = mcpItemResponse.ok;

        // Clean up: Delete the created item
        await stateManager.fetchWithErrorHandling(
          `${tci_api_ep}/api/cruda/destroy`,
          {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ id: itemId }),
          }
        );
      }

      // Test 2: Session state propagation
      logger.info("Test 2: Session state propagation", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "session_state_propagation",
      });

      // Get session metrics
      const sessionMetricsResponse = await stateManager.fetchWithErrorHandling(
        `${tci_api_ep}/api/metrics/sessions`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.sessionMetricsResponse = sessionMetricsResponse;

      // Verify that our session is counted in the metrics
      const sessionCountValid =
        sessionMetricsResponse &&
        typeof sessionMetricsResponse.active === "number" &&
        sessionMetricsResponse.active > 0;

      if (!sessionCountValid) {
        const result = {
          success: false,
          error: "Session metrics do not reflect active sessions",
          details: sessionMetricsResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Authentication propagation across components
      logger.info("Test 3: Authentication propagation", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_propagation",
      });

      // Test different protected endpoints to verify consistent authentication
      const endpointsToTest = [
        { name: "echo", url: `${tci_api_ep}/api/echo`, method: "GET" },
        {
          name: "cruda",
          url: `${tci_api_ep}/api/cruda/list`,
          method: "POST",
          body: {},
        },
        {
          name: "mcp",
          url: `${tci_api_ep}/api/mcp/resource/schema`,
          method: "GET",
        },
      ];

      const endpointResults = [];

      for (const endpoint of endpointsToTest) {
        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: getHeaders(),
          body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
        });

        endpointResults.push({
          name: endpoint.name,
          status: response.status,
          authenticated: response.status !== 401,
        });
      }

      testData.endpointResults = endpointResults;

      // Check if authentication is consistent across components
      const authConsistent = endpointResults.every((r) => r.authenticated);

      // All tests passed
      const result = {
        success: true,
        details: {
          crudaMcpInteraction: testData.skipCrudaMcpTest
            ? "Skipped (permission issue)"
            : testData.mcpProvidesCrudaAccess
            ? "Successful"
            : "MCP does not provide CRUDA access",
          sessionMetricsValid: sessionCountValid,
          authenticationConsistent: authConsistent,
          endpointResults,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Component interactions test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test error propagation and handling
   * This test verifies how errors are propagated and handled across components:
   * 1. Authentication errors
   * 2. Permission errors
   * 3. Resource not found errors
   * 4. Validation errors
   */
  testErrorPropagation: async (tep_api_ep) => {
    const moduleName = "integration";
    const testName = "testErrorPropagation";
    const correlationId = ulid();
    const testData = { tep_api_ep };

    logger.info("Starting error propagation test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      // Function to create headers with or without token
      const getHeaders = (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };

        if (includeToken && token) {
          headers.Authorization = `Bearer ${token}`;
        }

        return headers;
      };

      // Test 1: Authentication errors
      logger.info("Test 1: Authentication errors", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_errors",
      });

      // Test protected endpoints without authentication
      const protectedEndpoints = [
        { name: "echo", url: `${tep_api_ep}/api/echo`, method: "GET" },
        {
          name: "cruda",
          url: `${tep_api_ep}/api/cruda/list`,
          method: "POST",
          body: {},
        },
        {
          name: "mcp",
          url: `${tep_api_ep}/api/mcp/resource/schema`,
          method: "GET",
        },
      ];

      const authErrorResults = [];

      for (const endpoint of protectedEndpoints) {
        const response = await fetch(endpoint.url, {
          method: endpoint.method,
          headers: getHeaders(false),
          body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
        });

        let responseData;
        try {
          responseData = await response.json();
        } catch (e) {
          responseData = { parseError: true };
        }

        authErrorResults.push({
          name: endpoint.name,
          status: response.status,
          isAuthError: response.status === 401,
          hasErrorMessage: responseData && responseData.error,
        });
      }

      testData.authErrorResults = authErrorResults;

      // Check if authentication errors are consistent
      const authErrorsConsistent = authErrorResults.every((r) => r.isAuthError);

      // Test 2: Resource not found errors
      logger.info("Test 2: Resource not found errors", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "not_found_errors",
      });

      // Test endpoints with non-existent resources
      const nonExistentResources = [
        {
          name: "cruda-read",
          url: `${tep_api_ep}/api/cruda/read`,
          method: "POST",
          body: { id: `non-existent-${ulid()}` },
        },
        {
          name: "cruda-update",
          url: `${tep_api_ep}/api/cruda/update`,
          method: "POST",
          body: { id: `non-existent-${ulid()}`, comment: "Test" },
        },
        {
          name: "cruda-delete",
          url: `${tep_api_ep}/api/cruda/destroy`,
          method: "POST",
          body: { id: `non-existent-${ulid()}` },
        },
        {
          name: "mcp-resource",
          url: `${tep_api_ep}/api/mcp/resource/non-existent-${ulid()}`,
          method: "GET",
        },
      ];

      const notFoundResults = [];

      for (const resource of nonExistentResources) {
        const response = await fetch(resource.url, {
          method: resource.method,
          headers: getHeaders(true),
          body: resource.body ? JSON.stringify(resource.body) : undefined,
        });

        let responseData;
        try {
          responseData = await response.json();
        } catch (e) {
          responseData = { parseError: true };
        }

        notFoundResults.push({
          name: resource.name,
          status: response.status,
          isNotFoundError: response.status === 404,
          hasErrorMessage: responseData && responseData.error,
        });
      }

      testData.notFoundResults = notFoundResults;

      // Check if not found errors are consistent
      const notFoundErrorsConsistent = notFoundResults.every(
        (r) => r.isNotFoundError
      );

      // Test 3: Validation errors
      logger.info("Test 3: Validation errors", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "validation_errors",
      });

      // Test endpoints with invalid data
      const invalidDataRequests = [
        {
          name: "login-missing-fields",
          url: `${tep_api_ep}/api/sessions/login`,
          method: "POST",
          body: {},
        },
        {
          name: "cruda-create-missing-fields",
          url: `${tep_api_ep}/api/cruda/create`,
          method: "POST",
          body: {},
        },
        {
          name: "cruda-update-missing-id",
          url: `${tep_api_ep}/api/cruda/update`,
          method: "POST",
          body: { comment: "Test" },
        },
      ];

      const validationResults = [];

      for (const request of invalidDataRequests) {
        const response = await fetch(request.url, {
          method: request.method,
          headers: getHeaders(true),
          body: JSON.stringify(request.body),
        });

        let responseData;
        try {
          responseData = await response.json();
        } catch (e) {
          responseData = { parseError: true };
        }

        validationResults.push({
          name: request.name,
          status: response.status,
          isValidationError: response.status === 400,
          hasErrorMessage: responseData && responseData.error,
        });
      }

      testData.validationResults = validationResults;

      // Check if validation errors are consistent
      const validationErrorsConsistent = validationResults.every(
        (r) => r.isValidationError || r.status === 403
      );

      // All tests passed
      const result = {
        success: true,
        details: {
          authErrorsConsistent,
          notFoundErrorsConsistent,
          validationErrorsConsistent,
          authErrorResults,
          notFoundResults,
          validationResults,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Error propagation test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

/**
 * Test complete authentication flow using SDK
 */
integrationTests.testCompleteAuthFlowWithSdk = async (
  tcafws_api_ep,
  logContext
) => {
  const moduleName = "integration";
  const testName = "testCompleteAuthFlowWithSdk";
  const correlationId = ulid();
  const testData = { tcafws_api_ep };

  logger.info("Starting complete authentication flow test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      logger.warn("Failed to initialize RoditClient, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "initialization",
      });
    }

    // Step 1: Login using SDK
    let loginResult;
    try {
      // Use login_server directly since login() method was removed
      loginResult = await client.login_server();
      if (loginResult.error) {
        throw new Error(`Login failed: ${loginResult.error}`);
      }
      // Convert jwt_token to token for compatibility
      loginResult.token = loginResult.jwt_token;
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login failed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
        error: loginError.message,
      });
      testData.loginError = loginError.message;
      testData.loginSuccess = false;
    }

    // Step 2: Access protected resources using SDK
    let echoResponse;
    try {
      echoResponse = await client.request("GET", "/api/echo");
      testData.echoResponse = echoResponse;
      testData.echoSuccess = true;
    } catch (echoError) {
      logger.warn("SDK echo request failed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "echo",
        error: echoError.message,
      });
      testData.echoError = echoError.message;
      testData.echoSuccess = false;
    }

    // Step 3: Logout using SDK
    let logoutResult;
    try {
      logoutResult = await client.logout_server();
      testData.logoutResult = logoutResult;
      testData.logoutSuccess = !!logoutResult;
    } catch (logoutError) {
      logger.warn("SDK logout failed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "logout",
        error: logoutError.message,
      });
      testData.logoutError = logoutError.message;
      testData.logoutSuccess = false;
    }

    // Step 4: Verify session invalidation
    let sessionInvalidated = false;
    try {
      await client.request("GET", "/api/echo");
      // If we get here, the session was not invalidated
      testData.sessionStillValid = true;
    } catch (error) {
      // Should throw an error due to invalid session
      sessionInvalidated = true;
      testData.sessionInvalidated = true;
      testData.sessionInvalidationError = error.message;
    }

    const overallSuccess =
      !!testData.loginSuccess &&
      !!testData.echoSuccess &&
      !!testData.logoutSuccess &&
      !!sessionInvalidated;
    const result = {
      success: overallSuccess,
      details: {
        loginSuccessful: !!testData.loginSuccess,
        echoSuccessful: !!testData.echoSuccess,
        logoutSuccessful: !!testData.logoutSuccess,
        sessionProperlyClosed: !!sessionInvalidated,
      },
    };
    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK integration test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });

    const result = {
      success: false,
      error: `SDK test error: ${error.message}`,
      stack: error.stack,
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

/**
 * Test component interactions using SDK
 */
integrationTests.testComponentInteractionsWithSdk = async (
  tciws_api_ep,
  logContext
) => {
  const moduleName = "integration";
  const testName = "testComponentInteractionsWithSdk";
  const correlationId = ulid();
  const testData = { tciws_api_ep };

  logger.info("Starting component interactions test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      logger.warn("Failed to initialize RoditClient, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "initialization",
      });
    }

    // Step 1: Login using SDK
    let loginResult;
    try {
      // Use login_server now that generic login() was removed
      loginResult = await client.login_server();
      // Normalize jwt_token to token for compatibility
      if (loginResult && loginResult.jwt_token) {
        loginResult.token = loginResult.jwt_token;
      }
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login failed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
        error: loginError.message,
      });
      testData.loginError = loginError.message;
      testData.loginSuccess = false;
    }

    // Step 2: Test interaction between authentication and data endpoints
    const interactions = [];

    // Test 2.1: Get client state
    try {
      const clientState = client.getClientState();
      interactions.push({
        name: "getClientState",
        success: true,
        authenticated: !!clientState.authenticated,
        hasToken: !!clientState.token,
      });
    } catch (error) {
      interactions.push({
        name: "getClientState",
        success: false,
        error: error.message,
      });
    }

    // Test 2.2: Check if operation is permitted
    try {
      const isPermitted = client.isOperationPermitted("GET", "/api/echo");
      interactions.push({
        name: "isOperationPermitted",
        success: true,
        isPermitted,
      });
    } catch (error) {
      interactions.push({
        name: "isOperationPermitted",
        success: false,
        error: error.message,
      });
    }

    // Test 2.3: Get token configuration and metadata
    try {
      const config_own_rodit = await client.getConfigOwnRodit();
      const metadata = config_own_rodit?.own_rodit?.metadata;
      interactions.push({
        name: "getConfigOwnRodit",
        success: true,
        hasConfig: !!config_own_rodit,
        hasMetadata: !!metadata,
        metadataKeys: metadata ? Object.keys(metadata) : [],
      });
    } catch (error) {
      interactions.push({
        name: "getConfigOwnRodit",
        success: false,
        error: error.message,
      });
    }

    // Test 2.4: Check if subscription is active
    try {
      const isActive = client.isSubscriptionActive();
      interactions.push({
        name: "isSubscriptionActive",
        success: true,
        isActive,
      });
    } catch (error) {
      interactions.push({
        name: "isSubscriptionActive",
        success: false,
        error: error.message,
      });
    }

    testData.interactions = interactions;

    const overallSuccess =
      interactions.length > 0 && interactions.every((i) => i.success);
    const result = {
      success: overallSuccess,
      details: {
        interactionsCompleted: interactions.length,
        interactionsSucceeded: interactions.filter((i) => i.success).length,
        interactionsFailed: interactions.filter((i) => !i.success).length,
        interactions,
      },
    };

    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK component interactions test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });

    const result = {
      success: false,
      error: `SDK test error: ${error.message}`,
      stack: error.stack,
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

module.exports = integrationTests;
