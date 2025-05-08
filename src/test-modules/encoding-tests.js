// encoding-tests.js

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
 * Tests for special characters, encoding, and zero-length inputs
 */
const encodingTests = {
  /**
   * Test API handling of special characters, different encodings, and zero-length inputs
   */
  testSpecialCharactersAndEncoding: async (apiEndpoint) => {
    const moduleName = "encoding";
    const testName = "testSpecialCharactersAndEncoding";
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
      // Test cases with various special characters and encodings
      const testCases = [
        // Zero-length input
        {
          name: "Zero-length input",
          input: "",
          description: "Testing empty string"
        },
        // Special characters
        {
          name: "Special ASCII characters",
          input: "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~",
          description: "Testing special ASCII characters"
        },
        // Unicode characters
        {
          name: "Unicode characters",
          input: "ÄäÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž",
          description: "Testing Unicode Latin characters with diacritics"
        },
        // Emojis
        {
          name: "Emoji characters",
          input: "😀👍🚀🌍💻🔒🔑🧪",
          description: "Testing emoji characters"
        },
        // Right-to-left text
        {
          name: "RTL text",
          input: "مرحبا بالعالم! שלום עולם!",
          description: "Testing right-to-left Arabic and Hebrew text"
        },
        // Asian characters
        {
          name: "Asian characters",
          input: "你好世界! こんにちは世界! 안녕하세요 세계!",
          description: "Testing Chinese, Japanese, and Korean characters"
        },
        // SQL injection attempt
        {
          name: "SQL injection characters",
          input: "'; DROP TABLE users; --",
          description: "Testing SQL injection characters"
        },
        // JavaScript injection attempt
        {
          name: "JavaScript injection",
          input: "<script>alert('XSS')</script>",
          description: "Testing JavaScript injection characters"
        },
        // Very long input
        {
          name: "Long input",
          input: "a".repeat(5000),
          description: "Testing very long input (5000 chars)"
        },
        // Control characters
        {
          name: "Control characters",
          input: "Line 1\nLine 2\tTabbed\rCarriage Return",
          description: "Testing control characters (newline, tab, carriage return)"
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

        // Make the request
        const response = await fetch(`${apiEndpoint}/api/echo/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: testCase.input,
            description: testCase.description
          }),
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

        // Check if the response correctly echoed back the input
        const echoedCorrectly = response.data && 
          ((response.data.message === testCase.input) || 
           (response.data.input === testCase.input) ||
           (response.data.echo === testCase.input));

        testResults.push({
          testCase: testCase.name,
          description: testCase.description,
          success: response.ok && !response.error,
          echoedCorrectly,
          status: response.status,
          error: response.error,
          response: response.data ? 
            (typeof response.data === 'object' ? 
              JSON.stringify(response.data).substring(0, 100) : 
              String(response.data).substring(0, 100)) : 
            null
        });
      }

      // Check if all tests succeeded
      const allTestsSucceeded = testResults.every(result => result.success);
      const allEchoedCorrectly = testResults.every(result => result.echoedCorrectly);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allTestsSucceeded,
        allEchoedCorrectly,
      });

      const result = {
        success: allTestsSucceeded && allEchoedCorrectly,
        error: !allTestsSucceeded ? 
          "Some requests failed" : 
          !allEchoedCorrectly ? 
            "Some responses did not echo the input correctly" : 
            null,
        details: {
          testResults,
          summary: {
            totalTests: testResults.length,
            successfulRequests: testResults.filter(r => r.success).length,
            correctlyEchoed: testResults.filter(r => r.echoedCorrectly).length,
            failedTests: testResults.filter(r => !r.success || !r.echoedCorrectly).map(r => r.testCase)
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

module.exports = encodingTests;