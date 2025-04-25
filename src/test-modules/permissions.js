// test-modules/permission.js
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");
const { ulid } = require("ulid");
const logger = require("../../../config/logger");

// Add this utility function after imports
function captureTestData(testName, moduleName, result, testData) {
  const fs = require("fs");
  const path = require("path");

  // Create consistent result format with test info
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
  };

  // Only capture extended data on failure
  if (!result.success) {
    // Create unique ID for this failure
    const correlationId = ulid();

    // Add failure info
    result.testInfo.correlationId = correlationId;
    result.testInfo.failureData = true;

    // Log with consistent identifiers
    logger.error(`Test '${testName}' failed`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      error: result.error,
    });

    try {
      // Ensure directory exists
      const failureDirPath = path.join(process.cwd(), "test-failures");
      if (!fs.existsSync(failureDirPath)) {
        fs.mkdirSync(failureDirPath, { recursive: true });
      }

      // Save detailed data to file
      const failureData = {
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      };

      const filename = path.join(
        failureDirPath,
        `${moduleName}_${testName}_${correlationId}.json`
      );
      fs.writeFileSync(filename, JSON.stringify(failureData, null, 2));

      result.testInfo.failureDataPath = filename;

      logger.info(`Failure data saved to file`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        filePath: filename,
      });
    } catch (saveError) {
      logger.error(`Failed to save failure data`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: saveError.message,
      });
    }
  }

  return result;
}

/**
 * Permission test module - refactored to use actual server endpoints
 */
const permissionTests = {
  /**
   * Test permission validation middleware with CRUDA API
   */
  testCrudaPermissions: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testCrudaPermissions";
    const correlationId = ulid();
    const testData = { apiEndpoint };

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
      const createResult = await fetchWithErrorHandling(
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

      testData.createResult = createResult;

      if (createResult.error) {
        const result = {
          success: false,
          error: `Create operation failed: ${createResult.error}`,
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store comment ID for later operations
      const commentId = createResult.id;
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
      const readResult = await fetchWithErrorHandling(
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

      testData.readResult = readResult;

      if (readResult.error) {
        const result = {
          success: false,
          error: `Read operation failed: ${readResult.error}`,
          details: readResult,
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
      const listResult = await fetchWithErrorHandling(
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

      testData.listResult = listResult;

      if (listResult.error) {
        const result = {
          success: false,
          error: `List operation failed: ${listResult.error}`,
          details: listResult,
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
      const updateResult = await fetchWithErrorHandling(
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

      testData.updateResult = updateResult;

      if (updateResult.error) {
        const result = {
          success: false,
          error: `Update operation failed: ${updateResult.error}`,
          details: updateResult,
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
      const destroyResult = await fetchWithErrorHandling(
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

      testData.destroyResult = destroyResult;

      if (destroyResult.error) {
        const result = {
          success: false,
          error: `Destroy operation failed: ${destroyResult.error}`,
          details: destroyResult,
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
          createSuccessful: !createResult.error,
          readSuccessful: !readResult.error,
          listSuccessful: !listResult.error,
          updateSuccessful: !updateResult.error,
          destroySuccessful: !destroyResult.error,
          commentId,
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
        const result = await fetchWithErrorHandling(
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
          rejected: !!result.error,
          error: result.error,
          statusCode: result.statusCode
        };
      }

      // Also test echo endpoint
      const echoResult = await fetchWithErrorHandling(
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
        rejected: !!echoResult.error,
        error: echoResult.error,
        statusCode: echoResult.statusCode
      };

      testData.noTokenResults = noTokenResults;

      // All requests without a token should be rejected
      const allRejected = Object.values(noTokenResults).every(r => r.rejected);

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allRejected,
      });

      const result = {
        success: allRejected,
        error: !allRejected ? "System did not reject all unauthorized access attempts" : null,
        details: {
          noTokenResults,
          allRejected,
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
      const createResult = await fetchWithErrorHandling(
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

      testData.createResult = createResult;

      if (createResult.error) {
        const result = {
          success: false,
          error: `Create operation failed: ${createResult.error}`,
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Store the comment ID
      const commentId = createResult.id;
      testData.commentId = commentId;

      // Detect if commentsRate exists to identify the permission scope
      const detectedScope = createResult.commentsRate ? {
        rate: createResult.commentsRate,
        // Based on your validation logic, + indicates entityAndProperties
        scope: createResult.commentsRate.startsWith("+") ? "entityAndProperties" : 
               createResult.commentsRate.startsWith("-") ? "propertiesOnly" : "entityOnly"
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
      const invalidIdResult = await fetchWithErrorHandling(
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

      testData.invalidIdResult = invalidIdResult;
      
      // This should be rejected with a 404
      const invalidIdRejected = !!invalidIdResult.error;

      // Log test phase - cleanup
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cleanup",
      });

      // Clean up the test comment
      const destroyResult = await fetchWithErrorHandling(
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

      testData.destroyResult = destroyResult;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        detectedScope: detectedScope?.scope || "unknown",
        invalidIdRejected,
      });

      const result = {
        success: !createResult.error && !destroyResult.error && invalidIdRejected,
        error: createResult.error ? `Create operation failed: ${createResult.error}` :
               destroyResult.error ? `Destroy operation failed: ${destroyResult.error}` :
               !invalidIdRejected ? "System did not reject invalid entity ID" : null,
        details: {
          detectedScope,
          createSuccessful: !createResult.error,
          destroySuccessful: !destroyResult.error,
          invalidIdRejected,
          commentId,
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
      const postResult = await fetchWithErrorHandling(
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

      testData.postResult = postResult;

      // Log test phase - test GET method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "get_method",
      });

      // Test GET method (will likely fail based on your implementation)
      const getResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.getResult = getResult;

      // Log test phase - test PUT method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "put_method",
      });

      // Test PUT method
      const putResult = await fetchWithErrorHandling(
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

      testData.putResult = putResult;

      // Log test phase - test DELETE method
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "delete_method",
      });

      // Test DELETE method
      const deleteResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.deleteResult = deleteResult;

      // Analyze which methods are allowed
      const methodResults = {
        POST: { success: !postResult.error, error: postResult.error },
        GET: { success: !getResult.error, error: getResult.error },
        PUT: { success: !putResult.error, error: putResult.error },
        DELETE: { success: !deleteResult.error, error: deleteResult.error },
      };

      const allowedMethods = Object.keys(methodResults).filter(
        method => methodResults[method].success
      );

      // At least POST should be allowed for proper API functionality
      const postAllowed = !postResult.error;

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
          ? "POST method is not allowed, which is required for basic API functionality" 
          : null,
        details: {
          methodResults,
          allowedMethods,
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