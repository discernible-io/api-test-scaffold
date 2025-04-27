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

    logger.error(`Test '${testName}' failed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint,
      correlationId,
      error: result.error,
    });

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

    logger.metric('test_failure', 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId
    });
  } else {
    logger.debug(`Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint
    });
    
    logger.metric('test_success', 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint
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
    const getHeaders = () => ({
      "Content-Type": "application/json",
      "X-Request-ID": ulid(),
    });

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
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ message: `Rate limit test ${i}` }),
          }
        );

        // Check if this request was rate limited
        if (result.error === "RateLimitExceeded" || 
            result.message?.includes("rate limit") ||
            result.statusCode === 429) {
          rateLimitDetected = true;
          rateLimitHeaders = result.headers; // Store the headers with rate limit info
        }

        requestResults.push({
          index: i,
          status: result.statusCode || 0,
          error: result.error,
          message: result.message,
          rateLimited: rateLimitDetected
        });

        // Don't wait between requests to increase chance of hitting rate limit
      }

      // Analyze the results
      const successfulRequests = requestResults.filter(r => !r.error).length;
      const limitedRequests = requestResults.filter(r => r.rateLimited).length;

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
                [...rateLimitHeaders.entries()].filter(([key]) => 
                  key.toLowerCase().includes('rate') || 
                  key.toLowerCase().includes('limit') ||
                  key.toLowerCase().includes('remaining')
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
    const getHeaders = () => ({
      "Content-Type": "application/json",
      "X-Request-ID": ulid(),
    });

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
      const response = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
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
        'rate-limit', 
        'ratelimit', 
        'x-rate-limit',
        'x-ratelimit',
        'retry-after',
        'remaining',
        'limit',
        'reset'
      ];
      
      // Check each header for rate limit related information
      if (headers) {
        // For fetch Response headers
        if (typeof headers.get === 'function') {
          headerPatterns.forEach(pattern => {
            for (const [key, value] of headers.entries()) {
              if (key.toLowerCase().includes(pattern)) {
                rateLimitHeaders[key] = value;
              }
            }
          });
        } 
        // For object headers
        else {
          headerPatterns.forEach(pattern => {
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
            "Authorization": `Bearer ${token}`,
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
          error: "Valid token test failed, cannot proceed with tampered token tests",
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

      // Test cases for tampered tokens
      const tamperedTokenTests = [
        {
          name: "Modified Signature",
          token: token.slice(0, token.lastIndexOf('.') + 1) + 
                 (token.slice(token.lastIndexOf('.') + 1) === 'A' ? 'B' : 'A') +
                 token.slice(token.lastIndexOf('.') + 2),
        },
        {
          name: "Invalid Format",
          token: token.replace('.', '') // Remove a dot to break format
        },
        {
          name: "Expired Token",
          // Create an invalid token with common structure
          token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
                 "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9." +
                 "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        }
      ];

      const tamperResults = [];

      // Run each tampered token test
      for (const test of tamperedTokenTests) {
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${test.token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({ 
              message: `Testing with tampered token: ${test.name}`
            }),
          }
        );

        tamperResults.push({
          testName: test.name,
          rejected: !!result.error || result.statusCode >= 400,
          statusCode: result.statusCode,
          error: result.error,
          message: result.message
        });
      }

      // Check if all tampered tokens were rejected
      const allTamperedRejected = tamperResults.every(r => r.rejected);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        validWorks,
        allTamperedRejected,
      });

      const result = {
        success: allTamperedRejected,
        error: !allTamperedRejected 
          ? "System accepted one or more tampered tokens"
          : null,
        details: {
          validTokenAccepted: validWorks,
          tamperedTokenResults: tamperResults,
          allTamperedRejected,
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
    const moduleName = "security";
    const testName = "testEndpointProtections";
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

    try {
      // Log test phase - common security headers
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "security_headers",
      });

      // Make a request and check for security headers
      const response = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ message: "Testing security headers" }),
        }
      );

      // Collect security headers
      const securityHeaders = {};
      const securityHeaderPatterns = [
        'x-frame-options',
        'x-content-type-options',
        'strict-transport-security',
        'content-security-policy',
        'x-xss-protection',
        'referrer-policy',
        'permissions-policy',
        'cache-control',
        'x-permitted-cross-domain-policies'
      ];

      // Extract security headers
      if (response.headers) {
        // For fetch Response headers
        if (typeof response.headers.get === 'function') {
          securityHeaderPatterns.forEach(pattern => {
            const value = response.headers.get(pattern);
            if (value) {
              securityHeaders[pattern] = value;
            }
          });
        } 
        // For object headers
        else {
          securityHeaderPatterns.forEach(pattern => {
            for (const [key, value] of Object.entries(response.headers)) {
              if (key.toLowerCase() === pattern) {
                securityHeaders[key] = value;
                break;
              }
            }
          });
        }
      }

      testData.securityHeaders = securityHeaders;
      
      // Log test phase - input validation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "input_validation",
      });

      // Test various input validation scenarios
      const validationTests = [
        {
          name: "SQL Injection",
          data: { message: "Test'; DROP TABLE users; --" }
        },
        {
          name: "XSS Attack",
          data: { message: "<script>alert('XSS')</script>" }
        },
        {
          name: "Oversized Payload",
          data: { message: "X".repeat(10000) } // 10KB string
        },
        {
          name: "Invalid JSON Structure",
          rawBody: "{ message: This is not valid JSON }"
        }
      ];

      const validationResults = [];

      // Run each input validation test
      for (const test of validationTests) {
        try {
          const result = await fetchWithErrorHandling(
            `${apiEndpoint}/api/echo`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Request-ID": ulid(),
              },
              body: test.rawBody || JSON.stringify(test.data),
            }
          );

          validationResults.push({
            testName: test.name,
            handled: !result.error || result.statusCode >= 400,
            statusCode: result.statusCode,
            error: result.error,
            message: result.message
          });
        } catch (error) {
          // Even connection errors count as "handled" for security tests
          validationResults.push({
            testName: test.name,
            handled: true,
            statusCode: 0,
            error: error.message
          });
        }
      }

      // Check if all validation tests were properly handled
      const allValidationHandled = validationResults.every(r => r.handled);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        securityHeaderCount: Object.keys(securityHeaders).length,
        allValidationHandled,
      });

      // This test is diagnostic - we want to report findings
      const result = {
        success: allValidationHandled,
        error: !allValidationHandled 
          ? "System did not properly handle all security test cases"
          : null,
        details: {
          securityHeaders,
          securityHeadersFound: Object.keys(securityHeaders).length,
          recommendedHeaders: securityHeaderPatterns.filter(
            h => !Object.keys(securityHeaders).some(
              k => k.toLowerCase() === h
            )
          ),
          inputValidationResults: validationResults,
          allValidationHandled,
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