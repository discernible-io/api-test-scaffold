/**
 * Discovery Endpoints Tests
 * 
 * Tests for public discovery endpoints that provide API information and documentation.
 * These endpoints are critical for API usability and should have both positive and negative coverage.
 */

const { logger } = require('../../sdk');
const { ulid } = require('ulid');
const { fetchDirect } = require('./test-utils');

const discoveryTests = {
  /**
   * Test GET / (root endpoint)
   * Verifies API discovery information is available
   */
  testRootEndpoint: async (api_ep) => {
    const moduleName = 'discovery-endpoints';
    const testName = 'testRootEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasName = !!data.name;
      testData.hasVersion = !!data.version;
      testData.hasEnrollment = !!data.enrollment;
      testData.hasDocumentation = !!data.documentation;
      testData.hasEndpoints = !!data.endpoints;
      testData.hasWellKnown = !!data.wellKnown;
      testData.hasMcp = !!data.mcp;
      testData.hasRequestId = !!data.requestId;
      testData.hasTimestamp = !!data.timestamp;

      const requiredFields = [
        'name', 'version', 'enrollment', 'documentation', 
        'endpoints', 'wellKnown', 'mcp', 'requestId', 'timestamp'
      ];
      const missingFields = requiredFields.filter(f => !data[f]);

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      return {
        passed: true,
        message: 'Root endpoint returns complete API discovery information',
        details: {
          hasAllRequiredFields: true,
          apiName: data.name,
          apiVersion: data.version
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
   * Test GET /health
   * Verifies health check endpoint works
   */
  testHealthEndpoint: async (api_ep) => {
    const moduleName = 'discovery-endpoints';
    const testName = 'testHealthEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/health` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/health', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasStatus = !!data.status;
      testData.hasDegraded = data.degraded !== undefined;
      testData.hasChecks = !!data.checks;
      testData.hasService = !!data.service;
      testData.hasTimestamp = !!data.timestamp;
      testData.hasInstance = !!data.instance;

      const requiredFields = ['status', 'degraded', 'checks', 'service', 'timestamp', 'instance'];
      const missingFields = requiredFields.filter(f => !data[f] && data[f] !== false);

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      if (!['healthy', 'degraded'].includes(data.status)) {
        throw new Error(`Invalid status value: ${data.status}`);
      }

      return {
        passed: true,
        message: 'Health check endpoint returns valid status',
        details: {
          status: data.status,
          isDegraded: data.degraded
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
   * Test GET /openapi.json
   * Verifies OpenAPI specification is available
   */
  testOpenApiEndpoint: async (api_ep) => {
    const moduleName = 'discovery-endpoints';
    const testName = 'testOpenApiEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/openapi.json` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/openapi.json', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasOpenapi = !!data.openapi;
      testData.hasInfo = !!data.info;
      testData.hasPaths = !!data.paths;
      testData.hasComponents = !!data.components;

      if (!data.openapi || !data.info || !data.paths) {
        throw new Error('OpenAPI spec missing required fields: openapi, info, paths');
      }

      return {
        passed: true,
        message: 'OpenAPI specification is available and valid',
        details: {
          openapiVersion: data.openapi,
          apiTitle: data.info.title,
          pathCount: Object.keys(data.paths).length
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
   * Test GET /.well-known/enrollment
   * Verifies enrollment information is available
   */
  testEnrollmentEndpoint: async (api_ep) => {
    const moduleName = 'discovery-endpoints';
    const testName = 'testEnrollmentEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/enrollment` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/enrollment', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasTitle = !!data.title;
      testData.hasEnrollment = !!data.enrollment;
      testData.hasEnrollmentSteps = !!data.enrollmentSteps;
      testData.hasSupport = !!data.support;
      testData.hasRequestId = !!data.requestId;
      testData.hasTimestamp = !!data.timestamp;

      const requiredFields = ['title', 'enrollment', 'enrollmentSteps', 'support', 'requestId', 'timestamp'];
      const missingFields = requiredFields.filter(f => !data[f]);

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      return {
        passed: true,
        message: 'Enrollment information endpoint returns complete data',
        details: {
          title: data.title,
          stepCount: data.enrollmentSteps?.length || 0
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
   * Test GET /.well-known/mcp
   * Verifies MCP discovery metadata is available
   */
  testMcpDiscoveryEndpoint: async (api_ep) => {
    const moduleName = 'discovery-endpoints';
    const testName = 'testMcpDiscoveryEndpoint';
    const correlationId = ulid();
    const testData = { api_ep, endpoint: `${api_ep}/.well-known/mcp` };

    logger.info(`Starting test: ${testName}`, {
      component: 'TestRunner',
      moduleName,
      testName,
      correlationId
    });

    try {
      const response = await fetchDirect(api_ep, '/.well-known/mcp', {
        method: 'GET',
        headers: { 'X-Request-ID': correlationId }
      });

      testData.status = response.status;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Expected 200, got ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      testData.hasTitle = !!data.title;
      testData.hasTransport = !!data.transport;
      testData.hasResources = !!data.resources;
      testData.hasTools = !!data.tools;
      testData.hasRegistration = !!data.registration;
      testData.hasDocs = !!data.docs;
      testData.hasRequestId = !!data.requestId;
      testData.hasTimestamp = !!data.timestamp;

      const requiredFields = ['title', 'transport', 'resources', 'tools', 'registration', 'docs', 'requestId', 'timestamp'];
      const missingFields = requiredFields.filter(f => !data[f]);

      if (missingFields.length > 0) {
        throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
      }

      return {
        passed: true,
        message: 'MCP discovery metadata endpoint returns complete data',
        details: {
          title: data.title,
          toolCount: data.tools?.length || 0
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

module.exports = discoveryTests;
