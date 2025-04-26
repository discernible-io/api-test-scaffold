// test-modules/permission.js
const { stateManager } = require("../middleware/rodit");
const { ulid } = require("ulid");
const logger = require("../../config/logger");

// Add this utility function after imports
function captureTestData(testName, moduleName, result, testData) {
  // Create consistent result format with test info
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || testData.apiEndpoint || "unknown", // Add endpoint information
  };

  // Only capture extended data on failure
  if (!result.success) {
    // Create unique ID for this failure
    const correlationId = ulid();
    
    // Add failure info
    result.testInfo.correlationId = correlationId;
    result.testInfo.failureData = true;
    
    // Log with consistent identifiers and endpoint information
    logger.error(`Test '${testName}' failed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint, // Include endpoint in structured log
      correlationId,
      error: result.error,
    });

    try {
      // Instead of saving to file, log the detailed data
      const failureData = {
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      };
      
      // Log detailed failure data with endpoint info
      logger.info(`Test failure details`, {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
        correlationId,
        failureData: JSON.stringify(failureData),
      });
      
      // Add metric for test failure with endpoint
      logger.metric('test_failure', 1, {
        module: moduleName,
        test: testName,
        endpoint: result.testInfo.endpoint,
        correlation_id: correlationId
      });
      
    } catch (logError) {
      logger.error(`Failed to log failure data`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: logError.message,
      });
    }
  } else {
    // Log successful test execution with endpoint info
    logger.debug(`Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint // Include endpoint in structured log
    });
    
    // Add metric for test success with endpoint info
    logger.metric('test_success', 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint
    });
  }
  
  return result;
}

/**
 * Direct fetch function with proper error handling but without masking API responses
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} - A structured response object
 */
async function directFetch(url, options = {}) {
  const requestId = options.headers?.["X-Request-ID"] || ulid();
  
  try {
    const response = await fetch(url, options);
    
    let responseBody = null;
    let responseText = null;
    
    // Try to parse as JSON first
    try {
      responseText = await response.text();
      responseBody = JSON.parse(responseText);
    } catch (parseError) {
      // If parsing fails, keep the text response
      responseBody = { text: responseText };
    }
    
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data: responseBody,
      raw: responseText,
      requestId
    };
  } catch (error) {
    // Network errors or other fetch failures
    return {
      ok: false,
      status: 0,
      statusText: "Network Error",
      error: error.message,
      errorType: error.name,
      stack: error.stack,
      requestId
    };
  }
}

const permissionTests = {
  /**
   * Test permission validation middleware with CRUDA API
   */
  testCrudaPermissions: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testCrudaPermissions";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    
    // Update testData to include the specific endpoint
    testData.endpoint = `${apiEndpoint}/api/echo`;
    
    // Log test start with correlation ID
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
      // Log test phase - create operation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "create_operation",
      });

      // Test CREATE operation with proper permissions
      const createResponse = await directFetch(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            title: "Permission Test Comment",
            content: "This is a test comment for permission validation"
          }),
        }
      );

      testData.createResponse = createResponse;

      if (!createResponse.ok) {
        const result = {
          success: false,
          error: `Create operation failed with status ${createResponse.status}: ${createResponse.statusText}`,
          details: createResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store comment ID for later operations
      const commentId = createResponse.data.id;
      if (!commentId) {
        const result = {
          success: false,
          error: "Create operation succeeded but didn't return a valid comment ID",
          details: createResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }
      
      testData.commentId = commentId;

      // Log test phase - read operation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "read_operation",
      });

      // Test READ operation 
      const readResponse = await directFetch(
        `${apiEndpoint}/api/cruda/read`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ id: commentId }),
        }
      );

      testData.readResponse = readResponse;

      if (!readResponse.ok) {
        const result = {
          success: false,
          error: `Read operation failed with status ${readResponse.status}: ${readResponse.statusText}`,
          details: readResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - list operation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "list_operation",
      });

      // Test LIST operation
      const listResponse = await directFetch(
        `${apiEndpoint}/api/cruda/list`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({}),
        }
      );

      testData.listResponse = listResponse;

      if (!listResponse.ok) {
        const result = {
          success: false,
          error: `List operation failed with status ${listResponse.status}: ${listResponse.statusText}`,
          details: listResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - update operation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "update_operation",
      });

      // Test UPDATE operation
      const updateResponse = await directFetch(
        `${apiEndpoint}/api/cruda/update`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: commentId,
            title: "Updated Permission Test",
            content: "This comment was updated during permission testing"
          }),
        }
      );

      testData.updateResponse = updateResponse;

      if (!updateResponse.ok) {
        const result = {
          success: false,
          error: `Update operation failed with status ${updateResponse.status}: ${updateResponse.statusText}`,
          details: updateResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase - destroy operation
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "destroy_operation",
      });

      // Test DESTROY operation
      const destroyResponse = await directFetch(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ id: commentId }),
        }
      );

      testData.destroyResponse = destroyResponse;

      if (!destroyResponse.ok) {
        const result = {
          success: false,
          error: `Destroy operation failed with status ${destroyResponse.status}: ${destroyResponse.statusText}`,
          details: destroyResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
      });

      const result = {
        success: true,
        details: {
          createSuccessful: createResponse.ok,
          readSuccessful: readResponse.ok,
          listSuccessful: listResponse.ok,
          updateSuccessful: updateResponse.ok,
          destroySuccessful: destroyResponse.ok,
          commentId,
          createStatus: createResponse.status,
          readStatus: readResponse.status,
          listStatus: listResponse.status,
          updateStatus: updateResponse.status,
          destroyStatus: destroyResponse.status
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
   * Test unauthorized access with missing token
   */
  testUnauthorizedAccess: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testUnauthorizedAccess";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Log test phase - test without token
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "no_token_access",
      });

      // Try to access protected endpoints without a token
      const noTokenResults = {};

      // Test CRUDA operations without authentication
      const endpoints = [
        "create",
        "read",
        "update",
        "list",
        "destroy"
      ];

      for (const endpoint of endpoints) {
        const response = await directFetch(
          `${apiEndpoint}/api/cruda/${endpoint}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              // No Authorization header
            },
            body: JSON.stringify({
              // Just send minimal data
              title: "Unauthorized Test",
              content: "Testing unauthorized access",
              id: 1 // For operations that need an ID
            }),
          }
        );

        noTokenResults[endpoint] = {
          rejected: !response.ok,
          status: response.status,
          statusText: response.statusText
        };
      }

      // Also test echo endpoint
      const echoResponse = await directFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // No Authorization header
          },
          body: JSON.stringify({ message: "Test unauthorized access" }),
        }
      );

      noTokenResults.echo = {
        rejected: !echoResponse.ok,
        status: echoResponse.status,
        statusText: echoResponse.statusText
      };

      testData.noTokenResults = noTokenResults;

      // All requests without a token should be rejected with appropriate status codes
      const allRejected = Object.values(noTokenResults).every(r => r.rejected);
      const allProperStatusCodes = Object.values(noTokenResults).every(
        r => r.status === 401 || r.status === 403
      );

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allRejected,
        allProperStatusCodes,
      });

      const result = {
        success: allRejected && allProperStatusCodes,
        error: !allRejected 
          ? "System did not reject all unauthorized access attempts" 
          : !allProperStatusCodes 
          ? "Some endpoints did not return proper authorization error status codes" 
          : null,
        details: {
          noTokenResults,
          allRejected,
          allProperStatusCodes,
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
   * Test permission scopes using your middleware/validatepermissions implementation
   */
  testPermissionScopes: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testPermissionScopes";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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
      // Testing permissions based on actual implementation
      // This test will extract scopes from the token response during CRUDA operations

      // Log test phase - check create success with entity scope
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "create_with_permissions",
      });

      // Create a comment to check permissions
      const createResponse = await directFetch(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            title: "Permission Scope Test",
            content: "Testing different permission scopes"
          }),
        }
      );

      testData.createResponse = createResponse;

      if (!createResponse.ok) {
        const result = {
          success: false,
          error: `Create operation failed with status ${createResponse.status}: ${createResponse.statusText}`,
          details: createResponse,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the comment ID
      const commentId = createResponse.data.id;
      testData.commentId = commentId;

      // Detect if commentsRate exists to identify the permission scope
      const detectedScope = createResponse.data.commentsRate ? {
        rate: createResponse.data.commentsRate,
        // Based on your validation logic, + indicates entityAndProperties
        scope: createResponse.data.commentsRate.startsWith("+") ? "entityAndProperties" : 
               createResponse.data.commentsRate.startsWith("-") ? "propertiesOnly" : "entityOnly"
      } : null;

      testData.detectedScope = detectedScope;

      // Log test phase - test invalid entity ID
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "test_nonexistent_entity",
      });

      // Try to access a non-existent entity ID
      const invalidIdResponse = await directFetch(
        `${apiEndpoint}/api/cruda/read`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ id: 9999999 }), // Using a likely invalid ID
        }
      );

      testData.invalidIdResponse = invalidIdResponse;
      
      // This should be rejected with a 404
      const invalidIdRejected = !invalidIdResponse.ok;
      const invalidIdProperStatusCode = invalidIdResponse.status === 404;

      // Log test phase - cleanup
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cleanup",
      });

      // Clean up the test comment
      const destroyResponse = await directFetch(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ id: commentId }),
        }
      );

      testData.destroyResponse = destroyResponse;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        detectedScope: detectedScope?.scope || "unknown",
        invalidIdRejected,
        invalidIdProperStatusCode,
      });

      const result = {
        success: createResponse.ok && destroyResponse.ok && invalidIdRejected && invalidIdProperStatusCode,
        error: !createResponse.ok ? `Create operation failed with status ${createResponse.status}` :
               !destroyResponse.ok ? `Destroy operation failed with status ${destroyResponse.status}` :
               !invalidIdRejected ? "System did not reject invalid entity ID" :
               !invalidIdProperStatusCode ? "System did not return proper 404 status for invalid entity ID" : null,
        details: {
          detectedScope,
          createSuccessful: createResponse.ok,
          destroySuccessful: destroyResponse.ok,
          invalidIdRejected,
          invalidIdProperStatusCode,
          commentId,
          createStatus: createResponse.status,
          destroyStatus: destroyResponse.status,
          invalidIdStatus: invalidIdResponse.status
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
   * Test method permissions using different HTTP methods
   */
  testMethodPermissions: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testMethodPermissions";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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
      // Log test phase - test POST method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "post_method",
      });

      // Test POST method (should work for echo endpoint)
      const postResponse = await directFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "Testing POST method" }),
        }
      );

      testData.postResponse = postResponse;

      // Log test phase - test GET method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "get_method",
      });

      // Test GET method (will likely fail based on your implementation)
      const getResponse = await directFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.getResponse = getResponse;

      // Log test phase - test PUT method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "put_method",
      });

      // Test PUT method
      const putResponse = await directFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "Testing PUT method" }),
        }
      );

      testData.putResponse = putResponse;

      // Log test phase - test DELETE method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "delete_method",
      });

      // Test DELETE method
      const deleteResponse = await directFetch(
        `${apiEndpoint}/api/echo`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.deleteResponse = deleteResponse;

      // Analyze which methods are allowed
      const methodResults = {
        POST: { success: postResponse.ok, status: postResponse.status, statusText: postResponse.statusText },
        GET: { success: getResponse.ok, status: getResponse.status, statusText: getResponse.statusText },
        PUT: { success: putResponse.ok, status: putResponse.status, statusText: putResponse.statusText },
        DELETE: { success: deleteResponse.ok, status: deleteResponse.status, statusText: deleteResponse.statusText },
      };

      const allowedMethods = Object.keys(methodResults).filter(
        method => methodResults[method].success
      );

      // At least POST should be allowed for proper API functionality
      const postAllowed = postResponse.ok;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allowedMethods,
        postAllowed,
      });

      const result = {
        success: postAllowed, // At minimum, POST should work
        error: !postAllowed 
          ? `POST method is not allowed (status: ${postResponse.status}), which is required for basic API functionality` 
          : null,
        details: {
          methodResults,
          allowedMethods,
          postStatus: postResponse.status,
          getStatus: getResponse.status,
          putStatus: putResponse.status,
          deleteStatus: deleteResponse.status
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

module.exports = permissionTests;