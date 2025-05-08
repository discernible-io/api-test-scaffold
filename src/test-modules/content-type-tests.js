// content-type-tests.js

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const { stateManager, fetchWithErrorHandling } = require("../middleware/rodit");

// Standardized captureTestData function aligned with successful tests
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || "unknown",
  };

  if (!result.success) {
    const correlationId = ulid();
    result.testInfo.correlationId = correlationId;

    // Log error using the standard format
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

    // Also log an additional error message in the same format TestRunner uses
    logger.error(`Test failed: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      error: result.error,
      details: result.details || {},
    });

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    // Log success at DEBUG level in the format TestRunner expects
    logger.debug(
      `Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`,
      {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
      }
    );

    // Also log an additional success message at INFO level in the same format TestRunner uses
    logger.info(`Test passed: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      details: result.details || {},
    });

    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
    });
  }

  return result;
}

/**
 * Tests for Content-Type validation and header handling
 */
const contentTypeTests = {
  /**
   * Test API handling of different Content-Type headers
   */
  testContentTypeValidation: async (apiEndpoint) => {
    const moduleName = "content-type";
    const testName = "testContentTypeValidation";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/echo/echo`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      apiEndpoint: testData.endpoint,
      startTime: new Date().toISOString(),
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
      // Test cases with different content types
      const testCases = [
        // Standard JSON content type
        {
          name: "Standard JSON",
          contentType: "application/json",
          body: JSON.stringify({ message: "Testing standard JSON content type" }),
          expectSuccess: true
        },
        // JSON with charset
        {
          name: "JSON with charset",
          contentType: "application/json; charset=utf-8",
          body: JSON.stringify({ message: "Testing JSON with charset" }),
          expectSuccess: true
        },
        // Plain text
        {
          name: "Plain text",
          contentType: "text/plain",
          body: "Testing plain text content type",
          expectSuccess: false // Most APIs expect JSON
        },
        // Form URL encoded
        {
          name: "Form URL encoded",
          contentType: "application/x-www-form-urlencoded",
          body: "message=Testing form URL encoded content type",
          expectSuccess: false // Most APIs expect JSON
        },
        // XML
        {
          name: "XML format",
          contentType: "application/xml",
          body: "<message>Testing XML content type</message>",
          expectSuccess: false // Most APIs expect JSON
        },
        // Missing content type
        {
          name: "Missing content type",
          contentType: "", // Empty content type
          body: JSON.stringify({ message: "Testing missing content type" }),
          expectSuccess: false // Most APIs require content type
        },
        // Incorrect content type for body
        {
          name: "Incorrect content type",
          contentType: "application/json",
          body: "<message>This is not JSON but says it is</message>",
          expectSuccess: false // Body doesn't match content type
        },
        // Multipart form
        {
          name: "Multipart form data",
          contentType: "multipart/form-data; boundary=----boundary",
          body: "------boundary\r\nContent-Disposition: form-data; name=\"message\"\r\n\r\nTesting multipart form data\r\n------boundary--",
          expectSuccess: false // Most APIs expect JSON
        }
      ];

      const testResults = [];

      // Test each case
      for (const testCase of testCases) {
        logger.debug(`Testing case: ${testCase.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "test_case",
          caseName: testCase.name
        });

        // Build headers for this test case
        const headers = {
          "X-Request-ID": ulid(),
          Authorization: `Bearer ${token}`,
        };
        
        // Only add Content-Type if it's not empty
        if (testCase.contentType) {
          headers["Content-Type"] = testCase.contentType;
        }

        // Make the request
        const response = await fetch(`${apiEndpoint}/api/echo/echo`, {
          method: "POST",
          headers: headers,
          body: testCase.body,
        })
        .then(async (response) => {
          let data;
          try {
            // Try to parse as JSON, but don't fail if not JSON
            data = await response.text();
            try {
              data = JSON.parse(data);
            } catch (e) {
              // Keep as text if not JSON
            }
            
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
        .catch(error => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

        // Determine if test passed based on expected success
        const testPassed = (testCase.expectSuccess && response.ok) || 
                         (!testCase.expectSuccess && !response.ok);

        testResults.push({
          testCase: testCase.name,
          contentType: testCase.contentType,
          success: response.ok,
          testPassed,
          status: response.status,
          error: response.error,
          data: response.data ? 
            (typeof response.data === 'object' ? 
              JSON.stringify(response.data).substring(0, 100) : 
              String(response.data).substring(0, 100)) : 
            null
        });
      }

      // Check if all tests behaved as expected
      const allTestsPassed = testResults.every(result => result.testPassed);

      // Additional test for headers validation and handling
      logger.info("Test phase: Header validation", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "header_validation",
      });

      // Test custom headers to see which ones are accepted/rejected
      const headerTests = [
        {
          name: "Standard headers",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ message: "Testing standard headers" }),
          expectSuccess: true
        },
        {
          name: "Custom X- headers",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
            "X-Custom-Header": "Custom value",
            "X-Test-Header": "Test value",
          },
          body: JSON.stringify({ message: "Testing custom X- headers" }),
          expectSuccess: true
        },
        {
          name: "Non-standard headers",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
            "Custom-Header": "Custom value",
            "Test-Header": "Test value",
          },
          body: JSON.stringify({ message: "Testing non-standard headers" }),
          expectSuccess: true
        },
        {
          name: "Very long header value",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
            "X-Long-Header": "x".repeat(4000), // Very long header value
          },
          body: JSON.stringify({ message: "Testing very long header value" }),
          expectSuccess: false
        }
      ];

      const headerTestResults = [];

      // Test each header case
      for (const headerTest of headerTests) {
        logger.debug(`Testing header case: ${headerTest.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "header_test_case",
          caseName: headerTest.name
        });

        // Make the request
        const response = await fetch(`${apiEndpoint}/api/echo/echo`, {
          method: "POST",
          headers: headerTest.headers,
          body: headerTest.body,
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
        .catch(error => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

        // Determine if test passed based on expected success
        const testPassed = (headerTest.expectSuccess && response.ok) || 
                         (!headerTest.expectSuccess && !response.ok);

        headerTestResults.push({
          testCase: headerTest.name,
          headers: Object.keys(headerTest.headers).join(", "),
          success: response.ok,
          testPassed,
          status: response.status,
          error: response.error,
        });
      }

      // Check if all header tests behaved as expected
      const allHeaderTestsPassed = headerTestResults.every(result => result.testPassed);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allTestsPassed,
        allHeaderTestsPassed,
      });

      const result = {
        success: allTestsPassed && allHeaderTestsPassed,
        error: !allTestsPassed ? 
          "Some content type tests failed" : 
          !allHeaderTestsPassed ? 
            "Some header validation tests failed" : 
            null,
        details: {
          contentTypeTests: {
            allTestsPassed,
            testResults,
          },
          headerTests: {
            allHeaderTestsPassed,
            headerTestResults,
          },
          summary: {
            totalContentTypeTests: testResults.length,
            passedContentTypeTests: testResults.filter(r => r.testPassed).length,
            failedContentTypeTests: testResults.filter(r => !r.testPassed).map(r => r.testCase),
            totalHeaderTests: headerTestResults.length,
            passedHeaderTests: headerTestResults.filter(r => r.testPassed).length,
            failedHeaderTests: headerTestResults.filter(r => !r.testPassed).map(r => r.testCase),
          }
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
  }
};

module.exports = contentTypeTests;