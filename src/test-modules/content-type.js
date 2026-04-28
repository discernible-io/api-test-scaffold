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
    const testId = ulid();

    logger.info('testContentTypeValidation: START', {
      component: 'contentType',
      testName,
      testId,
      apiEndpoint: tctv_api_ep
    });

    try {
      let client;
      try {
        logger.debug('testContentTypeValidation: Creating RoditClient', { testId });
        client = await getRoditClientForTest();
        logger.debug('testContentTypeValidation: RoditClient created successfully', { testId, hasClient: !!client });
      } catch (clientError) {
        const errorInfo = extractApiErrorInfo(clientError);
        logger.error('testContentTypeValidation: Failed to create RoditClient', {
          component: 'contentType',
          testId,
          errorMessage: errorInfo.message,
          errorStack: clientError?.stack,
          errorName: clientError?.name,
          errorType: typeof clientError
        });
        return {
          passed: false,
          error: `Failed to create RoditClient: ${errorInfo.message}`,
          testData,
        };
      }

      if (!client) {
        logger.error('testContentTypeValidation: No client returned', { testId });
        return {
          passed: false,
          error: "No authentication client available",
          testData,
        };
      }
      
      let loginResult;
      try {
        logger.debug('testContentTypeValidation: Attempting login_server', { testId });
        loginResult = await client.login_server();
        logger.debug('testContentTypeValidation: Login successful', {
          testId,
          hasLoginResult: !!loginResult,
          hasJwtToken: !!loginResult?.jwt_token
        });
      } catch (loginError) {
        logger.error('Login failed in testContentTypeValidation', {
          component: 'contentType',
          testId,
          error: loginError.message,
          stack: loginError.stack,
          errorName: loginError?.name,
          errorType: typeof loginError
        });
        return {
          passed: false,
          error: `Login failed: ${loginError.message}`,
          testData,
        };
      }

      if (!loginResult || !loginResult.jwt_token) {
        logger.error('testContentTypeValidation: Invalid login result', {
          testId,
          loginResult: JSON.stringify(loginResult)
        });
        return {
          passed: false,
          error: `Login did not return jwt_token: ${JSON.stringify(loginResult)}`,
          testData,
        };
      }

      const { generateValidHola } = require('./identyclaw-api');
      let validHola;
      try {
        logger.debug('testContentTypeValidation: Generating HOLA', { testId });
        validHola = await generateValidHola(client, {
          recipient: 'MUNDO',
          tokenId: 'bjbvcjzqbdsj'
        });
        logger.debug('testContentTypeValidation: HOLA generated successfully', {
          testId,
          holaLength: validHola?.length
        });
      } catch (holaError) {
        logger.error('HOLA generation failed in testContentTypeValidation', {
          component: 'contentType',
          testId,
          error: holaError.message,
          stack: holaError.stack,
          errorName: holaError?.name,
          errorType: typeof holaError
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
      logger.debug('testContentTypeValidation: Test 1 - Standard JSON', { testId });
      let response1;
      try {
        response1 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            "Authorization": `Bearer ${loginResult.jwt_token}`,
          },
          body: JSON.stringify(validBody),
        });
        logger.debug('testContentTypeValidation: Test 1 response received', {
          testId,
          status: response1.status,
          ok: response1.ok
        });
      } catch (fetchError) {
        logger.error('testContentTypeValidation: Test 1 fetch failed', {
          testId,
          error: fetchError.message,
          stack: fetchError.stack
        });
        return {
          passed: false,
          error: `Test 1 fetch failed: ${fetchError.message}`,
          testData,
        };
      }
      results.push({
        name: "Standard JSON",
        passed: response1.ok,
        status: response1.status,
      });

      // Test 2: JSON with charset
      logger.debug('testContentTypeValidation: Test 2 - JSON with charset', { testId });
      let response2;
      try {
        response2 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "X-Request-ID": ulid(),
            "Authorization": `Bearer ${loginResult.jwt_token}`,
          },
          body: JSON.stringify(validBody),
        });
        logger.debug('testContentTypeValidation: Test 2 response received', {
          testId,
          status: response2.status,
          ok: response2.ok
        });
      } catch (fetchError) {
        logger.error('testContentTypeValidation: Test 2 fetch failed', {
          testId,
          error: fetchError.message,
          stack: fetchError.stack
        });
        return {
          passed: false,
          error: `Test 2 fetch failed: ${fetchError.message}`,
          testData,
        };
      }
      results.push({
        name: "JSON with charset",
        passed: response2.ok,
        status: response2.status,
      });

      // Test 3: Plain text (should fail)
      logger.debug('testContentTypeValidation: Test 3 - Plain text', { testId });
      let response3;
      try {
        response3 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain",
            "X-Request-ID": ulid(),
            "Authorization": `Bearer ${loginResult.jwt_token}`,
          },
          body: JSON.stringify(validBody),
        });
        logger.debug('testContentTypeValidation: Test 3 response received', {
          testId,
          status: response3.status,
          ok: response3.ok
        });
      } catch (fetchError) {
        logger.error('testContentTypeValidation: Test 3 fetch failed', {
          testId,
          error: fetchError.message,
          stack: fetchError.stack
        });
        return {
          passed: false,
          error: `Test 3 fetch failed: ${fetchError.message}`,
          testData,
        };
      }
      results.push({
        name: "Plain text",
        passed: !response3.ok,
        status: response3.status,
      });

      // Test 4: Custom headers
      logger.debug('testContentTypeValidation: Test 4 - Custom headers', { testId });
      let response4;
      try {
        response4 = await fetch(`${tctv_api_ep}/api/identity/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            "X-Custom-Header": "Custom value",
            "Authorization": `Bearer ${loginResult.jwt_token}`,
          },
          body: JSON.stringify(validBody),
        });
        logger.debug('testContentTypeValidation: Test 4 response received', {
          testId,
          status: response4.status,
          ok: response4.ok
        });
      } catch (fetchError) {
        logger.error('testContentTypeValidation: Test 4 fetch failed', {
          testId,
          error: fetchError.message,
          stack: fetchError.stack
        });
        return {
          passed: false,
          error: `Test 4 fetch failed: ${fetchError.message}`,
          testData,
        };
      }
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
        testId,
        error: error.message,
        stack: error.stack,
        errorType: error.constructor.name,
        errorName: error?.name,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
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