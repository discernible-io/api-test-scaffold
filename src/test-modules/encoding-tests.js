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
   * Test API handling of special characters, different encodings, and zero-length inputs for the echo endpoint
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
          description: "Testing empty string",
        },
        // Special characters
        {
          name: "Special ASCII characters",
          input: "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~",
          description: "Testing special ASCII characters",
        },
        // Unicode characters
        {
          name: "Unicode characters",
          input: "ÄäÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž",
          description: "Testing Unicode Latin characters with diacritics",
        },
        // Emojis
        {
          name: "Emoji characters",
          input: "😀👍🚀🌍💻🔒🔑🧪",
          description: "Testing emoji characters",
        },
        // Right-to-left text
        {
          name: "RTL text",
          input: "مرحبا بالعالم! שלום עולם!",
          description: "Testing right-to-left Arabic and Hebrew text",
        },
        // Asian characters
        {
          name: "Asian characters",
          input: "你好世界! こんにちは世界! 안녕하세요 세계!",
          description: "Testing Chinese, Japanese, and Korean characters",
        },
        // SQL injection attempt
        {
          name: "SQL injection characters",
          input: "'; DROP TABLE users; --",
          description: "Testing SQL injection characters",
        },
        // JavaScript injection attempt
        {
          name: "JavaScript injection",
          input: "<script>alert('XSS')</script>",
          description: "Testing JavaScript injection characters",
        },
        // Very long input
        {
          name: "Long input",
          input: "a".repeat(5000),
          description: "Testing very long input (5000 chars)",
        },
        // Control characters
        {
          name: "Control characters",
          input: "Line 1\nLine 2\tTabbed\rCarriage Return",
          description:
            "Testing control characters (newline, tab, carriage return)",
        },
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
          caseName: testCase.name,
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
            description: testCase.description,
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        // Check if the response correctly echoed back the input
        const echoedCorrectly =
          response.data &&
          (response.data.message?.toLowerCase() ===
            testCase.input.toLowerCase() ||
            response.data.input?.toLowerCase() ===
              testCase.input.toLowerCase() ||
            response.data.echo?.toLowerCase() === testCase.input.toLowerCase());

        testResults.push({
          testCase: testCase.name,
          description: testCase.description,
          success: response.ok && !response.error,
          echoedCorrectly,
          status: response.status,
          error: response.error,
          response: response.data
            ? typeof response.data === "object"
              ? JSON.stringify(response.data).substring(0, 100)
              : String(response.data).substring(0, 100)
            : null,
        });
      }

      // Check if all tests succeeded
      const allTestsSucceeded = testResults.every((result) => result.success);
      const allEchoedCorrectly = testResults.every(
        (result) => result.echoedCorrectly
      );

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
        error: !allTestsSucceeded
          ? "Some requests failed"
          : !allEchoedCorrectly
          ? "Some responses did not echo the input correctly"
          : null,
        details: {
          testResults,
          summary: {
            totalTests: testResults.length,
            successfulRequests: testResults.filter((r) => r.success).length,
            correctlyEchoed: testResults.filter((r) => r.echoedCorrectly)
              .length,
            failedTests: testResults
              .filter((r) => !r.success || !r.echoedCorrectly)
              .map((r) => r.testCase),
          },
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
   * Test CRUDA endpoints for handling special characters, different encodings, and zero-length inputs
   */
  testCrudaSpecialCharactersAndEncoding: async (apiEndpoint) => {
    const moduleName = "encoding";
    const testName = "testCrudaSpecialCharactersAndEncoding";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/create`; // Using 'create' as the primary endpoint for test identification

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
        // Special characters
        {
          name: "Special ASCII characters",
          title: "Special chars: !@#$%^&*()",
          content: "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~",
          description: "Testing special ASCII characters",
        },
        // Unicode characters
        {
          name: "Unicode characters",
          title: "Unicode Title ÄäÁáČčĎďÉé",
          content: "ÄäÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž",
          description: "Testing Unicode Latin characters with diacritics",
        },
        // Emojis
        {
          name: "Emoji characters",
          title: "Emoji Title 😀👍🚀",
          content: "Content with emojis: 😀👍🚀🌍💻🔒🔑🧪",
          description: "Testing emoji characters",
        },
        // Right-to-left text
        {
          name: "RTL text",
          title: "RTL Title: مرحبا بالعالم",
          content: "مرحبا بالعالم! שלום עולם!",
          description: "Testing right-to-left Arabic and Hebrew text",
        },
        // Asian characters
        {
          name: "Asian characters",
          title: "Asian Title: 你好世界",
          content: "你好世界! こんにちは世界! 안녕하세요 세계!",
          description: "Testing Chinese, Japanese, and Korean characters",
        },
        // SQL injection attempt
        {
          name: "SQL injection characters",
          title: "SQL Injection Test",
          content: "'; DROP TABLE comments; --",
          description: "Testing SQL injection characters",
        },
        // JavaScript injection attempt
        {
          name: "JavaScript injection",
          title: "XSS Test",
          content: "<script>alert('XSS')</script>",
          description: "Testing JavaScript injection characters",
        },
        // Very long input
        {
          name: "Long content",
          title: "Long Content Test",
          content: "a".repeat(2000),
          description: "Testing very long content (2000 chars)",
        },
        // Control characters
        {
          name: "Control characters",
          title: "Control Chars Test",
          content: "Line 1\nLine 2\tTabbed\rCarriage Return",
          description: "Testing control characters (newline, tab, carriage return)",
        },
      ];

      const allResults = {
        create: [],
        list: null,
        read: [],
        update: [],
        destroy: []
      };

      // First test create endpoint with each test case
      for (const testCase of testCases) {
        logger.debug(`Testing CREATE for case: ${testCase.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "create_test",
          caseName: testCase.name,
        });

        // Create a comment with special characters
        const createResponse = await fetch(`${apiEndpoint}/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            title: testCase.title,
            content: testCase.content
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        // Check if the data was stored correctly with special characters
        const dataMatches = 
          createResponse.ok && 
          createResponse.data && 
          createResponse.data.title === testCase.title && 
          createResponse.data.content === testCase.content;

        // Store the newly created comment ID for later tests
        const commentId = createResponse.data?.id;

        allResults.create.push({
          testCase: testCase.name,
          description: testCase.description,
          success: createResponse.ok && !createResponse.error,
          dataMatches,
          commentId,
          status: createResponse.status,
          error: createResponse.error,
        });

        // If creation was successful, also test reading the comment
        if (createResponse.ok && commentId) {
          // Read the created comment to check its content
          const readResponse = await fetch(`${apiEndpoint}/read`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId
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
            .catch((error) => {
              return {
                error: `Network error: ${error.message}`,
                status: 0,
              };
            });

          // Check if the retrieved data matches what we created
          const readDataMatches = 
            readResponse.ok && 
            readResponse.data && 
            readResponse.data.title === testCase.title && 
            readResponse.data.content === testCase.content;

          allResults.read.push({
            testCase: testCase.name,
            commentId,
            success: readResponse.ok && !readResponse.error,
            dataMatches: readDataMatches,
            status: readResponse.status,
            error: readResponse.error,
          });

          // Test updating the comment
          const updatedTitle = `Updated: ${testCase.title}`;
          const updatedContent = `Updated: ${testCase.content}`;

          const updateResponse = await fetch(`${apiEndpoint}/update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId,
              title: updatedTitle,
              content: updatedContent
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
            .catch((error) => {
              return {
                error: `Network error: ${error.message}`,
                status: 0,
              };
            });

          // Check if the updated data was stored correctly
          const updateDataMatches = 
            updateResponse.ok && 
            updateResponse.data && 
            updateResponse.data.title === updatedTitle && 
            updateResponse.data.content === updatedContent;

          allResults.update.push({
            testCase: testCase.name,
            commentId,
            success: updateResponse.ok && !updateResponse.error,
            dataMatches: updateDataMatches,
            status: updateResponse.status,
            error: updateResponse.error,
          });
        }
      }

      // Test listing all comments
      const listResponse = await fetch(`${apiEndpoint}/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({}),
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

      // Check if we can get a list of comments
      const commentsListValid = 
        listResponse.ok && 
        listResponse.data && 
        Array.isArray(listResponse.data.comments);

      allResults.list = {
        success: listResponse.ok && !listResponse.error,
        hasComments: commentsListValid,
        commentCount: commentsListValid ? listResponse.data.comments.length : 0,
        status: listResponse.status,
        error: listResponse.error,
      };

      // Now delete one comment to test destroy endpoint
      if (allResults.create.length > 0 && allResults.create[0].commentId) {
        const commentToDelete = allResults.create[0].commentId;
        const deleteResponse = await fetch(`${apiEndpoint}/destroy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: commentToDelete
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        allResults.destroy.push({
          commentId: commentToDelete,
          success: deleteResponse.ok && !deleteResponse.error,
          status: deleteResponse.status,
          error: deleteResponse.error,
        });
      }

      // Calculate success metrics
      const createSuccess = allResults.create.every(r => r.success && r.dataMatches);
      const readSuccess = allResults.read.every(r => r.success && r.dataMatches);
      const updateSuccess = allResults.update.every(r => r.success && r.dataMatches);
      const listSuccess = allResults.list && allResults.list.success && allResults.list.hasComments;
      const destroySuccess = allResults.destroy.length > 0 && allResults.destroy.every(r => r.success);

      // Log test completion
      logger.info("CRUDA encoding tests completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        createSuccess,
        readSuccess,
        updateSuccess,
        listSuccess,
        destroySuccess
      });

      const result = {
        success: createSuccess && readSuccess && updateSuccess && listSuccess && destroySuccess,
        error: !createSuccess
          ? "Create operations failed for special characters"
          : !readSuccess
          ? "Read operations failed for special characters"
          : !updateSuccess
          ? "Update operations failed for special characters"
          : !listSuccess
          ? "List operation failed"
          : !destroySuccess
          ? "Delete operation failed"
          : null,
        details: {
          createResults: allResults.create,
          readResults: allResults.read,
          updateResults: allResults.update,
          listResult: allResults.list,
          destroyResults: allResults.destroy,
          summary: {
            totalCreateTests: allResults.create.length,
            successfulCreateTests: allResults.create.filter(r => r.success && r.dataMatches).length,
            totalReadTests: allResults.read.length,
            successfulReadTests: allResults.read.filter(r => r.success && r.dataMatches).length,
            totalUpdateTests: allResults.update.length,
            successfulUpdateTests: allResults.update.filter(r => r.success && r.dataMatches).length,
            totalDestroyTests: allResults.destroy.length,
            successfulDestroyTests: allResults.destroy.filter(r => r.success).length,
          },
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