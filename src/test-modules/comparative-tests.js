// comparative-tests.js
const { ulid } = require("ulid");
const logger = require("../../config/logger");
const { stateManager } = require("../middleware/rodit");

// Import test modules
const authenticationTests = require("./authentication");
const permissionTests = require("./permissions");
const securityTests = require("./security");


// Ensure we have a valid token in the state manager
const token = await stateManager.getJwtToken();
if (!token) {
  logger.warn(`No JWT token available for ${testName}`, {
    component: "TestRunner",
    moduleName,
    testName,
  });
  
  // Return early with error
  const result = {
    success: false,
    error: "No JWT token available for testing",
  };
  return captureTestData(testName, moduleName, result, { apiEndpoint });
}

// Log token status
logger.debug(`Using token for ${testName}`, {
  component: "TestRunner",
  moduleName,
  testName,
  hasToken: true,
  tokenLength: token.length
});
/**
 * Comparative tests that specifically check the differences between 
 * echo endpoint (auth only) and CRUDA endpoints (auth + permissions)
 */
const comparativeTests = {
  /**
   * Test authentication and permission differences between echo and CRUDA endpoints
   */
  testEndpointProtections: async (apiEndpoint, logContext) => {
    const moduleName = "comparative";
    const testName = "testEndpointProtections";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start
    logger.info("Starting comparative endpoint test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const token = stateManager.getJwtToken();
      if (!token) {
        return {
          success: false,
          error: "No JWT token available for testing",
          testInfo: {
            testName,
            moduleName,
            timestamp: new Date().toISOString(),
          }
        };
      }

      testData.token = token;

      // Define the endpoints we want to compare
      const echoEndpoint = `${apiEndpoint}/api/echo`;
      const crudaEndpoint = `${apiEndpoint}/api/cruda`;

      // Test results for each endpoint
      const results = {
        echo: { endpoint: echoEndpoint, tests: {} },
        cruda: { endpoint: crudaEndpoint, tests: {} }
      };

      // 1. Test authentication on both endpoints (should succeed)
      logger.info("Testing authentication on both endpoints", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_tests",
      });

      // Simple auth test for echo endpoint
      const echoAuthTest = await fetch(echoEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: "Auth test" }),
      });

      results.echo.tests.auth = {
        success: echoAuthTest.ok,
        status: echoAuthTest.status
      };

      // Simple auth test for cruda list endpoint
      const crudaAuthTest = await fetch(`${crudaEndpoint}/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });

      results.cruda.tests.auth = {
        success: crudaAuthTest.ok,
        status: crudaAuthTest.status
      };

      // 2. Test permissions boundaries
      logger.info("Testing permissions boundaries", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "permission_tests",
      });

      // Test trying to access echo with tampered permissions in token 
      // (should still work since echo doesn't check permissions)
      const tamperedPermissionsTest = await fetch(echoEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Test-Permission": "invalid_permission" // Custom header for testing purposes
        },
        body: JSON.stringify({ message: "Permission boundary test" }),
      });

      results.echo.tests.permission_boundary = {
        success: tamperedPermissionsTest.ok,
        status: tamperedPermissionsTest.status,
        expected: true // Echo should accept this since it doesn't validate permissions
      };
      
      // Add test for cruda endpoint with tampered permissions
      // (should fail since cruda checks permissions)
      const crudaTamperedPermissionsTest = await fetch(`${crudaEndpoint}/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Test-Permission": "invalid_permission" // Custom header for testing purposes
        },
        body: JSON.stringify({}),
      });

      results.cruda.tests.permission_boundary = {
        success: !crudaTamperedPermissionsTest.ok, // We expect this to fail due to permission check
        status: crudaTamperedPermissionsTest.status,
        expected: true // CRUDA should reject invalid permissions
      };

      // 3. Test method restrictions
      logger.info("Testing method restrictions", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "method_tests",
      });

      // Try to use GET on both endpoints (assuming both only allow POST)
      const echoGetTest = await fetch(echoEndpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        }
      });

      results.echo.tests.method_restriction = {
        success: !echoGetTest.ok, // Should fail if echo only allows POST
        status: echoGetTest.status,
        expected: false
      };

      const crudaGetTest = await fetch(`${crudaEndpoint}/list`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        }
      });

      results.cruda.tests.method_restriction = {
        success: !crudaGetTest.ok, // Should fail if cruda only allows POST
        status: crudaGetTest.status,
        expected: false
      };

      // Compare the results and check for differences
      const authDifference = results.echo.tests.auth.success !== results.cruda.tests.auth.success;
      
      // Echo should accept our test permission tampering, while CRUDA should not
      const permissionDifference = results.echo.tests.permission_boundary.success !== results.cruda.tests.permission_boundary.success;
      
      // Both endpoints should reject GET method similarly
      const methodDifference = results.echo.tests.method_restriction.success !== results.cruda.tests.method_restriction.success;

      const expectedDifferences = {
        authDifference: false, // Both should require authentication
        permissionDifference: true, // They should differ in permission handling
        methodDifference: false // Both should have similar method restrictions
      };

      // Log comparative results
      logger.info("Comparative test results", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        results,
        differences: {
          authDifference,
          permissionDifference,
          methodDifference
        },
        expectedDifferences
      });

      // Test is successful if the differences match our expectations
      const success = 
        authDifference === expectedDifferences.authDifference &&
        permissionDifference === expectedDifferences.permissionDifference &&
        methodDifference === expectedDifferences.methodDifference;

      return {
        success,
        details: {
          results,
          differences: {
            authDifference,
            permissionDifference,
            methodDifference
          },
          expectedDifferences,
          explanation: success 
            ? "Echo and CRUDA endpoints show the expected protection differences" 
            : "Protection differences do not match expectations"
        },
        testInfo: {
          testName,
          moduleName,
          timestamp: new Date().toISOString(),
        }
      };
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

      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
        testInfo: {
          testName,
          moduleName,
          timestamp: new Date().toISOString(),
        }
      };
    }
  }
};

module.exports = comparativeTests;