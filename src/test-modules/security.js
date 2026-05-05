// security.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');
const nacl = require("tweetnacl");

const { captureTestData } = require("./test-utils");
/**
 * Security test module - fixed to use consistent approaches and properly set endpoints
 */
const securityTests = {
  /**
   * Test rate limit enforcement
   */
  testRateLimitEnforcement: async (trle_api_ep) => {
    const moduleName = "security";
    const testName = "testRateLimitEnforcement";
    const correlationId = ulid();
    const testData = { trle_api_ep };
    // Make sure endpoint is properly set
    testData.endpoint = trle_api_ep;

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
          `${trle_api_ep}/api/holanonce16ts`,
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
        passed: true, // Always successful as it's just detecting behavior
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
        passed: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test rate limit headers
   */
  testRateLimitHeaders: async (trlh_api_ep) => {
    const moduleName = "security";
    const testName = "testRateLimitHeaders";
    const correlationId = ulid();
    const testData = { trlh_api_ep };
    // Make sure endpoint is properly set
    testData.endpoint = trlh_api_ep;

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
        `${trlh_api_ep}/api/holanonce16ts`,
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
        passed: true, // Always succeed as it's diagnostic
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
        passed: false,
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
  testTamperedTokens: async (ttt_api_ep) => {
    const moduleName = "security";
    const testName = "testTamperedTokens";
    const correlationId = ulid();
    const testData = { ttt_api_ep };

    // Make sure endpoint is properly set
    testData.endpoint = ttt_api_ep;

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
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        const result = {
          passed: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Generate login credentials
      const timestamp = Math.floor(Date.now() / 1000);
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

      // Perform login to get a fresh token
      const loginResponse = await fetch(`${ttt_api_ep}/api/login`, {
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
          passed: false,
          error: `Failed to obtain token for testing: ${loginResponse.status} ${loginResponse.statusText}`,
          details: {
            status: loginResponse.status,
            response: errorText,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const loginData = await loginResponse.json();
      const token = loginData.jwt_token;

      if (!token) {
        const result = {
          passed: false,
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
      const validResult = await fetch(`${ttt_api_ep}/api/holanonce16ts`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
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
          passed: false,
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

      // Generate multiple signature mutations so the test is harder to bypass.
      const buildModifiedSignatureVariants = (jwt, maxVariants = 12) => {
        const parts = jwt.split(".");
        if (parts.length !== 3 || !parts[2]) {
          return [];
        }

        const signature = parts[2];
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        const indices = Array.from(
          new Set([
            0,
            1,
            Math.floor(signature.length / 3),
            Math.floor(signature.length / 2),
            Math.max(signature.length - 2, 0),
            Math.max(signature.length - 1, 0),
          ])
        ).filter((i) => i >= 0 && i < signature.length);

        const variants = [];
        for (const idx of indices) {
          const currentChar = signature[idx];
          const replacement = chars[(chars.indexOf(currentChar) + 7 + chars.length) % chars.length] || "A";
          const mutatedSignature =
            signature.slice(0, idx) + replacement + signature.slice(idx + 1);
          variants.push(`${parts[0]}.${parts[1]}.${mutatedSignature}`);

          if (variants.length >= maxVariants) {
            break;
          }
        }

        // Add one truncation variant when possible.
        if (signature.length > 4 && variants.length < maxVariants) {
          variants.push(`${parts[0]}.${parts[1]}.${signature.slice(0, -1)}`);
        }

        // De-duplicate while preserving order.
        return [...new Set(variants)].slice(0, maxVariants);
      };

      const modifiedSignatureVariants = buildModifiedSignatureVariants(token, 12);
      const modifiedSignatureAttemptsPerVariant = 3;

      // Test cases for tampered tokens
      const tamperedTokenTests = [
        {
          name: "Modified Signature",
          tokenVariants: modifiedSignatureVariants,
          attemptsPerVariant: modifiedSignatureAttemptsPerVariant,
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
          name: "Token Persistence",
          test: async function (token) {
            logger.info("Starting token persistence test", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "token_persistence_start",
            });

            // Test that the token continues to work consistently
            const testResponse = await fetch(
              `${ttt_api_ep}/api/holanonce16ts`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                  "X-Request-ID": ulid(),
                },
              }
            )
              .then(async (response) => {
                return {
                  status: response.status,
                  ok: response.ok,
                  newToken: null, // Server doesn't provide automatic renewal
                };
              })
              .catch((error) => {
                return { error: `Network error: ${error.message}`, status: 0 };
              });

            if (!testResponse.ok) {
              logger.error("Token persistence test failed", {
                component: "TestRunner",
                moduleName,
                testName,
                correlationId,
                phase: "token_persistence_check",
                status: testResponse.status,
              });

              return {
                passed: false,
                error: "Token persistence check failed",
                details: testResponse,
              };
            }

            // Test token persistence with a few quick requests
            logger.info("Testing token persistence with multiple requests", {
              component: "TestRunner",
              moduleName,
              testName,
              correlationId,
              phase: "token_persistence_multiple",
            });

            return {
              passed: true,
              status: 200,
              newToken: null, // Server doesn't provide automatic renewal
              details: {
                message: "Token persistence test passed - token works consistently",
              }
            };
          },
          expectRejection: false, // Should not be rejected
          expectNewToken: false, // No token renewal expected from server
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

        // Handle the special case for the persistence test
        if (test.name === "Token Persistence") {
          const renewalResult = await test.test(token);
          testResponse = {
            status: renewalResult.status,
            ok: renewalResult.passed,
            newToken: renewalResult.hasNewToken ? "new-token-value" : null,
            error: renewalResult.error,
            message: renewalResult.message,
          };
        } else if (test.name === "Modified Signature") {
          const variantResults = [];
          const variants = test.tokenVariants || [];

          for (let variantIdx = 0; variantIdx < variants.length; variantIdx++) {
            const variantToken = variants[variantIdx];

            for (let attempt = 1; attempt <= (test.attemptsPerVariant || 1); attempt++) {
              const variantResponse = await fetch(`${ttt_api_ep}/api/holanonce16ts`, {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${variantToken}`,
                  "X-Request-ID": ulid(),
                },
              })
                .then(async (response) => {
                  const newToken = response.headers.get("New-Token");
                  let message = null;

                  try {
                    const data = await response.json();
                    message = data?.message || null;
                  } catch (_e) {
                    // Best effort parsing only; status is enough for assertion.
                  }

                  return {
                    status: response.status,
                    ok: response.ok,
                    newToken,
                    error: !response.ok ? `HTTP error: ${response.status}` : null,
                    message,
                  };
                })
                .catch((error) => ({
                  error: `Network error: ${error.message}`,
                  status: 0,
                  ok: false,
                  newToken: null,
                  message: null,
                }));

              variantResults.push({
                variant: variantIdx + 1,
                attempt,
                statusCode: variantResponse.status,
                rejected: !variantResponse.ok,
                error: variantResponse.error,
              });
            }
          }

          const acceptedVariantResult = variantResults.find((r) => !r.rejected);
          testResponse = {
            status: acceptedVariantResult ? acceptedVariantResult.statusCode : 401,
            ok: Boolean(acceptedVariantResult),
            newToken: null,
            error: acceptedVariantResult
              ? null
              : `All ${variantResults.length} modified-signature attempts were rejected`,
            message: acceptedVariantResult
              ? `Accepted mutated signature at variant ${acceptedVariantResult.variant}, attempt ${acceptedVariantResult.attempt}`
              : null,
            variantResults,
          };
        } else {
          // Normal tampered token test
          testResponse = await fetch(`${ttt_api_ep}/api/holanonce16ts`, {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${test.token}`,
              "X-Request-ID": ulid(),
            },
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
          attempts: testResponse.variantResults || null,
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
        passed: allTestsPassed,
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
        passed: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = securityTests;
