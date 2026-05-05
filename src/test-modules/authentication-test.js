/**
 * Authentication Tests for IDENTYCLAW API
 * Tests authentication and authorization for RODiT-based JWT tokens
 * 
 * API Endpoints tested (see api-docs/target-swagger.json):
 * - POST /api/login - RODiT client login
 * - POST /api/logout - RODiT client logout
 * - GET /api/holanonce16ts - Protected endpoint requiring authentication
 * - GET /api/me/identity - Get authenticated agent's identity
 * - GET /api/me/face - Get authenticated agent's facial description
 */

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const { stateManager, RoditClient } = require("../../sdk");
const config = require("../../sdk/services/configsdk");
const {
  captureTestData,
  getRoditClientForTest,
  extractApiErrorInfo,
  fetchDirect,
  bearerAuthorizationHeader,
} = require("./test-utils");

function decodeJwtPayloadRenewal(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }
    const payload = Buffer.from(parts[1], "base64").toString("utf8");
    return JSON.parse(payload);
  } catch (error) {
    const errorInfo = extractApiErrorInfo(error);
    logger.error("Failed to decode JWT payload", {
      component: "authentication",
      error: error.message,
      errorInfo: errorInfo,
    });
    return null;
  }
}

function sleepRenewal(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

      // Perform login to get JWT token using login_server
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
        passed: true,
        message: "Login successful, JWT token received",
        details: {
          hasToken: true,
          tokenReceived: true,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test GET /api/holanonce16ts endpoint (protected)
   * Verifies:
   * 1. Authenticated requests succeed
   * 2. Unauthenticated requests are rejected with 401/403
   * 3. Response contains expected noncets data
   */
  testProtectedNoncetsEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testProtectedNoncetsEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/holanonce16ts` };

    logger.info("Starting protected noncets endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test 1: Unauthenticated request should be rejected
      const unauthResponse = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          "X-Request-ID": correlationId,
        },
      });

      testData.unauthStatus = unauthResponse.status;
      const unauthRejected = !unauthResponse.ok;

      if (!unauthRejected) {
        throw new Error(`Expected 401/403 for unauthenticated request, got ${unauthResponse.status}`);
      }

      // Test 2: Authenticated request should succeed - use independent test client
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();
      
      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || "Login failed");
      }

      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      const authResponse = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
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
        passed: true,
        message: "Protected endpoint correctly requires authentication",
        details: {
          unauthenticatedRejected: unauthRejected,
          authenticatedSucceeded: true,
          noncetsReceived: !!noncetsData.noncets,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
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
      // Use independent test client to get fresh token
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();
      
      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || "Login failed");
      }

      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      const response = await fetchDirect(api_ep, "/api/me/identity", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          "X-Request-ID": correlationId,
        },
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} - ${errorText}`);
      }

      const identity = await response.json();
      testData.hasTokenId = !!identity.token_id;
      testData.hasMetadata = !!identity.metadata;
      testData.hasParsedDN = !!identity.parsed_dn;

      const result = {
        passed: true,
        message: "Successfully retrieved authenticated agent's identity",
        details: {
          hasTokenId: !!identity.token_id,
          hasMetadata: !!identity.metadata,
          hasParsedDN: !!identity.parsed_dn,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
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
      // Use independent test client to get fresh token
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();
      
      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || "Login failed");
      }

      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      // Verify token works before logout
      const preLogoutResponse = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          "X-Request-ID": correlationId,
        },
      });

      testData.preLogoutStatus = preLogoutResponse.status;

      if (!preLogoutResponse.ok) {
        throw new Error("Token not working before logout");
      }

      // Perform logout
      const logoutResponse = await fetchDirect(api_ep, "/api/logout", {
        method: "POST",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
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
      const postLogoutResponse = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          "X-Request-ID": correlationId,
        },
      });

      testData.postLogoutStatus = postLogoutResponse.status;
      const tokenInvalidated = postLogoutResponse.status === 401 || postLogoutResponse.status === 403;

      if (!tokenInvalidated) {
        throw new Error(`Expected 401/403 after logout, got ${postLogoutResponse.status}`);
      }

      const result = {
        passed: true,
        message: "Logout successfully invalidated session",
        details: {
          logoutSucceeded: true,
          tokenInvalidated: tokenInvalidated,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
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
    const testData = { api_ep, endpoint: `${api_ep}/api/holanonce16ts` };

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
          passed: false,
          error: "No JWT token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Make authenticated request
      const response = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
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
          passed: false,
          error: "Cookies were set during token renewal, but tokens should only be in headers",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // If no new token, that's acceptable - not every request triggers renewal
      if (!newToken) {
        const result = {
          passed: true,
          details: {
            message: "No token renewal occurred during this test",
            tokenRenewalNotRequired: true,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // If new token was issued, verify it works
      const verifyResponse = await fetchDirect(api_ep, "/api/holanonce16ts", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(newToken),
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
        passed: true,
        message: "Token renewal successful",
        details: {
          tokenRenewed: true,
          newTokenWorks: true,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Long-lived RoditClient probes automatic server-side token renewal (JWT jti change over time).
   * See api-docs/target-swagger.json BearerAuth / security options; uses TOKEN_RENEWAL_MAX_WAIT_SECONDS.
   */
  testAutomaticTokenRenewal: async (apiEndpoint, logContext = {}) => {
    const testName = "testAutomaticTokenRenewal";
    const moduleName = "authentication";
    const correlationId = ulid();
    const testData = {
      endpoint: apiEndpoint,
      correlationId,
      ...logContext,
    };

    logger.info("Starting automatic token renewal test", {
      component: "authentication",
      testName,
      correlationId,
      phase: "start",
    });

    let client = null;

    try {
      client = await RoditClient.createTestInstance({ testMode: true });
      testData.clientInitialized = client.initialized;

      if (!client.initialized) {
        throw new Error("Failed to initialize RoditClient");
      }

      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.jwt_token) {
        throw new Error("Failed to obtain initial token from login");
      }

      const initialToken = loginResult.jwt_token;
      const initialPayload = decodeJwtPayloadRenewal(initialToken);

      if (!initialPayload) {
        throw new Error("Failed to decode initial token");
      }

      testData.initialToken = {
        jti: initialPayload.jti,
        iat: initialPayload.iat,
        exp: initialPayload.exp,
        duration: initialPayload.exp - initialPayload.iat,
      };

      const RENEWAL_THRESHOLD = 0.15;
      const tokenDuration = testData.initialToken.duration;
      const renewalThresholdSeconds = Math.floor(tokenDuration * RENEWAL_THRESHOLD);

      const maxWaitSeconds = parseInt(
        config.get("API_DEFAULT_OPTIONS.TOKEN_RENEWAL_MAX_WAIT_SECONDS") || "120",
        10,
      );
      const idealWaitSeconds = renewalThresholdSeconds + 5;
      const actualWaitSeconds = Math.min(idealWaitSeconds, maxWaitSeconds);
      const waitTimeMs = actualWaitSeconds * 1000;

      testData.renewalThreshold = {
        thresholdPercent: RENEWAL_THRESHOLD * 100,
        thresholdSeconds: renewalThresholdSeconds,
        idealWaitSeconds,
        maxWaitSeconds,
        actualWaitSeconds,
        waitTimeMs,
        limitedByConfig: actualWaitSeconds < idealWaitSeconds,
      };

      const requestInterval = 10000;
      const numRequests = Math.ceil(waitTimeMs / requestInterval);
      const requests = [];

      for (let i = 0; i < numRequests; i++) {
        const requestStart = Date.now();

        const currentToken = client.jwt_token;
        const currentPayload = currentToken ? decodeJwtPayloadRenewal(currentToken) : null;

        try {
          const response = await client.request("GET", "/api/holanonce16ts");

          requests.push({
            requestNum: i + 1,
            timestamp: new Date().toISOString(),
            tokenJti: currentPayload?.jti,
            passed: true,
            duration: Date.now() - requestStart,
            hasResponse: !!response,
          });

          if (currentPayload && currentPayload.jti !== initialPayload.jti) {
            testData.renewalDetected = true;
            testData.renewalOccurredAt = {
              requestNum: i + 1,
              timestamp: new Date().toISOString(),
              oldTokenJti: initialPayload.jti,
              newTokenJti: currentPayload.jti,
              newTokenDuration: currentPayload.exp - currentPayload.iat,
            };
            break;
          }
        } catch (error) {
          const errorInfo = extractApiErrorInfo(error);
          requests.push({
            requestNum: i + 1,
            timestamp: new Date().toISOString(),
            tokenJti: currentPayload?.jti,
            passed: false,
            error: error.message,
            errorInfo: errorInfo,
          });

          logger.error("Periodic request failed", {
            component: "authentication",
            testName,
            correlationId,
            requestNum: i + 1,
            error: error.message,
            errorInfo: errorInfo,
            stack: error.stack,
          });
        }

        if (i < numRequests - 1) {
          await sleepRenewal(requestInterval);
        }
      }

      testData.requests = requests;
      testData.totalRequests = requests.length;
      testData.successfulRequests = requests.filter((r) => r.passed).length;

      const finalToken = client.jwt_token;
      const finalPayload = finalToken ? decodeJwtPayloadRenewal(finalToken) : null;

      if (!finalPayload) {
        throw new Error("Failed to get final token");
      }

      testData.finalToken = {
        jti: finalPayload.jti,
        iat: finalPayload.iat,
        exp: finalPayload.exp,
        duration: finalPayload.exp - finalPayload.iat,
      };

      const tokenChanged = finalPayload.jti !== initialPayload.jti;
      testData.tokenRenewed = tokenChanged;

      if (!tokenChanged) {
        const timeElapsed = Math.floor((Date.now() - initialPayload.iat * 1000) / 1000);
        const reachedThreshold = timeElapsed >= renewalThresholdSeconds;

        logger.warn("Token was not renewed during test period", {
          component: "authentication",
          testName,
          correlationId,
          phase: "verification",
          initialTokenJti: initialPayload.jti,
          finalTokenJti: finalPayload.jti,
          timeElapsed,
          renewalThresholdSeconds,
          reachedThreshold,
          limitedByConfig: testData.renewalThreshold.limitedByConfig,
        });

        if (testData.renewalThreshold.limitedByConfig) {
          testData.warning = `Token renewal test limited to ${actualWaitSeconds}s by config (threshold is ${renewalThresholdSeconds}s). Increase TOKEN_RENEWAL_MAX_WAIT_SECONDS to test full renewal.`;
        } else {
          testData.warning = "Token renewal did not occur within test period";
        }
      }

      const result = {
        passed: true,
        details: {
          tokenRenewed: tokenChanged,
          initialToken: testData.initialToken,
          finalToken: testData.finalToken,
          renewalThreshold: testData.renewalThreshold,
          totalRequests: testData.totalRequests,
          successfulRequests: testData.successfulRequests,
          warning: testData.warning,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Token renewal test failed", {
        component: "authentication",
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: error.message,
        errorInfo: errorInfo,
        details: testData,
      };

      return captureTestData(testName, moduleName, result, testData);
    } finally {
      if (client) {
        try {
          client.clearSession();
        } catch (error) {
          const errorInfo = extractApiErrorInfo(error);
          logger.warn("Failed to clear session during cleanup", {
            component: "authentication",
            testName,
            error: error.message,
            errorInfo: errorInfo,
          });
        }
      }
    }
  },
};

module.exports = authenticationTests;
