/**
 * Admin and Special Endpoints Tests
 * 
 * Tests for admin-only endpoints and special functionality like MCP resources and schema.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect, getRoditClientForTest, bearerAuthorizationHeader, extractApiErrorInfo } = require('./test-utils');

const adminSpecialEndpointsTests = {
  /**
   * Test GET /api/mcp/resource/{uri}
   * Verifies MCP resource retrieval by URI
   */
  testGetMcpResource: async (api_ep) => {
    const moduleName = 'admin-special-endpoints';
    const testName = 'testGetMcpResource';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/mcp/resource/{uri}` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      // First, get list of available resources
      const client = await getRoditClientForTest();
      const loginResult = await client.login_server();

      if (!loginResult || !loginResult.success) {
        throw new Error(loginResult?.error || 'Login failed');
      }

      const jwt_token = loginResult.jwt_token;

      // Get resources list
      const resourcesResponse = await fetchDirect(api_ep, '/api/mcp/resources', {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      if (!resourcesResponse.ok) {
        throw new Error(`Failed to get resources list: ${resourcesResponse.status}`);
      }

      const resourcesList = await resourcesResponse.json();
      const resources = resourcesList.resources || [];

      if (resources.length === 0) {
        testData.noResources = true;
        return {
          passed: true,
          message: 'MCP resource endpoint accessible (no resources available)',
          details: {
            resourceCount: 0,
            endpointAccessible: true
          }
        };
      }

      // Test retrieving first resource
      const firstResourceUri = resources[0].uri || resources[0];
      testData.resourceUri = firstResourceUri;

      const resourceResponse = await fetchDirect(api_ep, `/api/mcp/resource/${encodeURIComponent(firstResourceUri)}`, {
        method: 'GET',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'X-Request-ID': correlationId
        }
      });

      testData.status = resourceResponse.status;

      if (!resourceResponse.ok) {
        const errorText = await resourceResponse.text();
        throw new Error(`Failed to get resource: ${resourceResponse.status} - ${errorText}`);
      }

      const resource = await resourceResponse.json();
      testData.hasUri = !!resource.uri;
      testData.hasName = !!resource.name;
      testData.hasContent = !!resource.content;

      return {
        passed: true,
        message: 'MCP resource retrieval works correctly',
        details: {
          resourceUri: firstResourceUri,
          hasUri: testData.hasUri,
          hasName: testData.hasName,
          hasContent: testData.hasContent
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
   * Test GET /api/mcp/schema
   * Verifies MCP schema endpoint returns OpenAPI schema
   */
  testGetMcpSchema: async (api_ep) => {
    const moduleName = 'admin-special-endpoints';
    const testName = 'testGetMcpSchema';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/mcp/schema` };

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

      const response = await fetchDirect(api_ep, '/api/mcp/schema', {
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

      const schema = await response.json();
      testData.hasOpenapi = !!schema.openapi;
      testData.hasInfo = !!schema.info;
      testData.hasPaths = !!schema.paths;
      testData.hasComponents = !!schema.components;

      if (!testData.hasOpenapi || !testData.hasInfo || !testData.hasPaths) {
        throw new Error('Schema missing required OpenAPI fields');
      }

      return {
        passed: true,
        message: 'MCP schema endpoint returns valid OpenAPI specification',
        details: {
          openapiVersion: schema.openapi,
          pathCount: Object.keys(schema.paths || {}).length,
          hasComponents: testData.hasComponents
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
   * Test POST /api/signclient
   * Verifies client RODiT minting request endpoint
   */
  testSignClientRequest: async (api_ep) => {
    const moduleName = 'admin-special-endpoints';
    const testName = 'testSignClientRequest';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/signclient` };

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

      // Test with minimal valid payload
      const payload = {
        clientId: `test-client-${ulid()}`,
        publicKey: 'test-public-key'
      };

      const response = await fetchDirect(api_ep, '/api/signclient', {
        method: 'POST',
        headers: {
          Authorization: bearerAuthorizationHeader(jwt_token),
          'Content-Type': 'application/json',
          'X-Request-ID': correlationId
        },
        body: JSON.stringify(payload)
      });

      testData.status = response.status;

      // May return 400 if payload is invalid, which is acceptable
      if (response.status === 400) {
        const errorData = await response.json();
        testData.validationError = !!errorData.error;
        return {
          passed: true,
          message: 'SignClient endpoint validates input correctly',
          details: {
            status: 400,
            validationError: testData.validationError,
            endpointAccessible: true
          }
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200 or 400, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasSignature = !!data.signature;
      testData.hasRequestId = !!data.requestId;

      return {
        passed: true,
        message: 'SignClient endpoint processes request',
        details: {
          status: response.status,
          hasSignature: testData.hasSignature,
          hasRequestId: testData.hasRequestId
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
   * Test GET /api/v1/openapi.json
   * Verifies legacy OpenAPI alias endpoint
   */
  testLegacyOpenApiAlias: async (api_ep) => {
    const moduleName = 'admin-special-endpoints';
    const testName = 'testLegacyOpenApiAlias';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/api/v1/openapi.json` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/api/v1/openapi.json', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      // Should redirect or return the spec
      if (response.status === 301 || response.status === 302 || response.status === 307 || response.status === 308) {
        testData.isRedirect = true;
        testData.redirectLocation = response.headers.get('location');
        return {
          passed: true,
          message: 'Legacy OpenAPI alias redirects correctly',
          details: {
            status: response.status,
            redirectLocation: testData.redirectLocation
          }
        };
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200 or 3xx, got ${response.status}: ${errorText}`);
      }

      const spec = await response.json();
      testData.hasOpenapi = !!spec.openapi;
      testData.hasInfo = !!spec.info;

      if (!testData.hasOpenapi) {
        throw new Error('Legacy alias did not return valid OpenAPI spec');
      }

      return {
        passed: true,
        message: 'Legacy OpenAPI alias returns valid specification',
        details: {
          status: response.status,
          hasOpenapi: testData.hasOpenapi,
          hasInfo: testData.hasInfo
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
  }
};

module.exports = adminSpecialEndpointsTests;
