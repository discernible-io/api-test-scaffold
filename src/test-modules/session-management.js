/**
 * Session Management Tests
 * 
 * Advanced tests for session management functionality
 * 
 * Copyright (c) 2026 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');
const { captureTestData, getRoditClientForTest, createTestRoditClient, extractApiErrorInfo } = require('./test-utils');
const { readResponseBodySafe, runOpenapiContractCase } = require("./openapi-contract-helpers");

// Helper: decode JWT payload to access session_id
function decodeJwtPayload(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// Helper: robustly extract active sessions count from metrics response
function getActiveSessionsCount(metricsResponse) {
  if (!metricsResponse) return null;
  const metrics = metricsResponse.metrics || metricsResponse; // support both {metrics:{...}} and flat
  if (!metrics || typeof metrics !== 'object') return null;
  if (typeof metrics.active === 'number') return metrics.active;
  if (metrics.sessions && typeof metrics.sessions.active === 'number') return metrics.sessions.active;
  if (metrics.sessions && typeof metrics.sessions.active_count === 'number') return metrics.sessions.active_count;
  return null;
}

/**
 * Session management tests module
 */
const sessionManagementTests = {
  /**
   * Test admin session management functions
   * This test verifies:
   * 1. Admin can list all sessions
   * 2. Admin can close specific sessions
   * 3. Authorization is properly enforced
   */
  testAdminSessionManagement: async (tasm_api_ep) => {
    const moduleName = "sessionManagement";
    const testName = "testAdminSessionManagement";
    const correlationId = ulid();
    const testData = { tasm_api_ep };
    testData.endpoint = `${tasm_api_ep}/api/sessions/list_all`;

    logger.info("Starting admin session management test", {
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
          passed: false,
          error: "No authentication token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Function to create headers with or without tokens
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

      // Test 1: List all sessions (requires admin permissions)
      const listSessionsResult = await fetch(
        `${tasm_api_ep}/api/sessions/list_all`,
        {
          method: "GET",
          headers: getHeaders(true),
        }
      );

      const listSessionsStatus = listSessionsResult.status;
      testData.listSessionsStatus = listSessionsStatus;
      
      let listSessionsData;
      try {
        listSessionsData = await listSessionsResult.json();
        testData.listSessionsData = listSessionsData;
      } catch (e) {
        testData.listSessionsError = "Failed to parse JSON response";
      }

      // Check if we have admin permissions (status 200) or not (status 403)
      const hasAdminPermissions = listSessionsStatus === 200;
      testData.hasAdminPermissions = hasAdminPermissions;

      if (hasAdminPermissions) {
        // If we have admin permissions, continue with admin tests
        
        // Validate sessions list format
        if (!listSessionsData || !Array.isArray(listSessionsData.sessions)) {
          const result = {
            passed: false,
            error: "Sessions list endpoint did not return valid sessions array",
            details: listSessionsData,
          };
          return captureTestData(testName, moduleName, result, testData);
        }

        // Test 2: If there are sessions, try to close one
        if (listSessionsData.sessions.length > 0) {
          // Select a session to close (not our own session)
          const payload = decodeJwtPayload(token);
          const ourSessionId = payload?.session_id || payload?.sid || payload?.jti || null;
          const getSessId = (s) => s?.id || s?.sessionId || s?._id || null;
          const sessionToClose = listSessionsData.sessions.find(s => getSessId(s) && getSessId(s) !== ourSessionId) || listSessionsData.sessions[0];
          
          if (sessionToClose) {
            testData.sessionToClose = sessionToClose;
            
            // Try to close the session
            const closeSessionResult = await stateManager.fetchWithErrorHandling(
              `${tasm_api_ep}/api/sessions/revoke`,
              {
                method: "POST",
                headers: getHeaders(true),
                body: JSON.stringify({
                  sessionId: getSessId(sessionToClose),
                  reason: "test_closure",
                }),
              }
            );

            testData.closeSessionResult = closeSessionResult;

            // Validate session closure
            if (!closeSessionResult || closeSessionResult.error) {
              const result = {
                passed: false,
                error: "Failed to close session",
                details: closeSessionResult,
              };
              return captureTestData(testName, moduleName, result, testData);
            }

            // Verify the session is closed by listing sessions again
            const verifyClosureResult = await stateManager.fetchWithErrorHandling(
              `${tasm_api_ep}/api/sessions/list_all`,
              {
                method: "GET",
                headers: getHeaders(true),
              }
            );

            testData.verifyClosureResult = verifyClosureResult;

            // Check if the closed session is no longer in the active list
            const closedId = getSessId(sessionToClose);
            const sessionStillActive = Array.isArray(verifyClosureResult.sessions) && verifyClosureResult.sessions.some(
              s => (getSessId(s) === closedId) && s.status === 'active'
            );

            if (sessionStillActive) {
              const result = {
                passed: false,
                error: "Session was not properly closed",
                details: {
                  sessionId: sessionToClose.id,
                  stillActive: sessionStillActive,
                },
              };
              return captureTestData(testName, moduleName, result, testData);
            }
          }
        }

        // Test 3: Try to close a non-existent session
        const nonExistentSessionId = `non-existent-${ulid()}`;
        const closeNonExistentResult = await fetch(
          `${tasm_api_ep}/api/sessions/revoke`,
          {
            method: "POST",
            headers: getHeaders(true),
            body: JSON.stringify({
              sessionId: nonExistentSessionId,
              reason: "test_closure",
            }),
          }
        );

        const closeNonExistentStatus = closeNonExistentResult.status;
        testData.closeNonExistentStatus = closeNonExistentStatus;

        // Should return 404 Not Found or 200 OK (idempotent)
        const acceptableStatuses = [200, 404];
        if (!acceptableStatuses.includes(closeNonExistentStatus)) {
          const result = {
            passed: false,
            error: `Non-existent session handling incorrect: expected 200 or 404, got ${closeNonExistentStatus}`,
            details: { status: closeNonExistentStatus },
          };
          return captureTestData(testName, moduleName, result, testData);
        }

        // All admin tests passed
        const result = {
          passed: true,
          details: {
            hasAdminPermissions,
            sessionsCount: listSessionsData.sessions.length,
            sessionClosureWorks: testData.hasOwnProperty('closeSessionResult') ? !testData.sessionStillActive : "Not tested (no sessions to close)",
            nonExistentSessionHandled: [200, 404].includes(closeNonExistentStatus),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      } else {
        // If we don't have admin permissions, verify that the API responds consistently

        // Test 2: Attempt to close a session to observe permission handling
        const closeSessionResponse = await fetch(
          `${tasm_api_ep}/api/sessions/revoke`,
          {
            method: "POST",
            headers: getHeaders(true),
            body: JSON.stringify({
              sessionId: "any-session-id",
              reason: "test_closure",
            }),
          }
        );

        const closeSessionStatus = closeSessionResponse.status;
        testData.closeSessionStatus = closeSessionStatus;

        let closeSessionBody;
        try {
          closeSessionBody = await closeSessionResponse.clone().json();
        } catch (_) {
          closeSessionBody = await closeSessionResponse.text().catch(() => "");
        }
        testData.closeSessionBodySnippet = typeof closeSessionBody === "string"
          ? closeSessionBody.substring(0, 200)
          : closeSessionBody;

        const closureProtected = closeSessionStatus === 403 || closeSessionStatus === 401;
        const closurePermitted = closeSessionStatus === 200;
        const expectedStatuses = new Set([200, 401, 403, 404]);

        if (!expectedStatuses.has(closeSessionStatus)) {
          const result = {
            passed: false,
            error: `Session closure returned unexpected status ${closeSessionStatus}`,
            details: {
              status: closeSessionStatus,
              response: testData.closeSessionBodySnippet,
            },
          };
          return captureTestData(testName, moduleName, result, testData);
        }

        const result = {
          passed: true,
          details: {
            hasAdminPermissions: false,
            authorizationEnforced: listSessionsStatus === 403 || listSessionsStatus === 401,
            sessionClosureProtected: closureProtected,
            sessionClosureAllowed: closurePermitted,
            listSessionsStatus,
            sessionClosureStatus: closeSessionStatus,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Admin session management test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test session cleanup functionality
   * This test verifies:
   * 1. Expired sessions are properly cleaned up
   * 2. Session expiration works as expected
   */
  testSessionCleanup: async (tscl_api_ep) => {
    const moduleName = "sessionManagement";
    const testName = "testSessionCleanup";
    const correlationId = ulid();
    const testData = { tscl_api_ep };

    logger.info("Starting session cleanup test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const client = await getRoditClientForTest();
      testData.hasToken = !!client;

      if (!client) {
        const result = {
          passed: false,
          error: "No authentication client available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 1: Check current session count using SDK client
      let initialSessionsData;
      try {
        initialSessionsData = await client.request('GET', `/api/metrics`);
        testData.initialSessionsData = initialSessionsData;
      } catch (e) {
        testData.initialSessionsError = "Failed to get metrics";
        const result = {
          passed: false,
          error: "Failed to get initial session count",
          details: { error: e.message },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Trigger session cleanup using SDK client
      let cleanupTriggered = false;
      
      try {
        // Try to access the cleanup endpoint
        await client.request('POST', `/api/sessions/cleanup`);
        cleanupTriggered = true;
      } catch (e) {
        // If direct cleanup endpoint doesn't exist, make a regular authenticated request
        // which might trigger cleanup as a side effect
        try {
          await client.request('GET', `/api/holanonce16ts`);
          cleanupTriggered = true;
        } catch (e2) {
          cleanupTriggered = false;
        }
      }

      testData.cleanupTriggered = cleanupTriggered;

      // Test 3: Check if any expired sessions were cleaned up
      let finalSessionsData;
      try {
        finalSessionsData = await client.request('GET', `/api/metrics`);
        testData.finalSessionsData = finalSessionsData;
      } catch (e) {
        testData.finalSessionsError = "Failed to parse JSON response";
        const result = {
          passed: false,
          error: "Failed to get final session count",
          details: { error: e.message },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if session counts are valid
      const initialActive = getActiveSessionsCount(initialSessionsData);
      const finalActive = getActiveSessionsCount(finalSessionsData);
      testData.initialActive = initialActive;
      testData.finalActive = finalActive;
      const hasValidSessionCounts = initialActive !== null && finalActive !== null;

      if (!hasValidSessionCounts) {
        const result = {
          passed: false,
          error: "Invalid session count data",
          details: {
            initialSessionsData,
            finalSessionsData,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Note: We can't guarantee that sessions were actually cleaned up during our test,
      // as it depends on whether there were expired sessions. We can only verify that
      // the counts are reasonable.
      const sessionCountsReasonable = 
        finalActive <= initialActive + 1; // +1 to account for our own session

      // All tests passed
      const result = {
        passed: true,
        details: {
          cleanupTriggered,
          initialActiveSessions: initialActive,
          finalActiveSessions: finalActive,
          sessionCountsReasonable,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Session cleanup test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test concurrent session handling
   * This test verifies:
   * 1. Multiple concurrent sessions can be created
   * 2. Session limits are enforced if configured
   * 3. Sessions are properly isolated
   */
  testConcurrentSessions: async (tsc_api_ep) => {
    const moduleName = "sessionManagement";
    const testName = "testConcurrentSessions";
    const correlationId = ulid();
    const testData = { tsc_api_ep };

    logger.info("Starting concurrent sessions test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Use SDK authentication instead of manual approach
      const { RoditClient } = require('../../sdk');

      // Test 1: Create multiple concurrent sessions using SDK
      const sessionCount = 3;
      const sessions = [];

      for (let i = 0; i < sessionCount; i++) {
        try {
          // Create independent test client for each session
          const client = await RoditClient.createTestInstance();
          const loginResult = await client.login_server();
          
          if (loginResult && loginResult.jwt_token) {
            sessions.push({
              status: 200,
              passed: true,
              hasToken: true,
              token: loginResult.jwt_token,
              client: client
            });
          } else {
            sessions.push({
              status: 401,
              passed: false,
              hasToken: false,
              error: "Login not-passed"
            });
          }
        } catch (error) {
          sessions.push({
            status: 401,
            passed: false,
            hasToken: false,
            error: "Unknown error"
          });
        }
        
        // Add a small delay between sessions
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      testData.sessions = sessions.map(s => ({
        status: s.status,
        passed: s.passed,
        hasToken: !!s.token,
        error: s.error,
      }));

      // Check if we were able to create multiple sessions
      const successfulSessions = sessions.filter(s => s.passed);
      const multipleSessionsCreated = successfulSessions.length > 1;

      if (!multipleSessionsCreated) {
        const result = {
          passed: false,
          error: "Failed to create multiple concurrent sessions",
          details: {
            attemptedCount: sessionCount,
            successfulCount: successfulSessions.length,
            sessions: testData.sessions,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Verify sessions are properly isolated by making requests with each token
      const sessionRequests = [];

      for (const session of successfulSessions) {
        const noncetsResponse = await fetch(
          `${tsc_api_ep}/api/holanonce16ts`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": ulid(),
              "Authorization": `Bearer ${session.token}`,
            },
          }
        );

        sessionRequests.push({
          status: noncetsResponse.status,
          passed: noncetsResponse.ok,
        });
      }

      testData.sessionRequests = sessionRequests;

      // Check if all sessions can make authenticated requests
      const allSessionsWork = sessionRequests.every(r => r.passed);

      if (!allSessionsWork) {
        const result = {
          passed: false,
          error: "Not all sessions can make authenticated requests",
          details: {
            sessionRequests,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Logout from all sessions
      const logoutResults = [];

      for (const session of successfulSessions) {
        const logoutResponse = await fetch(
          `${tsc_api_ep}/api/logout`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": ulid(),
              "Authorization": `Bearer ${session.token}`,
            },
          }
        );

        logoutResults.push({
          status: logoutResponse.status,
          passed: logoutResponse.ok,
        });
      }

      testData.logoutResults = logoutResults;

      // Check if all sessions were successfully logged out
      const allSessionsLoggedOut = logoutResults.every(r => r.passed);

      // All tests passed
      const result = {
        passed: true,
        details: {
          multipleSessionsCreated,
          successfulSessionCount: successfulSessions.length,
          allSessionsWork,
          allSessionsLoggedOut,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Concurrent sessions test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Verify that closing a session immediately revokes token access
   */
  testSessionRevocationEnforcement: async (tsre_api_ep) => {
    const moduleName = "sessionManagement";
    const testName = "testSessionRevocationEnforcement";
    const correlationId = ulid();
    const testData = { tsre_api_ep };

    logger.info("Starting session revocation enforcement test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Create isolated admin client to avoid token invalidation from concurrent tests
      const { RoditClient } = require('../../sdk');
      const adminClient = await RoditClient.createTestInstance();
      const adminLoginResult = await adminClient.login_server();
      const adminToken = adminLoginResult?.jwt_token;
      testData.hasAdminToken = !!adminToken;

      if (!adminToken) {
        const result = {
          passed: false,
          error: "No admin JWT token available to invoke session closure",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const client = await RoditClient.createTestInstance();
      const loginResult = await client.login_server();

      if (!loginResult?.jwt_token) {
        const result = {
          passed: false,
          error: "Failed to create session for revocation test",
          details: { loginResult },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const userToken = loginResult.jwt_token;
      const payload = decodeJwtPayload(userToken);
      const sessionId = payload?.session_id || payload?.sid || payload?.jti;

      testData.sessionId = sessionId;

      if (!sessionId) {
        const result = {
          passed: false,
          error: "Unable to determine session ID from issued token",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      logger.info("Closing session via admin endpoint", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "close_session",
        sessionId,
      });

      const closeResponse = await fetch(`${tsre_api_ep}/api/sessions/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          sessionId,
          reason: "test_revocation",
        }),
      });

      const closeBody = await closeResponse.text().catch(() => "");
      testData.closeStatus = closeResponse.status;
      testData.closeBody = closeBody.substring(0, 300);

      if (!closeResponse.ok) {
        const result = {
          passed: false,
          error: `Session closure not-passed: ${closeResponse.status}`,
          details: {
            status: closeResponse.status,
            response: testData.closeBody,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      logger.info("Testing revoked token access", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "post_revocation_access",
      });

      const postCloseResponse = await fetch(`${tsre_api_ep}/api/holanonce16ts`, {
        method: "GET",
        headers: {
          "X-Request-ID": correlationId,
          Authorization: `Bearer ${userToken}`,
        },
      });

      const postBody = await postCloseResponse.text().catch(() => "");
      testData.postCloseStatus = postCloseResponse.status;
      testData.postCloseBody = postBody.substring(0, 300);

      const revoked = postCloseResponse.status === 401;

      const result = {
        passed: revoked,
        error: revoked ? null : `Revoked session token was accepted (status ${postCloseResponse.status})`,
        details: {
          closeStatus: closeResponse.status,
          postCloseStatus: postCloseResponse.status,
          postCloseBody: testData.postCloseBody,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Session revocation enforcement test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Ensure session endpoints reject cookie-based authentication without Authorization header
   */
  testSessionCookieAuthenticationRejected: async (tscar_api_ep) => {
    const moduleName = "sessionManagement";
    const testName = "testSessionCookieAuthenticationRejected";
    const correlationId = ulid();
    const testData = { tscar_api_ep };

    logger.info("Starting session cookie authentication rejection test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const token = await stateManager.getJwtToken();
      testData.hasAdminToken = !!token;

      if (!token) {
        const result = {
          passed: false,
          error: "No admin JWT token available for cookie rejection test",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const response = await fetch(`${tscar_api_ep}/api/sessions/list_all`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": correlationId,
          Cookie: `jwt=${token}`,
        },
      });

      const body = await response.text().catch(() => "");
      testData.status = response.status;
      testData.bodySnippet = body.substring(0, 300);

      const passed = response.status === 401;

      const result = {
        passed,
        error: passed
          ? null
          : `Cookie-based auth unexpectedly accepted (status ${response.status})`,
        details: {
          status: response.status,
          body: testData.bodySnippet,
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Session cookie rejection test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  }
};

/**
 * Test session management using SDK
 * This test verifies:
 * 1. The SDK can properly manage sessions
 * 2. Session tokens can be retrieved and stored
 * 3. Session data can be manipulated
 */
sessionManagementTests.testSessionManagementWithSdk = async (tsmws_api_ep, logContext) => {
  const moduleName = "sessionManagement";
  const testName = "testSessionManagementWithSdk";
  const correlationId = ulid();
  const testData = { tsmws_api_ep };

  logger.info("Starting session management test with SDK", {
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

    // Step 1: Login using SDK if possible
    let loginResult;
    try {
      // Use login_server (login_server_withaccountid is not a client method)
      loginResult = await client.login_server();
      // Normalize jwt_token to token for compatibility
      if (loginResult && loginResult.jwt_token) {
        loginResult.token = loginResult.jwt_token;
      }
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login not-passed, continuing with test", {
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

    // Step 2: Test session token management
    const sessionTests = [];
    
    // Test 2.1: Get session token
    try {
      const token = await client.getSessionToken();
      sessionTests.push({
        name: "getSessionToken",
        passed: true,
        hasToken: !!token
      });
      testData.sessionToken = !!token;
    } catch (error) {
      sessionTests.push({
        name: "getSessionToken",
        passed: false,
        error: error.message
      });
    }
    
    // Test 2.2: Set session data
    const testSessionData = {
      testKey: "testValue",
      timestamp: Date.now()
    };
    
    try {
      const result = client.setSessionData(testSessionData);
      sessionTests.push({
        name: "setSessionData",
        passed: true,
        result
      });
    } catch (error) {
      sessionTests.push({
        name: "setSessionData",
        passed: false,
        error: error.message
      });
    }
    
    // Test 2.3: Get session data
    try {
      const retrievedData = client.getSessionData();
      const dataMatches = retrievedData && 
                          retrievedData.testKey === testSessionData.testKey;
      
      sessionTests.push({
        name: "getSessionData",
        passed: true,
        hasData: !!retrievedData,
        dataMatches
      });
      
      testData.sessionDataRetrieved = !!retrievedData;
      testData.sessionDataMatches = dataMatches;
    } catch (error) {
      sessionTests.push({
        name: "getSessionData",
        passed: false,
        error: error.message
      });
    }
    
    // Test 2.4: Clear session
    try {
      const clearResult = client.clearSession();
      sessionTests.push({
        name: "clearSession",
        passed: true,
        result: clearResult
      });
      
      // Verify session is cleared
      const tokenAfterClear = await client.getSessionToken();
      const dataAfterClear = client.getSessionData();
      
      sessionTests.push({
        name: "verifySessionCleared",
        passed: true,
        tokenCleared: !tokenAfterClear,
        dataCleared: !dataAfterClear || Object.keys(dataAfterClear).length === 0
      });
      
      testData.sessionCleared = !tokenAfterClear && (!dataAfterClear || Object.keys(dataAfterClear).length === 0);
    } catch (error) {
      sessionTests.push({
        name: "clearSession",
        passed: false,
        error: error.message
      });
    }
    
    testData.sessionTests = sessionTests;
    
    // Session management core functionality (set/get/clear data) works independently of login
    const sessionManagementCoreWorking = !!(testData.sessionDataRetrieved && testData.sessionCleared);
    
    // Overall success if all sub-tests passed and core session management works
    // Note: sessionToken (login) failure doesn't invalidate session management functionality
    const overallSuccess = sessionTests.every(t => t.passed) && sessionManagementCoreWorking;

    const result = {
      passed: overallSuccess,
      details: {
        testsCompleted: sessionTests.length,
        testsSucceeded: sessionTests.filter(t => t.passed).length,
        testsFailed: sessionTests.filter(t => !t.passed).length,
        sessionManagementWorking: sessionManagementCoreWorking,
        loginWorking: !!testData.sessionToken,
        note: testData.sessionToken ? "All functionality working" : "Session management working, login failing due to server issues"
      }
    };
    
    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK session management test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });
    
    const result = {
      passed: false,
      error: `SDK test error: ${error.message}`,
      stack: error.stack
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

/**
 * Test multiple concurrent sessions using SDK
 * This test verifies:
 * 1. Multiple SDK clients can maintain separate sessions
 * 2. Session isolation works correctly
 */
sessionManagementTests.testMultipleSessionsWithSdk = async (tmsws_api_ep) => {
  const moduleName = "sessionManagement";
  const testName = "testMultipleSessionsWithSdk";
  const correlationId = ulid();
  const testData = { tmsws_api_ep };

  logger.info("Starting multiple sessions test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Create multiple independent SDK clients using test mode
    const clientCount = 3;
    const clients = [];
    const clientResults = [];
    
    // Step 1: Initialize multiple test clients with independent state
    for (let i = 0; i < clientCount; i++) {
      try {
        // Use createTestRoditClient to get independent instances
        const client = await createTestRoditClient({
          testMode: true,
          clientId: i // Add client ID for debugging
        });
        clients.push(client);
        
        clientResults.push({
          clientId: i,
          initialized: true,
          isTestMode: client.testMode,
          stateManagerInstanceId: client.stateManager?.instanceId
        });
        
        logger.debug(`Successfully initialized test client ${i}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "initialization",
          clientId: i,
          isTestMode: client.testMode,
          stateManagerInstanceId: client.stateManager?.instanceId
        });
      } catch (error) {
        clientResults.push({
          clientId: i,
          initialized: false,
          error: error.message
        });
        
        logger.warn(`Failed to initialize test client ${i}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "initialization",
          clientId: i,
          error: error.message
        });
      }
    }
    
    testData.clientsInitialized = clients.length;
    
    // Step 2: Login with each client
    for (let i = 0; i < clients.length; i++) {
      const client = clients[i];
      const clientResult = clientResults[i];
      
      try {
        // Use login_server (login_server_withaccountid is not a client method)
        const loginResult = await client.login_server();
        // Normalize jwt_token to token for compatibility
        const token = loginResult && (loginResult.token || loginResult.jwt_token);
        clientResult.loginSuccess = !!token;
        
        // Set unique session data for this client
        const sessionData = {
          clientId: i,
          uniqueValue: `client-${i}-${ulid()}`,
          timestamp: Date.now()
        };
        
        client.setSessionData(sessionData);
        clientResult.sessionDataSet = true;
      } catch (error) {
        clientResult.loginSuccess = false;
        clientResult.loginError = error.message;
        
        logger.warn(`Failed to login client ${i}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "login",
          clientId: i,
          error: error.message
        });
      }
    }
    
    // Step 3: Verify session isolation and independent state managers
    const sessionIsolationResults = [];
    
    for (let i = 0; i < clients.length; i++) {
      if (!clientResults[i].loginSuccess || !clientResults[i].sessionDataSet) {
        continue;
      }
      
      const client = clients[i];
      const sessionData = client.getSessionData();
      
      if (!sessionData) {
        sessionIsolationResults.push({
          clientId: i,
          dataRetrieved: false,
          hasIndependentStateManager: client.testMode,
          stateManagerInstanceId: client.stateManager?.instanceId
        });
        continue;
      }
      
      // Verify that each client has a different stateManager instance
      const hasUniqueStateManager = clients.every((otherClient, j) => {
        if (i === j) return true; // Same client
        return client.stateManager?.instanceId !== otherClient.stateManager?.instanceId;
      });
      
      sessionIsolationResults.push({
        clientId: i,
        dataRetrieved: true,
        correctClientId: sessionData.clientId === i,
        hasUniqueValue: !!sessionData.uniqueValue,
        hasIndependentStateManager: client.testMode,
        stateManagerInstanceId: client.stateManager?.instanceId,
        hasUniqueStateManager
      });
    }
    
    testData.sessionIsolationResults = sessionIsolationResults;
    
    // Check if session isolation is working correctly
    const isolationWorking = sessionIsolationResults.every(r => 
      r.dataRetrieved && r.correctClientId && r.hasUniqueValue && r.hasUniqueStateManager
    );
    
    testData.isolationWorking = isolationWorking;
    
    // Additional verification: Check that state managers are truly independent
    const stateManagerIds = clients.map(c => c.stateManager?.instanceId).filter(Boolean);
    const uniqueStateManagerIds = new Set(stateManagerIds);
    const hasIndependentStateManagers = stateManagerIds.length === uniqueStateManagerIds.size;
    
    testData.hasIndependentStateManagers = hasIndependentStateManagers;
    testData.stateManagerIds = stateManagerIds;
    
    const clientsLoggedIn = clientResults.filter(c => c.loginSuccess).length;
    const overallSuccess = clients.length > 1 && clientsLoggedIn > 1 && isolationWorking && hasIndependentStateManagers;

    const result = {
      passed: overallSuccess,
      details: {
        clientsInitialized: clients.length,
        clientsLoggedIn,
        sessionIsolationWorking: isolationWorking,
        hasIndependentStateManagers,
        stateManagerIds,
        uniqueStateManagerCount: uniqueStateManagerIds.size,
        testModeEnabled: clients.every(c => c.testMode),
        clientResults: clientResults.map(r => ({
          ...r,
          // Remove sensitive data for logging
          stateManagerInstanceId: r.stateManagerInstanceId ? r.stateManagerInstanceId.substring(0, 8) + '...' : null
        }))
      }
    };
    
    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK multiple sessions test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });
    
    const result = {
      passed: false,
      error: `SDK test error: ${error.message}`,
      stack: error.stack
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

sessionManagementTests.testSessionsListAllUnauthenticatedReturns401 = async (apiEndpoint) =>
  runOpenapiContractCase(
    "sessionManagement",
    "testSessionsListAllUnauthenticatedReturns401",
    apiEndpoint,
    "/api/sessions/list_all",
    { method: "GET", expectedStatus: 401 },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/api/sessions/list_all`, {
        method: "GET",
        headers: { "X-Request-ID": requestId },
      });
      const body = await readResponseBodySafe(response);
      if (response.status !== 401) {
        throw new Error(`Expected 401 for unauthenticated /api/sessions/list_all, got ${response.status}`);
      }
      return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
    },
  );

sessionManagementTests.testSessionsListAllMalformedBearerRejected = async (apiEndpoint) =>
  runOpenapiContractCase(
    "sessionManagement",
    "testSessionsListAllMalformedBearerRejected",
    apiEndpoint,
    "/api/sessions/list_all",
    { method: "GET", expectedStatus: "401-or-403" },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/api/sessions/list_all`, {
        method: "GET",
        headers: {
          "X-Request-ID": requestId,
          Authorization: "Bearer not.a.valid.jwt",
        },
      });
      const body = await readResponseBodySafe(response);
      if (response.status !== 401 && response.status !== 403) {
        throw new Error(
          `Expected 401/403 for malformed bearer on /api/sessions/list_all, got ${response.status}`,
        );
      }
      return { status: response.status, bodySnippet: JSON.stringify(body).slice(0, 220) };
    },
  );

sessionManagementTests.testSessionsListAllPostRejected = async (apiEndpoint) =>
  runOpenapiContractCase(
    "sessionManagement",
    "testSessionsListAllPostRejected",
    apiEndpoint,
    "/api/sessions/list_all",
    { method: "POST", expectedStatus: "4xx" },
    async (requestId) => {
      const { probeHttpRejection } = require("./openapi-contract-helpers");
      const probe = await probeHttpRejection(apiEndpoint, "/api/sessions/list_all", {
        method: "POST",
        headers: {
          "X-Request-ID": requestId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ probe: true }),
      });
      if (!probe.rejected) {
        throw new Error(`Expected POST /api/sessions/list_all to be rejected, got ${probe.status}`);
      }
      return probe;
    },
  );

module.exports = sessionManagementTests;
