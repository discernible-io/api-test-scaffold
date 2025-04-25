// test-modules/permission.js
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");

// Add this utility function after imports
function captureTestData(testName, moduleName, result, testData) {
  const fs = require("fs");
  const path = require("path");
  const { ulid } = require("ulid");

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
 * Permission test module
 */
const permissionTests = {
  /**
   * Test different permission scopes
   */
  testPermissionScopes: async (apiEndpoint, logContext) => {
    const moduleName = "permission";
    const testName = "testPermissionScopes";
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
      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "scope_info_fetch",
      });

      // First, get the current permission scope information
      const scopeInfo = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/scope_info`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.scopeInfo = scopeInfo;

      if (scopeInfo.error) {
        const result = {
          success: false,
          error: `Failed to get scope information: ${scopeInfo.error}`,
          details: scopeInfo,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "testing_endpoints",
      });

      // Test accessing endpoints with different scopes
      const scopeResults = {};

      // 1. Test entityOnly scope
      if (scopeInfo.availableScopes?.includes("entityOnly")) {
        logger.debug("Testing entityOnly scope", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "entityOnly_scope",
        });

        const entityOnlyResult = await fetchWithErrorHandling(
          `${apiEndpoint}/api/resources/entity`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        testData.entityOnlyResult = entityOnlyResult;

        scopeResults.entityOnly = {
          success: !entityOnlyResult.error,
          error: entityOnlyResult.error,
        };
      }

      // 2. Test entityAndProperties scope
      if (scopeInfo.availableScopes?.includes("entityAndProperties")) {
        logger.debug("Testing entityAndProperties scope", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "entityAndProperties_scope",
        });

        const entityPropsResult = await fetchWithErrorHandling(
          `${apiEndpoint}/api/resources/properties`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        testData.entityPropsResult = entityPropsResult;

        scopeResults.entityAndProperties = {
          success: !entityPropsResult.error,
          error: entityPropsResult.error,
        };
      }

      // 3. Test admin scope (should fail with standard token)
      logger.debug("Testing admin scope", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "admin_scope",
      });

      const adminResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/admin/action`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.adminResult = adminResult;

      scopeResults.admin = {
        rejected: !!adminResult.error,
        error: adminResult.error,
      };

      const successfulScopes = Object.keys(scopeResults).filter(
        (scope) => scope !== "admin" && scopeResults[scope].success
      );

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        successfulScopes,
        adminRejected: scopeResults.admin.rejected,
      });

      const result = {
        success: successfulScopes.length > 0 && scopeResults.admin.rejected,
        error:
          successfulScopes.length === 0
            ? "No permission scopes working"
            : !scopeResults.admin.rejected
            ? "Admin permissions not properly restricted"
            : null,
        details: {
          availableScopes: scopeInfo.availableScopes,
          currentScope: scopeInfo.currentScope,
          scopeResults,
          successfulScopes,
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
   * Test entity matching logic
   */
  testEntityMatching: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // 1. Test own entity access
      const ownEntityResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/entities/own`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // 2. Test another entity access (should fail)
      const otherEntityResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/entities/other`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // 3. Test wildcard entity access (configuration specific)
      const wildcardEntityResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/entities/wildcard`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const ownEntityAccess = !ownEntityResult.error;
      const otherEntityRejected = !!otherEntityResult.error;

      return {
        success: ownEntityAccess && otherEntityRejected,
        error: !ownEntityAccess
          ? "Failed to access own entity"
          : !otherEntityRejected
          ? "System allowed access to another entity"
          : null,
        details: {
          ownEntityAccess,
          otherEntityRejected,
          wildcardAccess: !wildcardEntityResult.error,
          ownEntityError: ownEntityResult.error,
          otherEntityError: otherEntityResult.error,
          wildcardError: wildcardEntityResult.error,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },

  /**
   * Test method permission mapping
   */
  testMethodPermissions: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Get method permissions map
      const permissionsMap = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/method_permissions`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (permissionsMap.error) {
        return {
          success: false,
          error: `Failed to get method permissions map: ${permissionsMap.error}`,
          details: permissionsMap,
        };
      }

      // Test different HTTP methods on an endpoint
      const methodResults = {};
      const testEndpoint = `${apiEndpoint}/api/resources/test_methods`;

      // Test GET method
      const getResult = await fetchWithErrorHandling(testEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      methodResults.GET = {
        success: !getResult.error,
        error: getResult.error,
      };

      // Test POST method
      const postResult = await fetchWithErrorHandling(testEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "test" }),
      });

      methodResults.POST = {
        success: !postResult.error,
        error: postResult.error,
      };

      // Test PUT method
      const putResult = await fetchWithErrorHandling(testEndpoint, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ action: "update" }),
      });

      methodResults.PUT = {
        success: !putResult.error,
        error: putResult.error,
      };

      // Test DELETE method
      const deleteResult = await fetchWithErrorHandling(testEndpoint, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      methodResults.DELETE = {
        success: !deleteResult.error,
        error: deleteResult.error,
      };

      // Check results against permissions map
      const allowedMethods = Object.keys(methodResults).filter(
        (method) => methodResults[method].success
      );

      return {
        success: true, // Even if some methods are denied, this is still valid test information
        details: {
          permissionsMap: permissionsMap.methods || {},
          methodResults,
          allowedMethods,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },

  /**
   * Test accessing resources outside permission scope
   */
  testResourceAccess: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Get available resources
      const resourcesInfo = await fetchWithErrorHandling(
        `${apiEndpoint}/api/resources/available`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (resourcesInfo.error) {
        return {
          success: false,
          error: `Failed to get resources information: ${resourcesInfo.error}`,
          details: resourcesInfo,
        };
      }

      const allowedResources = resourcesInfo.allowed || [];
      const restrictedResources = resourcesInfo.restricted || [];

      // Test access to allowed resources
      const allowedResults = {};
      for (const resource of allowedResources.slice(0, 3)) {
        // Limit to first 3
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/resources/${resource}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        allowedResults[resource] = {
          success: !result.error,
          error: result.error,
        };
      }

      // Test access to restricted resources
      const restrictedResults = {};
      for (const resource of restrictedResources.slice(0, 3)) {
        // Limit to first 3
        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/resources/${resource}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        restrictedResults[resource] = {
          rejected: !!result.error,
          error: result.error,
        };
      }

      // Check if permissions are enforced correctly
      const allowedAccessSuccessful = Object.values(allowedResults).every(
        (result) => result.success
      );

      const restrictedAccessRejected = Object.values(restrictedResults).every(
        (result) => result.rejected
      );

      return {
        success: allowedAccessSuccessful && restrictedAccessRejected,
        error: !allowedAccessSuccessful
          ? "Failed to access allowed resources"
          : !restrictedAccessRejected
          ? "System allowed access to restricted resources"
          : null,
        details: {
          allowedResources,
          restrictedResources,
          allowedResults,
          restrictedResults,
          allowedAccessSuccessful,
          restrictedAccessRejected,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },
};

module.exports = permissionTests;
