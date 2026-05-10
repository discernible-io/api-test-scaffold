/**
 * Authentication Positive Tests
 * 
 * Positive test coverage for authentication endpoints.
 * These tests verify successful authentication flows and valid responses.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect, getRoditClientForTest, bearerAuthorizationHeader, extractApiErrorInfo, captureTestData } = require('./test-utils');

const authenticationPositiveTests = {
  /**
   * Test GET /api/login/timestamp
   * Verifies timestamp endpoint returns synchronized values for login
   */
  testLoginTimestampEndpoint: async (api_ep) => {
    const moduleName = 'authentication-positive';
    const testName = 'testLoginTimestampEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/login/timestamp` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/api/login/timestamp', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasTimestamp = typeof data.timestamp === 'number';
      testData.hasTimestampIso = typeof data.timestamp_iso === 'string';
      testData.hasRequestId = !!data.requestId;

      if (!testData.hasTimestamp || !testData.hasTimestampIso || !testData.hasRequestId) {
        throw new Error('Missing required fields: timestamp, timestamp_iso, or requestId');
      }

      // Verify timestamp is recent (within last minute)
      const now = Math.floor(Date.now() / 1000);
      const timeDiff = Math.abs(now - data.timestamp);
      if (timeDiff > 60) {
        throw new Error(`Timestamp is too old or in future: ${timeDiff} seconds difference`);
      }

      // Verify ISO timestamp is valid
      const isoDate = new Date(data.timestamp_iso);
      if (isNaN(isoDate.getTime())) {
        throw new Error(`Invalid ISO timestamp format: ${data.timestamp_iso}`);
      }

      return {
        passed: true,
        message: 'Login timestamp endpoint returns synchronized values',
        details: {
          timestamp: data.timestamp,
          timestampIso: data.timestamp_iso,
          requestId: data.requestId
        }
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message
      });

      return {
        passed: false,
        error: error.message,
        testData
      };
    }
  },

  /**
   * Test POST /api/login
   * Verifies successful login returns JWT token
   */
  testLoginSuccess: async (api_ep) => {
    const moduleName = 'authentication-positive';
    const testName = 'testLoginSuccess';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/login` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;
      if (!jwt_token) {
        throw new Error('No JWT token received after login');
      }

      testData.hasToken = true;
      testData.tokenLength = jwt_token.length;
      testData.tokenStartsWith = jwt_token.substring(0, 20);

      // Verify token is a valid JWT (3 parts separated by dots)
      const parts = jwt_token.split('.');
      if (parts.length !== 3) {
        throw new Error(`Invalid JWT format: expected 3 parts, got ${parts.length}`);
      }

      return {
        passed: true,
        message: 'Login successful, valid JWT token received',
        details: {
          tokenReceived: true,
          tokenLength: jwt_token.length,
          isValidJwt: true
        }
      };
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message,
        errorInfo
      });

      return {
        passed: false,
        error: error.message,
        errorInfo,
        testData
      };
    }
  },

  /**
   * Test POST /api/logout
   * Verifies logout successfully invalidates session
   */
  testLogoutSuccess: async (api_ep) => {
    const moduleName = 'authentication-positive';
    const testName = 'testLogoutSuccess';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/logout` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // Get fresh token
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;
      if (!jwt_token) {
        throw new Error('No JWT token received');
      }

      // Verify token works before logout
      const preLogoutResponse = await fetchDirect(api_ep, '/api/holanonce16ts', {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.preLogoutStatus = preLogoutResponse.status;
      if (!preLogoutResponse.ok) {
        throw new Error(`Token not working before logout: ${preLogoutResponse.status}`);
      }

      // Perform logout
      const logoutResponse = await fetchDirect(api_ep, '/api/logout', {
        method: 'POST',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'Content-Type': 'application/json',
          'X-Request-ID': correlationId
        }
      });

      testData.logoutStatus = logoutResponse.status;
      if (!logoutResponse.ok) {
        const errorText = await logoutResponse.text();
        throw new Error(`Logout failed: ${logoutResponse.status} - ${errorText}`);
      }

      // Verify token no longer works
      const postLogoutResponse = await fetchDirect(api_ep, '/api/holanonce16ts', {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.postLogoutStatus = postLogoutResponse.status;
      const tokenInvalidated = postLogoutResponse.status === 401 || postLogoutResponse.status === 403;

      if (!tokenInvalidated) {
        throw new Error(`Expected 401/403 after logout, got ${postLogoutResponse.status}`);
      }

      return {
        passed: true,
        message: 'Logout successfully invalidated session',
        details: {
          logoutSucceeded: true,
          tokenInvalidated: true,
          preLogoutStatus: preLogoutResponse.status,
          postLogoutStatus: postLogoutResponse.status
        }
      };
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message,
        errorInfo
      });

      return {
        passed: false,
        error: error.message,
        errorInfo,
        testData
      };
    }
  },

  /**
   * Test GET /api/me/identity (authenticated)
   * Verifies authenticated user can retrieve own identity
   */
  testGetOwnIdentity: async (api_ep) => {
    const moduleName = 'authentication-positive';
    const testName = 'testGetOwnIdentity';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/me/identity` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;
      if (!jwt_token) {
        throw new Error('No JWT token received');
      }

      const response = await fetchDirect(api_ep, '/api/me/identity', {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Request failed: ${response.status} - ${errorText}`);
      }

      const identity = await response.json();
      testData.hasTokenId = !!identity.token_id;
      testData.hasMetadata = !!identity.metadata;
      testData.hasParsedDN = !!identity.parsed_dn;
      testData.hasRequestId = !!identity.requestId;
      testData.hasTimestamp = !!identity.timestamp;

      if (!testData.hasTokenId) {
        throw new Error('Missing token_id in identity response');
      }

      return {
        passed: true,
        message: 'Successfully retrieved authenticated user identity',
        details: {
          tokenId: identity.token_id,
          hasMetadata: !!identity.metadata,
          hasParsedDN: !!identity.parsed_dn
        }
      };
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error(`Test ${testName} not-passed`, {
        component: 'TestRunner',
        moduleName,
        testName,
        correlationId,
        error: error.message,
        errorInfo
      });

      return {
        passed: false,
        error: error.message,
        errorInfo,
        testData
      };
    }
  }
};

module.exports = authenticationPositiveTests;
