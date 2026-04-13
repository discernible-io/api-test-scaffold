/**
 * Authentication Tests for IDENTYCLAW API
 * Tests authentication and authorization for RODiT-based JWT tokens
 * 
 * API Endpoints tested (from swagger.json):
 * - POST /api/login - RODiT client login
 * - POST /api/logout - RODiT client logout
 * - GET /api/noncets - Protected endpoint requiring authentication
 * - GET /api/me/identity - Get authenticated agent's identity
 * - GET /api/me/face - Get authenticated agent's facial description
 */

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const { stateManager } = require("../../sdk");
const { captureTestData, getRoditClientForTest } = require("./test-utils");

const authenticationTests = {
  /**
   * Test POST /api/login endpoint
   * Verifies:
   * 1. Valid RODiT credentials result in successful login
   * 2. JWT token is returned
   * 3. Token can be used for authenticated requests
   */
  testLoginEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testLoginEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/login` };

    logger.info("Starting login endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Use independent test client - create and login
      const client = await getRoditClientForTest();
      
      // Perform login to get JWT token
      const loginResult = await client.login_server();
      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || "Login failed");
      }

      // Verify we have a JWT token
      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      testData.hasToken = true;
      testData.tokenLength = jwt_token.length;

      const result = {
        success: true,
        message: "Login successful, JWT token received",
        details: {
          hasToken: true,
          tokenReceived: true,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test GET /api/noncets endpoint (protected)
   * Verifies:
   * 1. Authenticated requests succeed
   * 2. Unauthenticated requests are rejected with 401/403
   * 3. Response contains expected noncets data
   */
  testProtectedNoncetsEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testProtectedNoncetsEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/noncets` };

    logger.info("Starting protected noncets endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test 1: Unauthenticated request should fail
      const unauthResponse = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "X-Request-ID": correlationId,
        },
      });

      testData.unauthStatus = unauthResponse.status;
      const unauthRejected = unauthResponse.status === 401 || unauthResponse.status === 403;

      if (!unauthRejected) {
        throw new Error(`Expected 401/403 for unauthenticated request, got ${unauthResponse.status}`);
      }

      // Test 2: Authenticated request should succeed
      const jwt_token = await stateManager.getJwtToken();
      
      if (!jwt_token) {
        throw new Error("No JWT token available for authenticated test");
      }

      const authResponse = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.authStatus = authResponse.status;

      if (!authResponse.ok) {
        const errorText = await authResponse.text();
        throw new Error(`Authenticated request failed: ${authResponse.status} - ${errorText}`);
      }

      const noncetsData = await authResponse.json();
      testData.hasNoncets = !!noncetsData.noncets;
      testData.hasTimestamp = !!noncetsData.timestamp;

      const result = {
        success: true,
        message: "Protected endpoint correctly requires authentication",
        details: {
          unauthenticatedRejected: unauthRejected,
          authenticatedSucceeded: true,
          noncetsReceived: !!noncetsData.noncets,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test GET /api/me/identity endpoint (protected)
   * Verifies:
   * 1. Returns authenticated agent's own identity
   * 2. Response includes token metadata and parsed DN
   */
  testMeIdentityEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testMeIdentityEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/me/identity` };

    logger.info("Starting /api/me/identity test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const jwt_token = await stateManager.getJwtToken();
      
      if (!jwt_token) {
        throw new Error("No JWT token available");
      }

      const response = await fetch(`${api_ep}/api/me/identity`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await authResponse.text();
        throw new Error(`Request failed: ${response.status} - ${errorText}`);
      }

      const identity = await response.json();
      testData.hasTokenId = !!identity.token_id;
      testData.hasMetadata = !!identity.metadata;
      testData.hasParsedDN = !!identity.parsed_dn;

      const result = {
        success: true,
        message: "Successfully retrieved authenticated agent's identity",
        details: {
          hasTokenId: !!identity.token_id,
          hasMetadata: !!identity.metadata,
          hasParsedDN: !!identity.parsed_dn,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test GET /api/me/face endpoint (protected)
   * Verifies:
   * 1. Returns facial description for authenticated agent's token_id
   * 2. Response includes checksumValid and categories
   */
  testMeFaceEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testMeFaceEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/me/face` };

    logger.info("Starting /api/me/face test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const jwt_token = await stateManager.getJwtToken();
      
      if (!jwt_token) {
        throw new Error("No JWT token available");
      }

      const response = await fetch(`${api_ep}/api/me/face`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} - ${errorText}`);
      }

      const faceData = await response.json();
      testData.hasChecksumValid = faceData.hasOwnProperty('checksumValid');
      testData.hasCategories = !!faceData.categories;

      const result = {
        success: true,
        message: "Successfully retrieved facial description",
        details: {
          checksumValid: faceData.checksumValid,
          hasCategories: !!faceData.categories,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test POST /api/logout endpoint
   * Verifies:
   * 1. Logout invalidates the current session
   * 2. Subsequent requests with the old token are rejected
   */
  testLogoutEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testLogoutEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/logout` };

    logger.info("Starting logout endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const jwt_token = await stateManager.getJwtToken();
      
      if (!jwt_token) {
        throw new Error("No JWT token available for logout test");
      }

      // Verify token works before logout
      const preLogoutResponse = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.preLogoutStatus = preLogoutResponse.status;

      if (!preLogoutResponse.ok) {
        throw new Error("Token not working before logout");
      }

      // Perform logout
      const logoutResponse = await fetch(`${api_ep}/api/logout`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
        },
      });

      testData.logoutStatus = logoutResponse.status;

      if (!logoutResponse.ok) {
        const errorText = await logoutResponse.text();
        throw new Error(`Logout failed: ${logoutResponse.status} - ${errorText}`);
      }

      // Verify token no longer works after logout
      const postLogoutResponse = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.postLogoutStatus = postLogoutResponse.status;
      const tokenInvalidated = postLogoutResponse.status === 401 || postLogoutResponse.status === 403;

      if (!tokenInvalidated) {
        throw new Error(`Expected 401/403 after logout, got ${postLogoutResponse.status}`);
      }

      const result = {
        success: true,
        message: "Logout successfully invalidated session",
        details: {
          logoutSucceeded: true,
          tokenInvalidated: tokenInvalidated,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test token renewal mechanism
   * Verifies:
   * 1. New tokens are issued in New-Token header when appropriate
   * 2. Renewed tokens work for subsequent requests
   */
  testTokenRenewal: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testTokenRenewal";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/noncets` };

    logger.info("Starting token renewal test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const jwt_token = await stateManager.getJwtToken();
      
      if (!jwt_token) {
        const result = {
          success: false,
          error: "No JWT token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Make authenticated request
      const response = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${jwt_token}`,
          "X-Request-ID": correlationId,
        },
      });

      // Check for new token in header
      const newToken = response.headers.get("New-Token");
      testData.hasNewToken = !!newToken;

      // Check that cookies were NOT set (tokens should only be in headers)
      const cookies = response.headers.get("set-cookie");
      testData.hasCookies = !!cookies;

      if (cookies) {
        const result = {
          success: false,
          error: "Cookies were set during token renewal, but tokens should only be in headers",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // If no new token, that's acceptable - not every request triggers renewal
      if (!newToken) {
        const result = {
          success: true,
          details: {
            message: "No token renewal occurred during this test",
            tokenRenewalNotRequired: true,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // If new token was issued, verify it works
      const verifyResponse = await fetch(`${api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${newToken}`,
          "X-Request-ID": correlationId,
        },
      });

      testData.newTokenWorks = verifyResponse.ok;

      if (!verifyResponse.ok) {
        throw new Error("Renewed token does not work");
      }

      // Store the new token
      await stateManager.setJwtToken(newToken);

      const result = {
        success: true,
        message: "Token renewal successful",
        details: {
          tokenRenewed: true,
          newTokenWorks: true,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const result = {
        success: false,
        error: error.message,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = authenticationTests;
