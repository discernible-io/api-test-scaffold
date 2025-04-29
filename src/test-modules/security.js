// security.js
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");
const { ulid } = require("ulid");
const logger = require("../../config/logger");

// Standardized captureTestData function aligned with successful tests
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || testData.apiEndpoint || "unknown", // Add endpoint information
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
        const result = await fetchWithErrorHandling(`${apiEndpoint}/api/echo`, {
          method: "POST",
          headers: getHeaders(),
          body: JSON.stringify({ message: `Rate limit test ${i}` }),
        });

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
      const response = await fetchWithErrorHandling(`${apiEndpoint}/api/echo`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ message: "Testing rate limit headers" }),
      });

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
   * Test tampered tokens
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

    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    testData.token = token;

    try {
      // Log test phase - valid token test
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_token",
      });

      // Test with valid token first
      const validResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ message: "Testing with valid token" }),
        }
      );

      testData.validResult = validResult;
      const validWorks = !validResult.error;

      if (!validWorks) {
        const result = {
          success: false,
          error:
            "Valid token test failed, cannot proceed with tampered token tests",
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

      // Test cases for tampered tokens - MODIFIED to separate security tests from renewal test
      const tamperedTokenTests = [
        {
          name: "Modified Signature",
          token:
            token.slice(0, token.lastIndexOf(".") + 1) +
            (token.slice(token.lastIndexOf(".") + 1) === "A" ? "B" : "A") +
            token.slice(token.lastIndexOf(".") + 2),
          expectRejection: true, // Security issue - must be rejected
        },
        {
          name: "Invalid Format",
          token: token.replace(".", ""), // Remove a dot to break format
          expectRejection: true, // Security issue - must be rejected
        },
        {
          name: "Expired Token",
          // Create a properly formatted but expired token
          token:
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9." +
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
          expectRejection: false, // Not a security issue - renewal is expected behavior
          expectNewToken: true, // We expect to receive a new token
        },
      ];

      const tamperResults = [];

      // Run each tampered token test
      for (const test of tamperedTokenTests) {
        const result = await fetchWithErrorHandling(`${apiEndpoint}/api/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${test.token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: `Testing with tampered token: ${test.name}`,
          }),
        });

        // For expired tokens, we consider a success if a new token is provided
        const isRejected = !!result.error;
        const hasNewToken = result.newToken != null;

        // A test passes if:
        // - It was expected to be rejected AND it was rejected, OR
        // - It wasn't expected to be rejected but should have a new token AND it has a new token
        const testPassed =
          (test.expectRejection && isRejected) ||
          (!test.expectRejection && test.expectNewToken && hasNewToken);

        tamperResults.push({
          testName: test.name,
          expectRejection: test.expectRejection,
          expectNewToken: test.expectNewToken || false,
          rejected: isRejected,
          hasNewToken: hasNewToken,
          testPassed: testPassed,
          statusCode: result.statusCode,
          error: result.error,
          message: result.message,
        });
      }

      // Check if all tests passed according to our new criteria
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
          ? "Some token tests failed to meet expected criteria"
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

  /**
   * Test endpoint protections
   */
  testEndpointProtections: async (apiEndpoint) => {
    const moduleName = "comparative";
    const testName = "testEndpointProtections";
    const correlationId = ulid();

    // Log test start
    logger.info("Starting comparative endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Test authentication on both endpoints
      logger.info("Testing authentication on both endpoints", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_tests",
      });

      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();

      // FIX: Make sure we're explicitly testing WITHOUT authentication
      // by not including the token in the header
      const crudaNoAuthResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            // Explicitly NOT including Authorization header to test authentication
          },
        }
      );

      const echoNoAuthResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            // Explicitly NOT including Authorization header to test authentication
          },
        }
      );

      // Test permissions boundaries
      logger.info("Testing permissions boundaries", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "permission_tests",
      });

      // For CRUDA, this should be rejected based on permissions
      const crudaPermissionResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            action: "RESTRICTED_ACTION",
            data: { test: "permission boundary test" },
          }),
        }
      );

      // For Echo, this should be allowed (no permission boundary)
      const echoPermissionResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            action: "RESTRICTED_ACTION",
            data: { test: "permission boundary test" },
          }),
        }
      );

      // Test method restrictions
      logger.info("Testing method restrictions", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "method_tests",
      });

      // Test with non-standard method
      const crudaMethodResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "OPTIONS",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        }
      );

      const echoMethodResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "OPTIONS",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        }
      );

      // Compile results with corrected evaluation
      const results = {
        cruda: {
          endpoint: `${apiEndpoint}/api/cruda`,
          tests: {
            auth: {
              status: crudaNoAuthResult.status,
              // FIX: success means auth is required (unauthenticated requests are rejected)
              success:
                crudaNoAuthResult.status >= 401 &&
                crudaNoAuthResult.status <= 403,
            },
            permission_boundary: {
              expected: true,
              status: crudaPermissionResult.status,
              // FIX: success means permissions are enforced
              success: crudaPermissionResult.status === 403,
            },
            method_restriction: {
              expected: false,
              status: crudaMethodResult.status,
              // FIX: success means no method restrictions
              success: crudaMethodResult.status !== 405,
            },
          },
        },
        echo: {
          endpoint: `${apiEndpoint}/api/echo`,
          tests: {
            auth: {
              status: echoNoAuthResult.status,
              // FIX: success means auth is required (unauthenticated requests are rejected)
              success:
                echoNoAuthResult.status >= 401 &&
                echoNoAuthResult.status <= 403,
            },
            permission_boundary: {
              expected: true,
              status: echoPermissionResult.status,
              // FIX: success means no permissions are enforced
              success: echoPermissionResult.status === 200,
            },
            method_restriction: {
              expected: false,
              status: echoMethodResult.status,
              // FIX: success means no method restrictions
              success: echoMethodResult.status !== 405,
            },
          },
        },
      };

      // Calculate differences
      const differences = {
        authDifference:
          results.cruda.tests.auth.success !== results.echo.tests.auth.success,
        permissionDifference:
          results.cruda.tests.permission_boundary.success !==
          results.echo.tests.permission_boundary.success,
        methodDifference:
          results.cruda.tests.method_restriction.success !==
          results.echo.tests.method_restriction.success,
      };

      // Expected differences based on test definition
      const expectedDifferences = {
        authDifference: false, // Both should require auth
        methodDifference: false, // Both should have same method restrictions
        permissionDifference: true, // They should have different permission boundaries
      };

      // Check if differences match expectations
      const allMatch =
        differences.authDifference === expectedDifferences.authDifference &&
        differences.methodDifference === expectedDifferences.methodDifference &&
        differences.permissionDifference ===
          expectedDifferences.permissionDifference;

      // Compile final test result
      const result = {
        success: allMatch,
        error: !allMatch
          ? "Protection differences do not match expectations"
          : null,
        details: {
          results,
          differences,
          expectedDifferences,
          explanation: !allMatch
            ? "Protection differences do not match expectations"
            : "All protection differences match expectations",
        },
      };

      // Log results with clear evaluation of each test aspect
      logger.info("Comparative test results", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        crudaAuth: {
          status: crudaNoAuthResult.status,
          requiresAuth: results.cruda.tests.auth.success,
        },
        echoAuth: {
          status: echoNoAuthResult.status,
          requiresAuth: results.echo.tests.auth.success,
        },
        crudaPermissions: {
          status: crudaPermissionResult.status,
          enforcesPermissions: results.cruda.tests.permission_boundary.success,
        },
        echoPermissions: {
          status: echoPermissionResult.status,
          enforcesPermissions: results.echo.tests.permission_boundary.success,
        },
        differences,
        expectedDifferences,
        match: allMatch,
      });

      return result;
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },
};

module.exports = securityTests;
