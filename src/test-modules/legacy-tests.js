const logger = require("../../config/logger");
const stateManager = require("../blockchain/statemanager");
const { ulid } = require("ulid");

const captureTestData = require("./test-utils");
// Export the legacy tests in a format compatible with the test runner
module.exports = {
  testCRUDAOperationsLegacy: async (apiEndpoint, config) => {
    const moduleName = "legacy";
    const testName = "testCRUDAOperationsLegacy";
    const correlationId = ulid(); // Using ulid instead of randomUUID for better time-ordering
    const testData = { apiEndpoint };

    // Log test start with correlation ID and phase
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      endpoint: apiEndpoint,
      phase: "start",
    });

    try {
      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
        phase: "cruda_operations",
      });

      await testCRUDAOperations(apiEndpoint);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
        phase: "complete",
      });

      const result = {
        success: true,
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      // Log test exception with consistent fields
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
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

  testEchoLegacy: async (apiEndpoint, config) => {
    const moduleName = "legacy";
    const testName = "testEchoLegacy";
    const correlationId = ulid(); // Using ulid instead of randomUUID
    const testData = { apiEndpoint };

    // Log test start with correlation ID and phase
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      endpoint: apiEndpoint,
      phase: "start",
    });

    try {
      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
        phase: "echo_operation",
      });

      await accessProtectedRouteEcho(apiEndpoint, "Legacy test echo message");

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
        phase: "complete",
      });

      const result = {
        success: true,
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      // Log test exception with consistent fields
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        endpoint: apiEndpoint,
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

// Include the original functions with updated logging
async function testCRUDAOperations(apiendpoint) {
  const operationId = ulid(); // Using ulid instead of randomUUID
  const correlationId = operationId; // Use same ID as correlationId for consistency

  const logContext = {
    operationId,
    correlationId,
    component: "TestRunner",
    moduleName: "legacy",
    testName: "testCRUDAOperations",
    apiEndpoint: apiendpoint,
    operationType: "CRUDA_TEST",
  };

  const getHeaders = () => ({
    "Content-Type": "application/json",
    "X-Request-ID": ulid(), // Adding request ID for better tracing
  });

  let createdItemId1, createdItemId2;

  async function performOperation(operationName, func) {
    const phaseStartTime = Date.now(); // Track timing for each operation
    const currentContext = {
      ...logContext,
      operation: operationName,
      timestamp: new Date().toISOString(),
      phase: operationName.toLowerCase().replace(/\s+/g, "_"),
    };

    // Standardized log format matching performance.js
    logger.info(`Testing operation`, {
      ...currentContext,
    });

    try {
      const result = await func();
      const duration = Date.now() - phaseStartTime; // Calculate operation duration

      if (result.error) {
        currentContext.errorType = result.error;
        currentContext.errorMessage = result.message;
        currentContext.duration = duration;

        // Standardized error log format
        logger.error(`Operation error`, {
          ...currentContext,
        });

        if (result.error === "RateLimitExceeded") {
          currentContext.retryAfter = result.retryAfter;
          currentContext.maxRequests = result.maxRequests;
          currentContext.windowMinutes = result.windowMinutes;

          // Log rate limit in standard format
          logger.info(`Rate limit exceeded`, {
            ...currentContext,
          });

          // Add metric for rate limit
          logger.metric("rate_limit_exceeded", 1, {
            operation: operationName,
            endpoint: apiendpoint,
            correlation_id: correlationId,
          });
        }
        return null;
      }

      currentContext.resultStatus = "success";
      currentContext.resultId = result.id;
      currentContext.duration = duration;

      // Standardized success log format
      logger.info(`Operation successful`, {
        ...currentContext,
      });

      // Add metric for operation success with timing
      logger.metric("operation_success", duration, {
        operation: operationName,
        endpoint: apiendpoint,
        correlation_id: correlationId,
      });

      return result;
    } catch (error) {
      const duration = Date.now() - phaseStartTime;
      currentContext.unexpectedError = true;
      currentContext.duration = duration;
      currentContext.errorMessage = error.message;
      currentContext.stack = error.stack;

      // Standardized unexpected error log format
      logger.error(`Unexpected error`, {
        ...currentContext,
      });

      // Add metric for operation failure
      logger.metric("operation_failure", 1, {
        operation: operationName,
        endpoint: apiendpoint,
        correlation_id: correlationId,
        error_type: "unexpected",
      });

      return null;
    }
  }

  // CREATE operations
  logger.info("Starting CREATE operations", {
    ...logContext,
    phase: "create_operations",
  });

  const createdItem1 = await performOperation("CREATE item 1", () =>
    stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        title: "Lore Ipsum",
        content: "This is the first test comment",
      }),
    })
  );
  if (createdItem1) createdItemId1 = createdItem1.id;

  const createdItem2 = await performOperation("CREATE item 2", () =>
    stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        title: "I also say Lore Ipsum",
        content: "This is the second test comment",
      }),
    })
  );
  if (createdItem2) createdItemId2 = createdItem2.id;

  // READ operations
  logger.info("Starting READ operations", {
    ...logContext,
    phase: "read_operations",
  });

  // READ (list all)
  await performOperation("READ (list all)", () =>
    stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  // READ (single comment)
  if (createdItemId1) {
    await performOperation("READ (single comment) item 1", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("READ (single comment) item 2", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // UPDATE operations
  logger.info("Starting UPDATE operations", {
    ...logContext,
    phase: "update_operations",
  });

  if (createdItemId1) {
    await performOperation("UPDATE item 1", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          id: createdItemId1,
          title: "Updated Lore Ipsum",
          content: "This comment has been updated",
        }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("UPDATE item 2", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          id: createdItemId2,
          title: "Updated I also say Lore Ipsum",
          content: "This comment has been updated",
        }),
      })
    );
  }

  // DESTROY operations
  logger.info("Starting DESTROY operations", {
    ...logContext,
    phase: "destroy_operations",
  });

  if (createdItemId1) {
    await performOperation("DESTROY item 1", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("DESTROY item 2", () =>
      stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // Verify deletion
  logger.info("Starting verification phase", {
    ...logContext,
    phase: "verify_deletion",
  });

  await performOperation("Verify deletion", () =>
    stateManager.fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  logger.info("Test completed", {
    ...logContext,
    phase: "complete",
  });
}

async function accessProtectedRouteEcho(apiendpoint, echoInput) {
  const operationId = ulid(); // Using ulid instead of randomUUID
  const correlationId = operationId; // Use same ID as correlationId for consistency

  const logContext = {
    operationId,
    correlationId,
    component: "TestRunner",
    moduleName: "legacy",
    testName: "accessProtectedRouteEcho",
    apiEndpoint: apiendpoint,
    operation: "ECHO_TEST",
  };

  const headers = {
    "Content-Type": "application/json",
    "X-Request-ID": ulid(), // Adding request ID for better tracing
  };

  // Standardized log format
  logger.info("Starting ECHO operation", {
    ...logContext,
    phase: "start",
    timestamp: new Date().toISOString(),
  });

  const startTime = Date.now();

  try {
    const result = await stateManager.fetchWithErrorHandling(
      `${apiendpoint}/api/echo/echo`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: "Test Comment",
          description: "This is a test comment",
          message: echoInput,
        }),
      }
    );

    const duration = Date.now() - startTime;
    logContext.duration = duration;

    if (result.error) {
      logContext.errorType = result.error;
      logContext.errorMessage = result.message;
      logContext.phase = "error";

      // Standardized error log format
      logger.error("ECHO operation failed", {
        ...logContext,
        timestamp: new Date().toISOString(),
      });

      // Add metric for operation failure
      logger.metric("operation_failure", 1, {
        operation: "ECHO",
        endpoint: apiendpoint,
        correlation_id: correlationId,
        error_type: result.error,
      });

      if (result.error === "RateLimitExceeded") {
        logContext.retryAfter = result.retryAfter;
        logContext.maxRequests = result.maxRequests;
        logContext.windowMinutes = result.windowMinutes;
        logContext.phase = "rate_limit";

        // Standardized rate limit log
        logger.info(`Rate limit exceeded`, {
          ...logContext,
          timestamp: new Date().toISOString(),
        });

        // Add metric for rate limit
        logger.metric("rate_limit_exceeded", 1, {
          operation: "ECHO",
          endpoint: apiendpoint,
          correlation_id: correlationId,
        });
      }
    } else {
      logContext.responseReceived = true;
      logContext.phase = "success";

      // Standardized success log
      logger.info("ECHO operation successful", {
        ...logContext,
        timestamp: new Date().toISOString(),
      });

      // Add metric for operation success with timing
      logger.metric("operation_success", duration, {
        operation: "ECHO",
        endpoint: apiendpoint,
        correlation_id: correlationId,
      });
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    logContext.duration = duration;
    logContext.errorMessage = error.message;
    logContext.stack = error.stack;
    logContext.phase = "exception";

    // Standardized unexpected error log
    logger.error("Unexpected error in ECHO operation", {
      ...logContext,
      timestamp: new Date().toISOString(),
    });

    // Add metric for operation failure
    logger.metric("operation_failure", 1, {
      operation: "ECHO",
      endpoint: apiendpoint,
      correlation_id: correlationId,
      error_type: "unexpected",
    });
  }
}
