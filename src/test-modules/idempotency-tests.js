// idempotency-tests.js

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
 * Tests for idempotent operations
 */
const idempotencyTests = {
  /**
   * Test API handling of idempotent operations (repeated operations produce same result)
   */
  testIdempotentOperations: async (apiEndpoint) => {
    const moduleName = "idempotency";
    const testName = "testIdempotentOperations";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/cruda`;

    // Log test start
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
      // PART 1: Test idempotency of DELETE operation
      logger.info("Test phase: DELETE idempotency", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "delete_idempotency",
      });

      // [Rest of the test implementation remains the same]
      
      // Create a test item to delete
      const createResult = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          title: "Idempotency Test Item",
          content: "This item will be deleted multiple times",
        }),
      })
      .then(async (response) => {
        try {
          const data = await response.json();
          return {
            id: data.id,
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

      if (!createResult.ok || !createResult.id) {
        const result = {
          success: false,
          error: "Failed to create item for idempotency testing",
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // [Rest of the test implementation continues as normal]
      // ...

      // When test is complete, return the result through captureTestData
      const result = {
        success: deleteIsIdempotent, // At minimum, DELETE should be idempotent
        details: {
          delete: {
            isIdempotent: deleteIsIdempotent,
            isIdempotentType1: deleteIsIdempotentType1,
            isIdempotentType2: deleteIsIdempotentType2,
            firstDeleteResult: {
              status: firstDeleteResult.status,
              success: firstDeleteResult.ok,
            },
            secondDeleteResult: {
              status: secondDeleteResult.status,
              success: secondDeleteResult.ok,
            },
            thirdDeleteResult: {
              status: thirdDeleteResult.status,
              success: thirdDeleteResult.ok,
            },
          },
          put: testData.putIsSupported ? {
            isSupported: true,
            isIdempotent: testData.putIsIdempotent,
            firstPutResult: {
              status: testData.firstPutResult.status,
              success: testData.firstPutResult.ok,
            },
            secondPutResult: {
              status: testData.secondPutResult.status,
              success: testData.secondPutResult.ok,
            },
          } : {
            isSupported: false,
          },
          idempotencyKeys: testData.idempotencyKeysSupported ? {
            isSupported: true,
            gotSameId: testData.gotSameId,
            gotIdempotencyError: testData.gotIdempotencyError,
            firstResult: {
              id: testData.firstIdempKeyResult.id,
              status: testData.firstIdempKeyResult.status,
              success: testData.firstIdempKeyResult.ok,
            },
            secondResult: {
              id: testData.secondIdempKeyResult?.id,
              status: testData.secondIdempKeyResult?.status,
              success: testData.secondIdempKeyResult?.ok,
            },
          } : {
            isSupported: false,
          },
        },
      };

      // Do not add any extra logging here - let captureTestData handle it
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

      // Let captureTestData handle failure logging
      return captureTestData(testName, moduleName, result, testData);
    }
  }
};

module.exports = idempotencyTests;