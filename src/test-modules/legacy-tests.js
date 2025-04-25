// legacy-tests.js
const crypto = require("crypto");
const logger = require("../config/logger");
const { fetchWithErrorHandling } = require("./middleware/rodit");

async function testCRUDAOperations(apiendpoint) {
  const operationId = crypto.randomUUID();
  const logContext = {
    operationId,
    apiEndpoint: apiendpoint,
    operationType: "CRUDA_TEST",
  };

  const getHeaders = () => ({
    "Content-Type": "application/json",
  });

  let createdItemId1, createdItemId2;

  async function performOperation(operationName, func) {
    const currentContext = {
      ...logContext,
      operation: operationName,
      timestamp: new Date().toISOString(),
    };

    logger.infoWithContext(
      `Testing ${operationName} operation`,
      currentContext
    );

    try {
      const result = await func();

      if (result.error) {
        currentContext.errorType = result.error;
        currentContext.errorMessage = result.message;

        logger.errorWithContext(
          `Error in ${operationName} operation`,
          currentContext
        );

        if (result.error === "RateLimitExceeded") {
          currentContext.retryAfter = result.retryAfter;
          currentContext.maxRequests = result.maxRequests;
          currentContext.windowMinutes = result.windowMinutes;

          logger.infoWithContext(
            `Rate limit exceeded. Try again in ${result.retryAfter} seconds`,
            currentContext
          );
        }
        return null;
      }

      currentContext.resultStatus = "success";
      currentContext.resultId = result.id;

      logger.infoWithContext(
        `${operationName} operation successful`,
        currentContext
      );
      return result;
    } catch (error) {
      currentContext.unexpectedError = true;
      logger.errorWithContext(
        `Unexpected error in ${operationName}`,
        currentContext,
        error
      );
      return null;
    }
  }

  // CREATE operations
  const createdItem1 = await performOperation("CREATE item 1", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
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
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/create`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        title: "I also say Lore Ipsum",
        content: "This is the second test comment",
      }),
    })
  );
  if (createdItem2) createdItemId2 = createdItem2.id;

  // READ (list all)
  await performOperation("READ (list all)", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  // READ (single comment)
  if (createdItemId1) {
    await performOperation("READ (single comment) item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("READ (single comment) item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/read`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // UPDATE operations
  if (createdItemId1) {
    await performOperation("UPDATE item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
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
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/update`, {
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
  if (createdItemId1) {
    await performOperation("DESTROY item 1", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId1 }),
      })
    );
  }

  if (createdItemId2) {
    await performOperation("DESTROY item 2", () =>
      fetchWithErrorHandling(`${apiendpoint}/api/cruda/destroy`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ id: createdItemId2 }),
      })
    );
  }

  // Verify deletion
  await performOperation("Verify deletion", () =>
    fetchWithErrorHandling(`${apiendpoint}/api/cruda/list`, {
      method: "POST",
      headers: getHeaders(),
    })
  );

  logger.debugWithContext("CRUD operations test completed", logContext);
}

async function accessProtectedRouteEcho(apiendpoint, echoInput) {
  const operationId = crypto.randomUUID();
  const logContext = {
    operationId,
    apiEndpoint: apiendpoint,
    operation: "ECHO_TEST",
  };

  const headers = {
    "Content-Type": "application/json",
  };

  logger.debugWithContext("Testing ECHO operation", logContext);

  try {
    const result = await fetchWithErrorHandling(`${apiendpoint}/api/echo`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Test Comment",
        description: "This is a test comment",
        message: echoInput,
      }),
    });

    if (result.error) {
      logContext.errorType = result.error;
      logContext.errorMessage = result.message;

      logger.errorWithContext("ECHO operation failed", logContext);

      if (result.error === "RateLimitExceeded") {
        logContext.retryAfter = result.retryAfter;
        logContext.maxRequests = result.maxRequests;
        logContext.windowMinutes = result.windowMinutes;

        logger.errorWithContext(
          `Rate limit exceeded. Try again in ${result.retryAfter} seconds`,
          logContext
        );
      }
    } else {
      logContext.responseReceived = true;
      logger.debugWithContext("Server responded to ECHO operation", logContext);
    }
  } catch (error) {
    logger.errorWithContext(
      "Unexpected error in ECHO operation",
      logContext,
      error
    );
  }
}

module.exports = {
  testCRUDAOperations,
  accessProtectedRouteEcho
};