// content-type-tests.js

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData } = require("./test-utils");
/**
 * Tests for Content-Type validation and header handling
 */
const contentTypeTests = {
  /**
   * Test API handling of different Content-Type headers
   */
  testContentTypeValidation: async (tctv_api_ep) => {
    const moduleName = "content-type";
    const testName = "testContentTypeValidation";
    const correlationId = ulid();
    const testData = { tctv_api_ep };
    testData.endpoint = `${tctv_api_ep}/api/echo`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tctv_api_ep: testData.endpoint,
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
          // Express may not parse this properly as it's not JSON
          expectSuccess: false 
        },
        // Form URL encoded
        {
          name: "Form URL encoded",
          contentType: "application/x-www-form-urlencoded",
          body: "message=Testing form URL encoded content type",
          // Express bodyParser might handle this, but it depends on server config
          expectSuccess: false 
        },
        // XML
        {
          name: "XML format",
          contentType: "application/xml",
          body: "<message>Testing XML content type</message>",
          // Express typically doesn't parse XML by default
          expectSuccess: false 
        },
        // Missing content type
        {
          name: "Missing content type",
          contentType: "", // Empty content type
          body: JSON.stringify({ message: "Testing missing content type" }),
          // Express might still try to parse this as JSON
          expectSuccess: false 
        },
        // Incorrect content type for body
        {
          name: "Incorrect content type",
          contentType: "application/json",
          body: "<message>This is not JSON but says it is</message>",
          // This should fail as it's not valid JSON
          expectSuccess: false 
        },
        // Multipart form
        {
          name: "Multipart form data",
          contentType: "multipart/form-data; boundary=----boundary",
          body: "------boundary\r\nContent-Disposition: form-data; name=\"message\"\r\n\r\nTesting multipart form data\r\n------boundary--",
          // Express doesn't parse multipart/form-data without additional middleware
          expectSuccess: false 
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
        const response = await fetch(`${tctv_api_ep}/api/echo`, {
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

        // Check for proper response structure - echo API should return an "echo" property
        // Accept either top-level echo or wrapped under data/result (server returns { data: { echo: ... } })
        const hasProperResponse = (() => {
          const d = response.data;
          if (!d) return false;
          if (typeof d === 'object') {
            if (d.echo !== undefined) return true;
            if (d.data && typeof d.data === 'object' && d.data.echo !== undefined) return true;
            if (d.result && typeof d.result === 'object' && d.result.echo !== undefined) return true;
          }
          return false;
        })();

        // Determine if test passed based on expected success and proper response
        const testPassed = (testCase.expectSuccess && response.ok && hasProperResponse) || 
                         (!testCase.expectSuccess && !response.ok);

        // If the test didn't pass as expected, log additional details
        if (!testPassed) {
          logger.warn(`Test case ${testCase.name} failed expectations`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "test_case_mismatch",
            caseName: testCase.name,
            expected: testCase.expectSuccess ? "success" : "failure",
            actual: response.ok ? "success" : "failure",
            hasProperResponse,
            status: response.status,
            responseData: response.data ? 
              (typeof response.data === 'object' ? 
                JSON.stringify(response.data).substring(0, 100) : 
                String(response.data).substring(0, 100)) : 
              null
          });
        }

        testResults.push({
          testCase: testCase.name,
          contentType: testCase.contentType,
          success: response.ok,
          hasProperResponse,
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

      // Identify which test cases failed
      const failedTestCases = testResults
        .filter(result => !result.testPassed)
        .map(result => result.testCase);

      if (failedTestCases.length > 0) {
        logger.warn(`Content type test cases failed: ${failedTestCases.join(', ')}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "content_type_failures",
          failedTestCases
        });
      }

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
            "X-Long-Header": "x".repeat(33000), // Very long header value
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

        // Make the request (safe parsing similar to content-type tests)
        const response = await fetch(`${tctv_api_ep}/api/echo`, {
          method: "POST",
          headers: headerTest.headers,
          body: headerTest.body,
        })
          .then(async (response) => {
            let data;
            try {
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        // Check for proper response structure - echo API should return an "echo" property
        // Accept either top-level echo or wrapped under data/result
        const hasProperResponse = (() => {
          const d = response.data;
          if (!d) return false;
          if (typeof d === 'object') {
            if (d.echo !== undefined) return true;
            if (d.data && typeof d.data === 'object' && d.data.echo !== undefined) return true;
            if (d.result && typeof d.result === 'object' && d.result.echo !== undefined) return true;
          }
          return false;
        })();

        // Determine if test passed based on expected success and proper response
        const testPassed = (headerTest.expectSuccess && response.ok && hasProperResponse) || 
                         (!headerTest.expectSuccess && !response.ok);

        // If the test didn't pass as expected, log additional details
        if (!testPassed) {
          logger.warn(`Header test case ${headerTest.name} failed expectations`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "header_test_mismatch",
            caseName: headerTest.name,
            expected: headerTest.expectSuccess ? "success" : "failure",
            actual: response.ok ? "success" : "failure",
            hasProperResponse,
            status: response.status,
            responseData: response.data ?
              (typeof response.data === 'object' ?
                JSON.stringify(response.data).substring(0, 100) :
                String(response.data).substring(0, 100)) :
              null
          });
        }

        headerTestResults.push({
          testCase: headerTest.name,
          headers: Object.keys(headerTest.headers).join(", "),
          success: response.ok,
          hasProperResponse,
          testPassed,
          status: response.status,
          error: response.error,
        });
      }

      // Check if all header tests behaved as expected
      const allHeaderTestsPassed = headerTestResults.every(result => result.testPassed);

      // Identify which header test cases failed
      const failedHeaderTests = headerTestResults
        .filter(result => !result.testPassed)
        .map(result => result.testCase);

      if (failedHeaderTests.length > 0) {
        logger.warn(`Header test cases failed: ${failedHeaderTests.join(', ')}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "header_failures",
          failedHeaderTests
        });
      }

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