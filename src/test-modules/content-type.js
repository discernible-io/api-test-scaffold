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
      const authHeader = `Bearer ${loginResult.jwt_token}`;
      
      const results = [];

      // Test 1: Standard JSON
      logger.debug('testContentTypeValidation: Test 1 - Standard JSON', { testId });
      let response1;
      try {
        response1 = await client.request('POST', '/api/identity/verify', validBody, {
          autoRefresh: false, // Test instances may not support token refresh
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          }
        });
        logger.debug('testContentTypeValidation: Test 1 response received', {
          testId,
          hasResponse: !!response1
        });
      } catch (fetchError) {
        const errorInfo = extractApiErrorInfo(fetchError);
        logger.error('testContentTypeValidation: Test 1 request failed', {
          testId,
          error: errorInfo.message,
          statusCode: errorInfo.statusCode
        });
        results.push({
          name: "Standard JSON",
          passed: false,
          status: errorInfo.statusCode,
          error: errorInfo.message
        });
      }
      if (response1) {
        results.push({
          name: "Standard JSON",
          passed: true,
          status: 200,
        });
      }

      // Test 2: JSON with charset
      logger.debug('testContentTypeValidation: Test 2 - JSON with charset', { testId });
      let response2;
      try {
        logger.debug('testContentTypeValidation: Test 2 - Before request', {
          testId,
          hasClient: !!client,
          clientType: typeof client,
          hasState: !!client.stateManager
        });
        response2 = await client.request('POST', '/api/identity/verify', validBody, {
          autoRefresh: false, // Test instances may not support token refresh
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json; charset=utf-8",
            "X-Request-ID": ulid(),
          }
        });
        logger.debug('testContentTypeValidation: Test 2 response received', {
          testId,
          hasResponse: !!response2
        });
      } catch (fetchError) {
        const errorInfo = extractApiErrorInfo(fetchError);
        logger.error('testContentTypeValidation: Test 2 request failed', {
          testId,
          error: errorInfo.message,
          statusCode: errorInfo.statusCode,
          errorCode: errorInfo.code,
          errorName: fetchError?.name,
          errorStack: fetchError?.stack
        });
        results.push({
          name: "JSON with charset",
          passed: false,
          status: errorInfo.statusCode,
          error: errorInfo.message
        });
      }
      if (response2) {
        results.push({
          name: "JSON with charset",
          passed: true,
          status: 200,
        });
      }

      // Test 3: Plain text (should fail)
      logger.debug('testContentTypeValidation: Test 3 - Plain text', { testId });
      let response3;
      try {
        response3 = await client.request('POST', '/api/identity/verify', validBody, {
          autoRefresh: false, // Test instances may not support token refresh
          headers: {
            "Authorization": authHeader,
            "Content-Type": "text/plain",
            "X-Request-ID": ulid(),
          }
        });
        logger.debug('testContentTypeValidation: Test 3 response received', {
          testId,
          hasResponse: !!response3
        });
        // If plain text succeeds, test fails
        results.push({
          name: "Plain text",
          passed: false,
          status: 200,
          error: "Plain text should have been rejected"
        });
      } catch (fetchError) {
        const errorInfo = extractApiErrorInfo(fetchError);
        logger.debug('testContentTypeValidation: Test 3 correctly rejected', {
          testId,
          statusCode: errorInfo.statusCode
        });
        // Plain text should be rejected (415 expected)
        results.push({
          name: "Plain text",
          passed: errorInfo.statusCode >= 400,
          status: errorInfo.statusCode,
        });
      }

      // Test 4: Custom headers
      logger.debug('testContentTypeValidation: Test 4 - Custom headers', { testId });
      let response4;
      try {
        logger.debug('testContentTypeValidation: Test 4 - Before request', {
          testId,
          hasClient: !!client,
          hasState: !!client.stateManager
        });
        response4 = await client.request('POST', '/api/identity/verify', validBody, {
          autoRefresh: false, // Test instances may not support token refresh
          headers: {
            "Authorization": authHeader,
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
            "X-Custom-Header": "Custom value",
          }
        });
        logger.debug('testContentTypeValidation: Test 4 response received', {
          testId,
          hasResponse: !!response4
        });
      } catch (fetchError) {
        const errorInfo = extractApiErrorInfo(fetchError);
        logger.error('testContentTypeValidation: Test 4 request failed', {
          testId,
          error: errorInfo.message,
          statusCode: errorInfo.statusCode,
          errorCode: errorInfo.code,
          errorName: fetchError?.name,
          errorStack: fetchError?.stack
        });
        results.push({
          name: "Custom headers",
          passed: false,
          status: errorInfo.statusCode,
          error: errorInfo.message
        });
      }
      if (response4) {
        results.push({
          name: "Custom headers",
          passed: true,
          status: 200,
        });
      }

      const allPassed = results.every(r => r.passed);
      return {
        passed: allPassed,
        error: allPassed ? undefined : `${results.filter(r => !r.passed).length} test(s) failed: ${results.filter(r => !r.passed).map(r => r.name).join(', ')}`,
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