// content-type-tests.js

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require("./test-utils");
/**
 * Tests for Content-Type validation and header handling
 */
const contentTypeTests = {
  /**
   * Test API handling of different Content-Type headers
   */
  testContentTypeValidation: async (tctv_api_ep) => {
    const testName = "testContentTypeValidation";
    const testData = { apiEndpoint: tctv_api_ep };

    try {
      const client = await getRoditClientForTest();
      if (!client) {
        return {
          passed: false,
          error: "No authentication client available",
          testData,
        };
      }
      
      let loginResult;
      try {
        loginResult = await client.login_server();
      } catch (loginError) {
        logger.error('Login failed in testContentTypeValidation', {
          component: 'contentType',
          error: loginError.message,
          stack: loginError.stack
        });
        return {
          passed: false,
          error: `Login failed: ${loginError.message}`,
          testData,
        };
      }
      
      if (!loginResult || !loginResult.jwt_token) {
        return {
          passed: false,
          error: `Login did not return jwt_token: ${JSON.stringify(loginResult)}`,
          testData,
        };
      }

      const { generateValidHola } = require('./identyclaw-api');
      let validHola;
      try {
        validHola = await generateValidHola(client, {
          recipient: 'MUNDO',
          tokenId: 'bjbvcjzqbdsj'
        });
      } catch (holaError) {
        logger.error('HOLA generation failed in testContentTypeValidation', {
          component: 'contentType',
          error: holaError.message,
          stack: holaError.stack
        });
        return {
          passed: false,
          error: `HOLA generation failed: ${holaError.message}`,
          testData,
        };
      }
      
      const validBody = {
        hello: validHola,
        constraints: { maxAgeMs: 300000 }
      };
      
      const results = [];

      // Test 1: Standard JSON
      const response1 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          "Authorization": `Bearer ${loginResult.jwt_token}`,
        },
        body: JSON.stringify(validBody),
      });
      results.push({
        name: "Standard JSON",
        passed: response1.ok,
        status: response1.status,
      });

      // Test 2: JSON with charset
      const response2 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Request-ID": ulid(),
          "Authorization": `Bearer ${loginResult.jwt_token}`,
        },
        body: JSON.stringify(validBody),
      });
      results.push({
        name: "JSON with charset",
        passed: response2.ok,
        status: response2.status,
      });

      // Test 3: Plain text (should fail)
      const response3 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain",
          "X-Request-ID": ulid(),
          "Authorization": `Bearer ${loginResult.jwt_token}`,
        },
        body: JSON.stringify(validBody),
      });
      results.push({
        name: "Plain text",
        passed: !response3.ok,
        status: response3.status,
      });

      // Test 4: Custom headers
      const response4 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
          "X-Custom-Header": "Custom value",
          "Authorization": `Bearer ${loginResult.jwt_token}`,
        },
        body: JSON.stringify(validBody),
      });
      results.push({
        name: "Custom headers",
        passed: response4.ok,
        status: response4.status,
      });

      return {
        passed: results.every(r => r.passed),
        testData,
        results,
      };
    } catch (error) {
      logger.error('Unhandled error in testContentTypeValidation', {
        component: 'contentType',
        error: error.message,
        stack: error.stack,
        errorType: error.constructor.name
      });
      return {
        passed: false,
        error: `${error.message} (${error.constructor.name})`,
        testData,
      };
    }
  }
};

module.exports = contentTypeTests;