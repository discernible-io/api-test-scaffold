/**
 * Public Endpoints Tests
 * 
 * Tests for public endpoints that provide agent discovery and identity information.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect, getRoditClientForTest, bearerAuthorizationHeader, extractApiErrorInfo } = require('./test-utils');

const publicEndpointsTests = {
  /**
   * Test GET /api/agents
   * Verifies agent listing endpoint with pagination
   */
  testListAgents: async (api_ep) => {
    const moduleName = 'public-endpoints';
    const testName = 'testListAgents';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/agents` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // Test with default parameters
      const response = await fetchDirect(api_ep, '/api/agents', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasAgents = Array.isArray(data.agents);
      testData.agentCount = data.agents?.length || 0;
      testData.hasCursor = !!data.cursor || !!data.nextCursor;
      testData.hasRequestId = !!data.requestId;
      testData.hasTimestamp = !!data.timestamp;

      if (!testData.hasAgents) {
        throw new Error('Response missing agents array');
      }

      // Verify agent structure if agents exist
      if (testData.agentCount > 0) {
        const firstAgent = data.agents[0];
        testData.agentHasTokenId = !!firstAgent.token_id || !!firstAgent.tokenId;
        testData.agentHasMetadata = !!firstAgent.metadata;
        testData.agentHasDescription = !!firstAgent.description || !!firstAgent.creature;

        if (!testData.agentHasTokenId) {
          throw new Error('Agent missing token_id field');
        }
      }

      return {
        passed: true,
        message: 'Agent listing endpoint returns valid paginated response',
        details: {
          agentCount: testData.agentCount,
          hasPagination: testData.hasCursor,
          agentStructureValid: testData.agentCount === 0 || testData.agentHasTokenId
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
   * Test GET /api/agents with limit parameter
   * Verifies pagination limit parameter works
   */
  testListAgentsWithLimit: async (api_ep) => {
    const moduleName = 'public-endpoints';
    const testName = 'testListAgentsWithLimit';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/agents?limit=5` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/api/agents?limit=5', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasAgents = Array.isArray(data.agents);
      testData.agentCount = data.agents?.length || 0;
      testData.limitRespected = testData.agentCount <= 5;

      if (!testData.hasAgents) {
        throw new Error('Response missing agents array');
      }

      if (!testData.limitRespected) {
        throw new Error(`Limit parameter not respected: got ${testData.agentCount} agents, expected max 5`);
      }

      return {
        passed: true,
        message: 'Limit parameter works correctly',
        details: {
          requestedLimit: 5,
          returnedCount: testData.agentCount,
          limitRespected: testData.limitRespected
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
   * Test GET /api/identity/token/{tokenId}/full
   * Verifies full identity endpoint with DN and facial encoding
   */
  testGetFullIdentity: async (api_ep) => {
    const moduleName = 'public-endpoints';
    const testName = 'testGetFullIdentity';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/identity/token/{tokenId}/full` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // Get authenticated user's token ID first
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;
      const identity = await client.request('GET', '/api/me/identity');
      const tokenId = identity?.token_id || identity?.tokenId;

      if (!tokenId) {
        throw new Error('Could not resolve token ID');
      }

      testData.tokenId = tokenId;

      // Now test the full identity endpoint
      const response = await fetchDirect(api_ep, `/api/identity/token/${tokenId}/full`, {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasTokenId = !!data.token_id || !!data.tokenId;
      testData.hasParsedDN = !!data.parsed_dn || !!data.parsedDN;
      testData.hasMetadata = !!data.metadata;
      testData.hasFacialEncoding = !!data.facial_encoding || !!data.facialEncoding;
      testData.hasRequestId = !!data.requestId;
      testData.hasTimestamp = !!data.timestamp;

      if (!testData.hasTokenId) {
        throw new Error('Full identity missing token_id');
      }

      if (!testData.hasParsedDN) {
        throw new Error('Full identity missing parsed_dn');
      }

      return {
        passed: true,
        message: 'Full identity endpoint returns complete identity information',
        details: {
          tokenId: tokenId,
          hasParsedDN: testData.hasParsedDN,
          hasMetadata: testData.hasMetadata,
          hasFacialEncoding: testData.hasFacialEncoding
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
   * Test GET /api/identity/token/{tokenId}/full with invalid token
   * Verifies proper error handling for non-existent tokens
   */
  testGetFullIdentityInvalidToken: async (api_ep) => {
    const moduleName = 'public-endpoints';
    const testName = 'testGetFullIdentityInvalidToken';
    const correlationId = ulid();
    const invalidTokenId = 'zzzzzzzzzzzz'; // Non-existent token
    const testData = { api_ep, endpoint: `${api_ep}/api/identity/token/{tokenId}/full`, tokenId: invalidTokenId };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // Get JWT token for auth
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;

      // Test with invalid token ID
      const response = await fetchDirect(api_ep, `/api/identity/token/${invalidTokenId}/full`, {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.status = response.status;

      // Should return 404 or 400 for invalid token
      if (response.status === 404 || response.status === 400) {
        testData.errorHandled = true;
        return {
          passed: true,
          message: 'Full identity endpoint correctly handles invalid token',
          details: {
            status: response.status,
            errorHandled: true
          }
        };
      }

      throw new Error(`Expected 404 or 400 for invalid token, got ${response.status}`);
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

module.exports = publicEndpointsTests;
