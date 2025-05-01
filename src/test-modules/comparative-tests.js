// comparative-tests.js
const { ulid } = require("ulid");
const logger = require("../../config/logger");
const { stateManager, fetchWithErrorHandling } = require("../middleware/rodit");

// Import test modules
const authenticationTests = require("./authentication");
const permissionTests = require("./permissions");
const securityTests = require("./security");

/**
 * Comparative tests that specifically check the differences between
 * echo endpoint (auth only) and CRUDA endpoints (auth + permissions)
 */
const comparativeTests = {
  /**
   * Test authentication and permission differences between echo and CRUDA endpoints
   */
  /**
   * Test endpoint protections
   */
  testEndpointProtections: async (apiEndpoint) => {
    const moduleName = "comparative";
    const testName = "testEndpointProtections";
    const correlationId = ulid();

    // Log test start
    logger.info("Starting comparative endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Test authentication on both endpoints
      logger.info("Testing authentication on both endpoints", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_tests",
      });

      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();

      // FIX: Make sure we're explicitly testing WITHOUT authentication
      // by not including the token in the header
      const crudaNoAuthResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            // Explicitly NOT including Authorization header to test authentication
          },
        }
      );

      const echoNoAuthResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo/echo`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            // Explicitly NOT including Authorization header to test authentication
          },
        }
      );

      // Test permissions boundaries
      logger.info("Testing permissions boundaries", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "permission_tests",
      });

      // For CRUDA, this should be rejected based on permissions
      const crudaPermissionResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            action: "RESTRICTED_ACTION",
            data: { test: "permission boundary test" },
          }),
        }
      );

      // For Echo, this should be allowed (no permission boundary)
      const echoPermissionResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            action: "RESTRICTED_ACTION",
            data: { test: "permission boundary test" },
          }),
        }
      );

      // Test method restrictions
      logger.info("Testing method restrictions", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "method_tests",
      });

      // Test with non-standard method
      const crudaMethodResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/cruda`,
        {
          method: "OPTIONS",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        }
      );

      const echoMethodResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo/echo`,
        {
          method: "OPTIONS",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        }
      );

      // Compile results with corrected evaluation
      const results = {
        cruda: {
          endpoint: `${apiEndpoint}/api/cruda`,
          tests: {
            auth: {
              status: crudaNoAuthResult.status,
              // FIX: success means auth is required (unauthenticated requests are rejected)
              success:
                crudaNoAuthResult.status >= 401 &&
                crudaNoAuthResult.status <= 403,
            },
            permission_boundary: {
              expected: true,
              status: crudaPermissionResult.status,
              // FIX: success means permissions are enforced
              success: crudaPermissionResult.status === 403,
            },
            method_restriction: {
              expected: false,
              status: crudaMethodResult.status,
              // FIX: success means no method restrictions
              success: crudaMethodResult.status !== 405,
            },
          },
        },
        echo: {
          endpoint: `${apiEndpoint}/api/echo/echo`,
          tests: {
            auth: {
              status: echoNoAuthResult.status,
              // FIX: success means auth is required (unauthenticated requests are rejected)
              success:
                echoNoAuthResult.status >= 401 &&
                echoNoAuthResult.status <= 403,
            },
            permission_boundary: {
              expected: true,
              status: echoPermissionResult.status,
              // FIX: success means no permissions are enforced
              success: echoPermissionResult.status === 200,
            },
            method_restriction: {
              expected: false,
              status: echoMethodResult.status,
              // FIX: success means no method restrictions
              success: echoMethodResult.status !== 405,
            },
          },
        },
      };

      // Calculate differences
      const differences = {
        authDifference:
          results.cruda.tests.auth.success !== results.echo.tests.auth.success,
        permissionDifference:
          results.cruda.tests.permission_boundary.success !==
          results.echo.tests.permission_boundary.success,
        methodDifference:
          results.cruda.tests.method_restriction.success !==
          results.echo.tests.method_restriction.success,
      };

      // Expected differences based on test definition
      const expectedDifferences = {
        authDifference: false, // Both should require auth
        methodDifference: false, // Both should have same method restrictions
        permissionDifference: true, // They should have different permission boundaries
      };

      // Check if differences match expectations
      const allMatch =
        differences.authDifference === expectedDifferences.authDifference &&
        differences.methodDifference === expectedDifferences.methodDifference &&
        differences.permissionDifference ===
          expectedDifferences.permissionDifference;

      // Compile final test result
      const result = {
        success: allMatch,
        error: !allMatch
          ? "Protection differences do not match expectations"
          : null,
        details: {
          results,
          differences,
          expectedDifferences,
          explanation: !allMatch
            ? "Protection differences do not match expectations"
            : "All protection differences match expectations",
        },
      };

      // Log results with clear evaluation of each test aspect
      logger.info("Comparative test results", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        crudaAuth: {
          status: crudaNoAuthResult.status,
          requiresAuth: results.cruda.tests.auth.success,
        },
        echoAuth: {
          status: echoNoAuthResult.status,
          requiresAuth: results.echo.tests.auth.success,
        },
        crudaPermissions: {
          status: crudaPermissionResult.status,
          enforcesPermissions: results.cruda.tests.permission_boundary.success,
        },
        echoPermissions: {
          status: echoPermissionResult.status,
          enforcesPermissions: results.echo.tests.permission_boundary.success,
        },
        differences,
        expectedDifferences,
        match: allMatch,
      });

      return result;
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
        stack: error.stack,
      });

      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },
};

module.exports = comparativeTests;
