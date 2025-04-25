// test-modules/authentication.js
const crypto = require("crypto");
const nacl = require("tweetnacl");
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
 * Authentication test module
 */
const authenticationTests = {
  /**
   * Test verify_rodit_ownership with valid and invalid signatures
   */
  testVerifyRoditOwnership: async (apiEndpoint, logContext) => {
    const moduleName = "authentication";
    const testName = "testVerifyRoditOwnership";
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

    // Get stored JWT token
    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    // Update test data with actual values
    testData.token = token;

    // Log test phase
    logger.info("Test phase", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "valid_signature_test",
    });

    try {
      // Test with valid credentials/signature
      const validResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/verify_ownership`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ testData: "Valid signature test" }),
        }
      );

      testData.validResult = validResult;

      if (validResult.error) {
        const result = {
          success: false,
          error: `Valid signature verification failed: ${validResult.error}`,
          details: validResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_signature_test",
      });

      // Test with invalid signature
      // Create a tampered token by changing a character
      const tamperedToken =
        token.substring(0, token.length - 5) +
        (token.charAt(token.length - 5) === "A" ? "B" : "A") +
        token.substring(token.length - 4);

      testData.tamperedToken = tamperedToken;

      const invalidResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/verify_ownership`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tamperedToken}`,
          },
          body: JSON.stringify({ testData: "Invalid signature test" }),
        }
      );

      testData.invalidResult = invalidResult;

      // This should fail with an error about invalid signature
      if (!invalidResult.error || !invalidResult.error.includes("signature")) {
        const result = {
          success: false,
          error: "System did not reject invalid signature as expected",
          details: { invalidResult },
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
          validSignatureAccepted: true,
          invalidSignatureRejected: true,
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
   * Test validate_jwt_token_be with various token states
   */
  testJwtValidation: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Test with valid token
      const validResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/validate_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (validResult.error) {
        return {
          success: false,
          error: `Valid token validation failed: ${validResult.error}`,
          details: validResult,
        };
      }

      // Test with expired token (if we can generate one)
      // This might require special setup to create an expired token

      // Test with invalid token format
      const malformedToken = "invalid.token.format";
      const malformedResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/validate_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${malformedToken}`,
          },
        }
      );

      if (!malformedResult.error) {
        return {
          success: false,
          error: "System did not reject malformed token as expected",
          details: { malformedResult },
        };
      }

      // Test with empty token
      const emptyResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/validate_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer ",
          },
        }
      );

      if (!emptyResult.error) {
        return {
          success: false,
          error: "System did not reject empty token as expected",
          details: { emptyResult },
        };
      }

      return {
        success: true,
        details: {
          validTokenAccepted: true,
          malformedTokenRejected: !!malformedResult.error,
          emptyTokenRejected: !!emptyResult.error,
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
   * Test login flow with various scenarios
   */
  testLoginFlow: async (apiEndpoint, logContext) => {
    try {
      // Get current configuration
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit) {
        return {
          success: false,
          error: "No RODiT configuration available for testing",
        };
      }

      // Test valid login flow
      const validLoginResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rodit: config.own_rodit,
          }),
        }
      );

      if (validLoginResult.error) {
        return {
          success: false,
          error: `Valid login failed: ${validLoginResult.error}`,
          details: validLoginResult,
        };
      }

      // Test with invalid credentials (modified key)
      const invalidConfig = JSON.parse(JSON.stringify(config));
      if (invalidConfig.own_rodit.bytes_ed25519_public_key) {
        // Modify a byte in the public key to make it invalid
        if (
          typeof invalidConfig.own_rodit.bytes_ed25519_public_key === "string"
        ) {
          invalidConfig.own_rodit.bytes_ed25519_public_key =
            invalidConfig.own_rodit.bytes_ed25519_public_key.replace(/A/g, "B");
        }
      }

      const invalidLoginResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            rodit: invalidConfig.own_rodit,
          }),
        }
      );

      // This should fail with an authentication error
      if (!invalidLoginResult.error) {
        return {
          success: false,
          error: "System did not reject invalid credentials as expected",
          details: { invalidLoginResult },
        };
      }

      return {
        success: true,
        details: {
          validLoginSuccessful: !!validLoginResult.jwt_token,
          invalidLoginRejected: !!invalidLoginResult.error,
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
   * Test token renewal flows
   */
  testTokenRenewal: async (apiEndpoint, logContext) => {
    try {
      const token = await stateManager.getJwtToken();
      if (!token) {
        return {
          success: false,
          error: "No JWT token available for testing",
        };
      }

      // Test standard token renewal
      const renewalResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/auth/renew_token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (renewalResult.error) {
        return {
          success: false,
          error: `Token renewal failed: ${renewalResult.error}`,
          details: renewalResult,
        };
      }

      // If successful, we should have received a new token
      if (!renewalResult.jwt_token) {
        return {
          success: false,
          error: "Token renewal did not return a new token",
          details: renewalResult,
        };
      }

      // Store the new token for future tests
      await stateManager.setJwtToken(renewalResult.jwt_token);

      return {
        success: true,
        details: {
          tokenRenewed: true,
          newTokenReceived: !!renewalResult.jwt_token,
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

module.exports = authenticationTests;
