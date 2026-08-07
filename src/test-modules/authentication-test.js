/**
 * Authentication Tests for RODiT Authentication API
 * Tests authentication and authorization for RODiT-based JWT tokens
 * 
 * API Endpoints tested (see api-docs/target-swagger.json / slc-swagger.json):
 * - POST /api/login - RODiT client login
 * - POST /api/logout - RODiT client logout
 * - Protected probe path (API_DEFAULT_OPTIONS.PROTECTED_PROBE_PATH, default /api/holanonce16ts;
 *   SLC uses /api/token/claims)
 * - GET /api/me/identity - Get authenticated agent's identity (identyclaw; not in slc-swagger)
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
  hasRenewalHeadroomJwtPayload,
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

function protectedProbePath() {
  const fromConfig = config.get("API_DEFAULT_OPTIONS.PROTECTED_PROBE_PATH");
  if (typeof fromConfig === "string" && fromConfig.trim()) {
    const path = fromConfig.trim();
    return path.startsWith("/") ? path : `/${path}`;
  }
  return "/api/holanonce16ts";
}

function credentialRenewalObserved(initialPayload, candidateToken) {
  if (!initialPayload || !candidateToken) {
    return { renewed: false };
  }
  const payload = decodeJwtPayloadRenewal(candidateToken);
  if (!payload) {
    return { renewed: false };
  }
  const jtiChanged = payload.jti !== initialPayload.jti;
  const expExtended = Number(payload.exp) > Number(initialPayload.exp);
  return {
    renewed: jtiChanged || expExtended,
    payload,
    jtiChanged,
    expExtended,
  };
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
        throw new Error(loginResult?.error || "Login not-passed");
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
   * Test protected probe endpoint (PROTECTED_PROBE_PATH; default /api/holanonce16ts, SLC: /api/token/claims)
   * Verifies:
   * 1. Authenticated requests succeed
   * 2. Unauthenticated requests are rejected with 401/403
   */
  testProtectedNoncetsEndpoint: async (api_ep) => {
    const moduleName = "authentication";
    const testName = "testProtectedNoncetsEndpoint";
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}${protectedProbePath()}` };

    logger.info("Starting protected noncets endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Test 1: Unauthenticated request should be rejected
      const unauthResponse = await fetchDirect(api_ep, protectedProbePath(), {
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
        throw new Error(loginResult?.error || "Login not-passed");
      }

      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      const authResponse = await fetchDirect(api_ep, protectedProbePath(), {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          "X-Request-ID": correlationId,
        },
      });

      testData.authStatus = authResponse.status;

      if (!authResponse.ok) {
        const errorText = await authResponse.text();
        throw new Error(`Authenticated request not-passed: ${authResponse.status} - ${errorText}`);
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
        throw new Error(loginResult?.error || "Login not-passed");
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
        throw new Error(`Request not-passed: ${response.status} - ${errorText}`);
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
        throw new Error(loginResult?.error || "Login not-passed");
      }

      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        throw new Error("No JWT token received after login");
      }

      // Verify token works before logout
      const preLogoutResponse = await fetchDirect(api_ep, protectedProbePath(), {
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
        throw new Error(`Logout not-passed: ${logoutResponse.status} - ${errorText}`);
      }

      // Verify token no longer works after logout
      const postLogoutResponse = await fetchDirect(api_ep, protectedProbePath(), {
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
    const testData = { api_ep, endpoint: `${api_ep}${protectedProbePath()}` };

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
      const response = await fetchDirect(api_ep, protectedProbePath(), {
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
      const verifyResponse = await fetchDirect(api_ep, protectedProbePath(), {
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
   * Probes automatic server-side credential renewal on a protected route until LAPSED eligibility.
   * Login via RoditClient (SDK-first); liveness polls use client.stateManager.fetchWithErrorHandling
   * so New-Token absorption matches real client behavior (RoditClient.request omits header handling).
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
      client = await getRoditClientForTest({ testMode: true });
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
        session_exp: initialPayload.session_exp,
        duration: initialPayload.exp - initialPayload.iat,
      };

      if (!hasRenewalHeadroomJwtPayload(initialPayload)) {
        return captureTestData(
          testName,
          moduleName,
          {
            passed: true,
            message:
              "Dual-clock collapsed on deployment; credential renewal extension not testable",
            details: {
              skipped: true,
              reason: "dual_clock_collapsed",
              sessionExp: initialPayload.session_exp,
              credentialExp: initialPayload.exp,
              whatHappened:
                "session_exp equals credential exp; renewal may issue New-Token but cannot extend exp until server SESSION_TTL exceeds credential TTL",
            },
          },
          testData
        );
      }

      const lapsed = parseFloat(
        config.get("SECURITY_OPTIONS.LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY") ||
          "0.80"
      );
      const tokenDuration = testData.initialToken.duration;
      // LAPSED=0.8 means eligible after 80% of credential lifetime elapsed (server-side).
      const eligibilitySeconds = Math.floor(tokenDuration * lapsed) + 2;

      let maxWaitSeconds = parseInt(
        config.get("API_DEFAULT_OPTIONS.TOKEN_RENEWAL_MAX_WAIT_SECONDS") || "120",
        10
      );
      if (maxWaitSeconds < eligibilitySeconds + 15) {
        maxWaitSeconds = Math.min(tokenDuration + 120, eligibilitySeconds + 180);
      }

      testData.renewalThreshold = {
        lapsedProportion: lapsed,
        eligibilitySeconds,
        maxWaitSeconds,
        tokenDurationSeconds: tokenDuration,
        extendedWaitBudget: maxWaitSeconds > parseInt(
          config.get("API_DEFAULT_OPTIONS.TOKEN_RENEWAL_MAX_WAIT_SECONDS") || "120",
          10
        ),
      };

      const requestInterval = 10000;
      const deadlineMs = Date.now() + maxWaitSeconds * 1000;
      const requests = [];
      let activeToken = initialToken;
      let tokenChanged = false;

      const probeUrl = `${apiEndpoint}${protectedProbePath()}`;

      while (Date.now() < deadlineMs) {
        const requestStart = Date.now();
        const tokenBefore = await client.getSessionToken();
        const probePayload = decodeJwtPayloadRenewal(tokenBefore || activeToken);

        const probeResult = await client.stateManager.fetchWithErrorHandling(probeUrl, {
          method: "GET",
          headers: {
            "X-Request-ID": ulid(),
          },
        });

        const tokenAfter = (await client.getSessionToken()) || tokenBefore || activeToken;
        const sessionTokenUpdated = tokenAfter !== tokenBefore;
        const renewalObserved = credentialRenewalObserved(initialPayload, tokenAfter);
        const probePassed = !(probeResult && probeResult.error);

        requests.push({
          requestNum: requests.length + 1,
          timestamp: new Date().toISOString(),
          tokenJti: probePayload?.jti,
          tokenExp: probePayload?.exp,
          passed: probePassed,
          status: probeResult?.statusCode || (probePassed ? 200 : null),
          duration: Date.now() - requestStart,
          sessionTokenUpdated,
          probeError: probeResult?.error || null,
        });

        if (!probePassed) {
          logger.error("Periodic renewal probe not-passed", {
            component: "authentication",
            testName,
            correlationId,
            requestNum: requests.length,
            status: probeResult?.statusCode,
            error: probeResult?.error,
            message: probeResult?.message,
          });
        } else if (renewalObserved.renewed) {
          tokenChanged = true;
          activeToken = tokenAfter;
          testData.renewalDetected = true;
          testData.renewalOccurredAt = {
            requestNum: requests.length,
            timestamp: new Date().toISOString(),
            oldTokenJti: initialPayload.jti,
            newTokenJti: renewalObserved.payload.jti,
            oldTokenExp: initialPayload.exp,
            newTokenExp: renewalObserved.payload.exp,
            renewalViaJtiChange: renewalObserved.jtiChanged,
            renewalViaExpExtension: renewalObserved.expExtended,
            renewalViaSessionToken: true,
          };
          break;
        } else if (sessionTokenUpdated) {
          activeToken = tokenAfter;
        }

        const timeElapsed = Math.floor((Date.now() - initialPayload.iat * 1000) / 1000);
        if (timeElapsed >= eligibilitySeconds && tokenChanged) {
          break;
        }

        if (Date.now() + requestInterval >= deadlineMs) {
          break;
        }
        await sleepRenewal(requestInterval);
      }

      testData.requests = requests;
      testData.totalRequests = requests.length;
      testData.successfulRequests = requests.filter((r) => r.passed).length;
      testData.activeCredentialToken = activeToken;

      const finalPayload = decodeJwtPayloadRenewal(activeToken);

      if (!finalPayload) {
        throw new Error("Failed to decode final credential token");
      }

      testData.finalToken = {
        jti: finalPayload.jti,
        iat: finalPayload.iat,
        exp: finalPayload.exp,
        duration: finalPayload.exp - finalPayload.iat,
      };

      const tokenChangedFinal =
        tokenChanged ||
        finalPayload.jti !== initialPayload.jti ||
        Number(finalPayload.exp) > Number(initialPayload.exp);
      testData.tokenRenewed = tokenChangedFinal;

      const timeElapsed = Math.floor((Date.now() - initialPayload.iat * 1000) / 1000);
      const reachedEligibility = timeElapsed >= eligibilitySeconds;
      testData.timeElapsedSeconds = timeElapsed;
      testData.reachedEligibility = reachedEligibility;

      let passed = true;
      let error = null;
      let warning = null;

      if (!tokenChangedFinal) {
        if (reachedEligibility) {
          passed = false;
          error = `No token renewal observed after ${timeElapsed}s (eligibility ~${eligibilitySeconds}s at LAPSED=${lapsed})`;
        } else {
          warning = `Observed ${timeElapsed}s before deadline (${maxWaitSeconds}s); eligibility at ${eligibilitySeconds}s not reached`;
          logger.warn("Token renewal not observed before wait budget exhausted", {
            component: "authentication",
            testName,
            correlationId,
            phase: "verification",
            timeElapsed,
            eligibilitySeconds,
            maxWaitSeconds,
          });
        }
      }

      const result = {
        passed,
        error,
        details: {
          tokenRenewed: tokenChangedFinal,
          initialToken: testData.initialToken,
          finalToken: testData.finalToken,
          renewalThreshold: testData.renewalThreshold,
          totalRequests: testData.totalRequests,
          successfulRequests: testData.successfulRequests,
          timeElapsedSeconds: timeElapsed,
          reachedEligibility,
          warning,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Token renewal test not-passed", {
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
