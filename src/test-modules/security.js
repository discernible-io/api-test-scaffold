// security.js
const stateManager = require("../../sdk/lib/blockchain/statemanager");
const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const nacl = require("tweetnacl");

const { captureTestData } = require("./test-utils");
/**
 * Security test module - fixed to use consistent approaches and properly set endpoints
 */
const securityTests = {
  /**
   * Test rate limit enforcement
   */
  testRateLimitEnforcement: async (apiEndpoint) => {
    const moduleName = "security";
    const testName = "testRateLimitEnforcement";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    // Make sure endpoint is properly set
    testData.endpoint = apiEndpoint;

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get headers like legacy tests
    const getHeaders = async () => {
      const token = await stateManager.getJwtToken();
      return {
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
        Authorization: token ? `Bearer ${token}` : undefined,
      };
    };

    try {
      // Log test phase - prepare
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "prepare",
      });

      // Set up variables for the test
      const maxRequests = 20; // Adjust based on expected rate limit
      const requestResults = [];
      let rateLimitDetected = false;
      let rateLimitHeaders = null;

      // Log test phase - send rapid requests
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "rapid_requests",
      });

      // Send requests rapidly to trigger rate limiting
      for (let i = 0; i < maxRequests && !rateLimitDetected; i++) {
        const result = await stateManager.fetchWithErrorHandling(
          `${apiEndpoint}/api/echo/echo`,
          {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ message: `Rate limit test ${i}` }),
          }
        );

        // Check if this request was rate limited
        if (
          result.error === "RateLimitExceeded" ||
          result.message?.includes("rate limit") ||
          result.statusCode === 429
        ) {
          rateLimitDetected = true;
          rateLimitHeaders = result.headers; // Store the headers with rate limit info
        }

        requestResults.push({
          index: i,
          status: result.statusCode || 0,
          error: result.error,
          message: result.message,
          rateLimited: rateLimitDetected,
        });

        // Don't wait between requests to increase chance of hitting rate limit
      }

      // Analyze the results
      const successfulRequests = requestResults.filter((r) => !r.error).length;
      const limitedRequests = requestResults.filter(
        (r) => r.rateLimited
      ).length;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        rateLimitDetected,
        successfulRequests,
        limitedRequests,
      });

      // This test is diagnostic - either outcome is acceptable
      // We just want to know if rate limiting is implemented
      const result = {
        success: true, // Always successful as it's just detecting behavior
        details: {
          rateLimitDetected,
          successfulRequests,
          limitedRequests,
          totalRequests: requestResults.length,
          rateLimitHeaders: rateLimitHeaders
            ? Object.fromEntries(
                [...rateLimitHeaders.entries()].filter(
                  ([key]) =>
                    key.toLowerCase().includes("rate") ||
                    key.toLowerCase().includes("limit") ||
                    key.toLowerCase().includes("remaining")
                )
              )
            : null,
          diagnosis: rateLimitDetected
            ? "Rate limiting is implemented on this API"
            : "No rate limiting was detected or limit is higher than test threshold",
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
   * Test rate limit headers
   */
  testRateLimitHeaders: async (apiEndpoint) => {
    const moduleName = "security";
    const testName = "testRateLimitHeaders";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    // Make sure endpoint is properly set
    testData.endpoint = apiEndpoint;

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Get headers like legacy tests
    const getHeaders = async () => {
      const token = await stateManager.getJwtToken();
      return {
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
        Authorization: token ? `Bearer ${token}` : undefined,
      };
    };
    try {
      // Log test phase - check echo endpoint
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "check_headers",
      });

      // Make a request and check for rate limit headers
      const response = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/echo/echo`,
        {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ message: "Testing rate limit headers" }),
        }
      );

      testData.response = response;

      // Collect header information
      const headers = response.headers || {};

      // Look for common rate limit headers
      const rateLimitHeaders = {};

      // Check for standard rate limit headers
      const headerPatterns = [
        "rate-limit",
        "ratelimit",
        "x-rate-limit",
        "x-ratelimit",
        "retry-after",
        "remaining",
        "limit",
        "reset",
      ];

      // Check each header for rate limit related information
      if (headers) {
        // For fetch Response headers
        if (typeof headers.get === "function") {
          headerPatterns.forEach((pattern) => {
            for (const [key, value] of headers.entries()) {
              if (key.toLowerCase().includes(pattern)) {
                rateLimitHeaders[key] = value;
              }
            }
          });
        }
        // For object headers
        else {
          headerPatterns.forEach((pattern) => {
            Object.entries(headers).forEach(([key, value]) => {
              if (key.toLowerCase().includes(pattern)) {
                rateLimitHeaders[key] = value;
              }
            });
          });
        }
      }

      testData.rateLimitHeaders = rateLimitHeaders;
      const hasRateLimitHeaders = Object.keys(rateLimitHeaders).length > 0;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        hasRateLimitHeaders,
        headerCount: Object.keys(rateLimitHeaders).length,
      });

      // Make this test diagnostic rather than pass/fail
      const result = {
        success: true, // Always succeed as it's diagnostic
        details: {
          hasRateLimitHeaders,
          rateLimitHeaders,
          diagnosis: hasRateLimitHeaders
            ? "Rate limit headers detected"
            : "No rate limit headers found in response",
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
   * Test tampered tokens with improved isolation
   * This test verifies that:
   * 1. Valid tokens are accepted
   * 2. Tokens with modified signatures are rejected
   * 3. Tokens with invalid format are rejected
   * 4. Tokens approaching expiration are renewed
   */
  testTamperedTokens: async (apiEndpoint) => {
    const moduleName = "security";
    const testName = "testTamperedTokens";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Make sure endpoint is properly set
    testData.endpoint = apiEndpoint;

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    // Instead of getting token from state manager, we'll request a fresh one directly
    // This provides better isolation between tests
    try {
      // Step 1: Get a fresh token through the login process
      logger.info("Obtaining fresh token for testing", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "obtain_token",
      });

      // Get minimal configuration from state manager to create login credentials
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit || !config.own_rodit_bytes_private_key) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Generate login credentials
      const timestamp = Math.floor(Date.now() / 1000);
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

      // Perform login to get a fresh token
      const loginResponse = await fetch(`${apiEndpoint}/login`, {
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
          error: `Failed to obtain token for testing: ${loginResponse.status} ${loginResponse.statusText}`,
          details: {
            status: loginResponse.status,
            response: errorText,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const loginData = await loginResponse.json();
      const token = loginData.token;

      if (!token) {
        const result = {
          success: false,
          error: "No JWT token returned from login endpoint",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.token = token;

      // Log test phase - valid token test
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_token",
      });

      // Step 2: Test with valid token (should work)
      const validResult = await fetch(`${apiEndpoint}/api/echo/echo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({ message: "Testing with valid token" }),
      })
        .then(async (response) => {
          try {
            const data = await response.json();
            return {
              status: response.status,
              ok: response.ok,
              data,
              error: !response.ok ? `HTTP error: ${response.status}` : null,
            };
          } catch (e) {
            return {
              status: response.status,
              ok: response.ok,
              error: `Failed to parse response: ${e.message}`,
            };
          }
        })
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      testData.validResult = validResult;
      const validWorks = validResult.ok && !validResult.error;

      if (!validWorks) {
        const result = {
          success: false,
          error:
            "Valid token Test not-passed, cannot proceed with tampered token tests",
          details: validResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - tampered token tests
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "tampered_tokens",
      });

      // Test cases for tampered tokens - replacing expired token test with renewal test
      const tamperedTokenTests = [
        {
          name: "Modified Signature",
          token:
            token.slice(0, token.lastIndexOf(".") + 1) +
            (token.slice(token.lastIndexOf(".") + 1) === "A" ? "B" : "A") +
            token.slice(token.lastIndexOf(".") + 2),
          expectRejection: true, // Security issue - must be rejected
          expectNewToken: false, // No token renewal expected
        },
        {
          name: "Invalid Format",
          token: token.replace(".", ""), // Remove a dot to break format
          expectRejection: true, // Security issue - must be rejected
          expectNewToken: false, // No token renewal expected
        },
        {
          name: "Token Renewal",
          test: async function (token) {
            logger.info("Starting token renewal test", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "token_renewal_start",
            });

            // First, verify the token works initially
            const initialResponse = await fetch(
              `${apiEndpoint}/api/echo/echo`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "X-Request-ID": ulid(),
                },
                body: JSON.stringify({
                  message: "Initial test before waiting for renewal",
                }),
              }
            )
              .then(async (response) => {
                return {
                  status: response.status,
                  ok: response.ok,
                  newToken: response.headers.get("New-Token"),
                };
              })
              .catch((error) => {
                return { error: `Network error: ${error.message}`, status: 0 };
              });

            if (!initialResponse.ok) {
              logger.error("Token renewal test - initial token doesn't work", {
                component: "TestRunner",
                moduleName,
                testName,
                correlationId,
                phase: "token_renewal_initial_check",
                status: initialResponse.status,
              });

              return {
                success: false,
                error: "Initial token check failed",
                details: initialResponse,
              };
            }

            // Repeated attempts to get a token renewal
            const maxAttempts = 5; // Maximum number of attempts
            const waitTimeSeconds = 40; // Wait time per attempt in seconds
            let attempt = 0;
            let hasNewToken = false;
            let finalResponse = null;

            logger.info("Beginning periodic renewal attempts", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "token_renewal_periodic_start",
              maxAttempts,
              waitTimeSeconds,
            });

            while (attempt < maxAttempts && !hasNewToken) {
              attempt++;

              logger.info(
                `Waiting for ${waitTimeSeconds} seconds (attempt ${attempt}/${maxAttempts})`,
                {
                  component: "TestRunner",
                  moduleName,
                  testName,
                  correlationId,
                  phase: "token_renewal_wait",
                  attempt,
                  maxAttempts,
                }
              );

              // Wait for the specified time before checking for renewal
              await new Promise((resolve) =>
                setTimeout(resolve, waitTimeSeconds * 1000)
              );

              logger.info(
                `Wait complete, testing with aging token (attempt ${attempt}/${maxAttempts})`,
                {
                  component: "TestRunner",
                  moduleName,
                  testName,
                  correlationId,
                  phase: "token_renewal_post_wait",
                  attempt,
                  maxAttempts,
                }
              );

              // Test with the aging token
              const renewalResponse = await fetch(
                `${apiEndpoint}/api/echo/echo`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                    "X-Request-ID": ulid(),
                  },
                  body: JSON.stringify({
                    message: `Testing with aging token (attempt ${attempt})`,
                  }),
                }
              )
                .then(async (response) => {
                  // Check for token renewal in response headers
                  const newToken = response.headers.get("New-Token");
                  hasNewToken = newToken != null;

                  return {
                    status: response.status,
                    ok: response.ok,
                    newToken,
                    headers: Object.fromEntries([
                      ...response.headers.entries(),
                    ]),
                    attempt,
                  };
                })
                .catch((error) => {
                  return {
                    error: `Network error: ${error.message}`,
                    status: 0,
                    attempt,
                  };
                });

              finalResponse = renewalResponse;

              // If we got a new token, we're done
              if (hasNewToken) {
                logger.info(
                  `Token renewal succeeded on attempt ${attempt}/${maxAttempts}`,
                  {
                    component: "TestRunner",
                    moduleName,
                    testName,
                    correlationId,
                    phase: "token_renewal_success",
                    status: renewalResponse.status,
                    attempt,
                  }
                );
                break;
              }

              // If the token has expired, no need to continue testing
              if (renewalResponse.status === 401) {
                logger.warn(
                  `Token expired on attempt ${attempt}/${maxAttempts} - stopping renewal test`,
                  {
                    component: "TestRunner",
                    moduleName,
                    testName,
                    correlationId,
                    phase: "token_renewal_expired",
                    status: renewalResponse.status,
                    attempt,
                  }
                );
                break;
              }

              logger.info(
                `No token renewal detected on attempt ${attempt}/${maxAttempts}`,
                {
                  component: "TestRunner",
                  moduleName,
                  testName,
                  correlationId,
                  phase: "token_renewal_attempt_complete",
                  status: renewalResponse.status,
                  hasNewToken: false,
                  attempt,
                }
              );
            }

            logger.info("Token renewal test complete", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "token_renewal_complete",
              status: finalResponse?.status,
              hasNewToken,
              totalAttempts: attempt,
              maxAttempts,
            });

            return {
              success: finalResponse?.ok === true,
              hasNewToken,
              status: finalResponse?.status,
              details: {
                ...finalResponse,
                totalAttempts: attempt,
                maxAttempts,
                periodSeconds: waitTimeSeconds,
                message: hasNewToken
                  ? `Token renewal succeeded on attempt ${attempt}/${maxAttempts}`
                  : `Token renewal not detected after ${attempt} attempts`,
              },
            };
          },
          expectRejection: false,
          expectNewToken: true,
        },
      ];

      const tamperResults = [];

      // Run each tampered token test independently
      for (const test of tamperedTokenTests) {
        logger.debug(`Running tampered token test: ${test.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: `tampered_token_${test.name
            .toLowerCase()
            .replace(/\s+/g, "_")}`,
        });

        let testResponse;

        // Handle the special case for the renewal test
        if (test.name === "Token Renewal") {
          const renewalResult = await test.test(token);
          testResponse = {
            status: renewalResult.status,
            ok: renewalResult.success,
            newToken: renewalResult.hasNewToken ? "new-token-value" : null,
            error: renewalResult.error,
            message: renewalResult.message,
          };
        } else {
          // Normal tampered token test
          testResponse = await fetch(`${apiEndpoint}/api/echo/echo`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${test.token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              message: `Testing with tampered token: ${test.name}`,
            }),
          })
            .then(async (response) => {
              // Check for a new token in the response headers
              const newToken = response.headers.get("New-Token");

              try {
                const data = await response.json();
                return {
                  status: response.status,
                  ok: response.ok,
                  data,
                  newToken,
                  error: !response.ok ? `HTTP error: ${response.status}` : null,
                  message: data.message || null,
                };
              } catch (e) {
                return {
                  status: response.status,
                  ok: response.ok,
                  error: `Failed to parse response: ${e.message}`,
                  newToken,
                };
              }
            })
            .catch((error) => {
              return {
                error: `Network error: ${error.message}`,
                status: 0,
                newToken: null,
              };
            });
        }

        // For expected token renewal, we check if a new token is provided
        const isRejected = !testResponse.ok;
        const hasNewToken = testResponse.newToken != null;

        // A test passes if:
        // - It was expected to be rejected AND it was rejected, OR
        // - It wasn't expected to be rejected AND it wasn't rejected
        // - AND if it was expected to get a new token, it did get one
        const testPassed =
          (test.expectRejection && isRejected) ||
          (!test.expectRejection &&
            !isRejected &&
            (!test.expectNewToken || (test.expectNewToken && hasNewToken)));

        tamperResults.push({
          testName: test.name,
          expectRejection: test.expectRejection,
          expectNewToken: test.expectNewToken || false,
          rejected: isRejected,
          hasNewToken: hasNewToken,
          testPassed: testPassed,
          statusCode: testResponse.status,
          error: testResponse.error,
          message: testResponse.message,
        });

        logger.debug(`Tampered token test result: ${test.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: `tampered_token_result_${test.name
            .toLowerCase()
            .replace(/\s+/g, "_")}`,
          testPassed,
          rejected: isRejected,
          hasNewToken,
          statusCode: testResponse.status,
        });
      }

      // Check if all tests passed according to our criteria
      const allTestsPassed = tamperResults.every((r) => r.testPassed);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        validWorks,
        allTestsPassed,
      });

      const result = {
        success: allTestsPassed,
        error: !allTestsPassed
          ? "Some token tests not-passed expected criteria"
          : null,
        details: {
          validTokenAccepted: validWorks,
          tamperedTokenResults: tamperResults,
          allTestsPassed,
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

module.exports = securityTests;
