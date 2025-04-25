// test-modules/security.js
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
 * Security test module
 */
const securityTests = {
  /**
   * Test webhook signature verification
   */
  testWebhookSecurity: async (apiEndpoint, logContext) => {
    const moduleName = "security";
    const testName = "testWebhookSecurity";
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
        phase: "setup_keypair",
      });

      // Get keypair for signing webhooks
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit) {
        const result = {
          success: false,
          error: "No RODIT config available for webhook testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.hasConfig = !!config;

      // Get the webhook URL from server config
      const webhookEndpointInfo = await fetchWithErrorHandling(
        `${apiEndpoint}/api/webhooks/info`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      testData.webhookEndpointInfo = webhookEndpointInfo;

      if (webhookEndpointInfo.error) {
        const result = {
          success: false,
          error: `Failed to get webhook endpoint info: ${webhookEndpointInfo.error}`,
          details: webhookEndpointInfo,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const webhookUrl =
        webhookEndpointInfo.webhookUrl ||
        "https://dev-webhook.aparejos.net/webhook";
      testData.webhookUrl = webhookUrl;

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "create_payload",
      });

      // Create test payload
      const payload = {
        event: "security_test",
        data: {
          testId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
        },
      };

      testData.payload = payload;
      const payloadString = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      testData.timestamp = timestamp;

      // 1. Test with valid signature
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "valid_signature_test",
      });

      const message = `${timestamp}.${payloadString}`;
      const messageBytes = Buffer.from(message, "utf8");

      // Generate a signature using the keypair
      const privateKeyHex =
        config.own_rodit.private_key ||
        config.own_rodit.bytes_ed25519_private_key;

      if (!privateKeyHex) {
        const result = {
          success: false,
          error: "Private key not available for signing webhook",
          details: { config: "REDACTED" },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Convert hex to Uint8Array for TweetNaCl
      const privateKeyBytes = Buffer.from(privateKeyHex, "hex");

      // Sign the message
      const signatureBytes = nacl.sign.detached(messageBytes, privateKeyBytes);

      const signature = Buffer.from(signatureBytes).toString("hex");
      testData.signatureLength = signature.length;

      // Send webhook with valid signature
      const validResult = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Timestamp": timestamp,
        },
        body: payloadString,
      });

      const validResponse = {
        status: validResult.status,
        statusText: validResult.statusText,
        body: await validResult.text().catch(() => ""),
      };

      testData.validResponse = validResponse;

      // 2. Test with invalid signature (tampered)
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "invalid_signature_test",
      });

      const invalidSignature =
        signature.substring(0, signature.length - 2) +
        (signature.charAt(signature.length - 2) === "a" ? "b" : "a") +
        signature.charAt(signature.length - 1);

      testData.invalidSignatureLength = invalidSignature.length;

      const invalidResult = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": invalidSignature,
          "X-Timestamp": timestamp,
        },
        body: payloadString,
      });

      const invalidResponse = {
        status: invalidResult.status,
        statusText: invalidResult.statusText,
        body: await invalidResult.text().catch(() => ""),
      };

      testData.invalidResponse = invalidResponse;

      // 3. Test with tampered payload
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "tampered_payload_test",
      });

      const tamperedPayload = JSON.stringify({
        ...payload,
        data: {
          ...payload.data,
          tampered: true,
        },
      });

      const tamperedResult = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Timestamp": timestamp,
        },
        body: tamperedPayload,
      });

      const tamperedResponse = {
        status: tamperedResult.status,
        statusText: tamperedResult.statusText,
        body: await tamperedResult.text().catch(() => ""),
      };

      testData.tamperedResponse = tamperedResponse;

      // 4. Test with expired timestamp
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "expired_timestamp_test",
      });

      const expiredTimestamp = (Math.floor(Date.now() / 1000) - 600).toString(); // 10 minutes in the past
      const expiredMessage = `${expiredTimestamp}.${payloadString}`;
      const expiredMessageBytes = Buffer.from(expiredMessage, "utf8");

      testData.expiredTimestamp = expiredTimestamp;

      const expiredSignatureBytes = nacl.sign.detached(
        expiredMessageBytes,
        privateKeyBytes
      );

      const expiredSignature = Buffer.from(expiredSignatureBytes).toString(
        "hex"
      );

      const expiredResult = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": expiredSignature,
          "X-Timestamp": expiredTimestamp,
        },
        body: payloadString,
      });

      const expiredResponse = {
        status: expiredResult.status,
        statusText: expiredResult.statusText,
        body: await expiredResult.text().catch(() => ""),
      };

      testData.expiredResponse = expiredResponse;

      // Check if security measures are working correctly
      const validAccepted = validResponse.status === 200;
      const invalidRejected = invalidResponse.status !== 200;
      const tamperedRejected = tamperedResponse.status !== 200;
      const expiredRejected = expiredResponse.status !== 200;

      const allTestsPassed =
        validAccepted && invalidRejected && tamperedRejected && expiredRejected;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        validAccepted,
        invalidRejected,
        tamperedRejected,
        expiredRejected,
        allTestsPassed,
      });

      const result = {
        success: allTestsPassed,
        error: !allTestsPassed
          ? "One or more webhook security tests failed"
          : null,
        details: {
          validAccepted,
          invalidRejected,
          tamperedRejected,
          expiredRejected,
          validResponse,
          invalidResponse,
          tamperedResponse,
          expiredResponse,
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
   * Test with tampered tokens
   */
  testTamperedTokens: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Parse token to identify its structure
      const tokenParts = token.split(".");
      if (tokenParts.length !== 3) {
        return {
          success: false,
          error: "Invalid JWT token format",
        };
      }

      // 1. Test with altered header
      const headerJson = JSON.parse(
        Buffer.from(tokenParts[0], "base64").toString()
      );
      const tamperedHeader = {
        ...headerJson,
        alg: headerJson.alg === "HS256" ? "RS256" : "HS256", // Tamper with algorithm
      };

      const tamperedHeaderBase64 = Buffer.from(JSON.stringify(tamperedHeader))
        .toString("base64")
        .replace(/=/g, "");

      const headerTamperedToken = `${tamperedHeaderBase64}.${tokenParts[1]}.${tokenParts[2]}`;

      const headerResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${headerTamperedToken}`,
          },
          body: JSON.stringify({ message: "Testing tampered header" }),
        }
      );

      // 2. Test with altered payload
      const payloadJson = JSON.parse(
        Buffer.from(tokenParts[1], "base64").toString()
      );
      const tamperedPayload = {
        ...payloadJson,
        permissions: "admin", // Attempt to elevate permissions
      };

      const tamperedPayloadBase64 = Buffer.from(JSON.stringify(tamperedPayload))
        .toString("base64")
        .replace(/=/g, "");

      const payloadTamperedToken = `${tokenParts[0]}.${tamperedPayloadBase64}.${tokenParts[2]}`;

      const payloadResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${payloadTamperedToken}`,
          },
          body: JSON.stringify({ message: "Testing tampered payload" }),
        }
      );

      // 3. Test with altered signature
      const signatureTamperedToken = `${tokenParts[0]}.${
        tokenParts[1]
      }.${tokenParts[2].substring(0, tokenParts[2].length - 3)}abc`;

      const signatureResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${signatureTamperedToken}`,
          },
          body: JSON.stringify({ message: "Testing tampered signature" }),
        }
      );

      // All tampered tokens should be rejected
      const headerRejected = !!headerResult.error;
      const payloadRejected = !!payloadResult.error;
      const signatureRejected = !!signatureResult.error;

      const allRejected =
        headerRejected && payloadRejected && signatureRejected;

      return {
        success: allRejected,
        error: !allRejected
          ? "System did not reject all tampered tokens"
          : null,
        details: {
          headerRejected,
          payloadRejected,
          signatureRejected,
          headerResult: { error: headerResult.error },
          payloadResult: { error: payloadResult.error },
          signatureResult: { error: signatureResult.error },
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
   * Test replay attacks with captured tokens
   */
  testReplayAttacks: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Store the original token
      const originalToken = token;

      // First, make a legitimate request to capture a nonce or session identifier
      const initialResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: "Initial legitimate request" }),
        }
      );

      if (initialResult.error) {
        return {
          success: false,
          error: `Initial request failed: ${initialResult.error}`,
          details: initialResult,
        };
      }

      // Now get a new token through renewal
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

      if (renewalResult.error || !renewalResult.jwt_token) {
        return {
          success: false,
          error: `Token renewal failed: ${
            renewalResult.error || "No new token received"
          }`,
          details: renewalResult,
        };
      }

      // Store the new token
      const newToken = renewalResult.jwt_token;
      await stateManager.setJwtToken(newToken);

      // Try to reuse the original token (simulate replay attack)
      const replayResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${originalToken}`,
          },
          body: JSON.stringify({ message: "Replayed request with old token" }),
        }
      );

      // The system should reject the replay attack
      const replayRejected = !!replayResult.error;

      if (!replayRejected) {
        return {
          success: false,
          error: "System did not reject replayed token",
          details: { replayResult },
        };
      }

      return {
        success: true,
        details: {
          replayRejected,
          tokenRenewed: true,
          replayError: replayResult.error,
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
   * Test with modified permission claims in tokens
   */
  testPermissionClaims: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // First, try to access an authorized endpoint
      const authorizedResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/resources/protected`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // Now try to access a restricted endpoint that should require higher permissions
      const restrictedResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/admin/restricted`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      // The restricted endpoint should reject the access
      const restrictedRejected =
        !!restrictedResult.error &&
        restrictedResult.error.includes("permission");

      return {
        success: restrictedRejected,
        error: !restrictedRejected
          ? "System did not properly enforce permission restrictions"
          : null,
        details: {
          authorizedResult: {
            success: !authorizedResult.error,
            error: authorizedResult.error,
          },
          restrictedResult: {
            rejected: restrictedRejected,
            error: restrictedResult.error,
          },
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

module.exports = securityTests;
