/**
 * MCP Transport Endpoints Tests
 * 
 * Tests for the streamable MCP transport endpoint (/mcp GET/POST).
 * This endpoint supports Server-Sent Events (SSE) for streaming MCP protocol.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect, getRoditClientForTest, bearerAuthorizationHeader, extractApiErrorInfo } = require('./test-utils');

const mcpTransportTests = {
  /**
   * Test GET /mcp
   * Verifies MCP streamable endpoint accepts GET requests
   */
  testMcpTransportGet: async (api_ep) => {
    const moduleName = 'mcp-transport';
    const testName = 'testMcpTransportGet';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/mcp` };

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

      const response = await fetchDirect(api_ep, '/mcp', {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.status = response.status;
      testData.contentType = response.headers.get('content-type');

      // MCP GET should return 200 with streaming content type
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      // Check for streaming content type (text/event-stream for SSE)
      testData.isStreamingContentType = 
        testData.contentType?.includes('text/event-stream') ||
        testData.contentType?.includes('application/x-ndjson') ||
        testData.contentType?.includes('application/octet-stream');

      if (!testData.isStreamingContentType) {
        logger.warn(`MCP GET endpoint has unexpected content-type: ${testData.contentType}`, {
          component: 'TestRunner',
          moduleName,
          testName,
          correlationId
        });
      }

      return {
        passed: true,
        message: 'MCP transport GET endpoint is accessible',
        details: {
          status: response.status,
          contentType: testData.contentType,
          isStreamingContentType: testData.isStreamingContentType
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
   * Test POST /mcp
   * Verifies MCP streamable endpoint accepts POST requests
   */
  testMcpTransportPost: async (api_ep) => {
    const moduleName = 'mcp-transport';
    const testName = 'testMcpTransportPost';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/mcp` };

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

      // MCP POST typically sends JSON-RPC requests
      const payload = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: {
            name: 'test-client',
            version: '1.0.0'
          }
        }
      };

      const response = await fetchDirect(api_ep, '/mcp', {
        method: 'POST',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'Content-Type': 'application/json',
          'X-Request-ID': correlationId
        },
        body: JSON.stringify(payload)
      });

      testData.status = response.status;
      testData.contentType = response.headers.get('content-type');

      // MCP POST should return 200 with streaming or JSON response
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      // Try to read response (may be streaming)
      testData.hasResponseBody = response.body !== null;

      return {
        passed: true,
        message: 'MCP transport POST endpoint is accessible',
        details: {
          status: response.status,
          contentType: testData.contentType,
          hasResponseBody: testData.hasResponseBody
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
   * Test /mcp without authentication
   * Verifies endpoint requires authentication
   */
  testMcpTransportNoAuth: async (api_ep) => {
    const moduleName = 'mcp-transport';
    const testName = 'testMcpTransportNoAuth';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/mcp` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // Request without authentication
      const response = await fetchDirect(api_ep, '/mcp', {
        method: 'GET',
        headers: {
          'X-Request-ID': correlationId
        }
      });

      testData.status = response.status;

      // Should return 401 or 403 without auth
      if (response.status === 401 || response.status === 403) {
        testData.authRequired = true;
        return {
          passed: true,
          message: 'MCP transport endpoint correctly requires authentication',
          details: {
            status: response.status,
            authRequired: true
          }
        };
      }

      throw new Error(`Expected 401 or 403 without auth, got ${response.status}`);
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
  }
};

module.exports = mcpTransportTests;
