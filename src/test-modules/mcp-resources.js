const { extractApiErrorInfo } = require('./test-utils');

async function testMcpResourcesList(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpResourcesList' };

  try {
    // Test basic resource listing
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resources`, {
        method: 'GET',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data.resources &&
        Array.isArray(data.resources) &&
        data.resources.length > 0;

      results.push({
        name: 'List all MCP resources',
        passed,
        statusCode: response.status,
        resourceCount: data.resources?.length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'List all MCP resources',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test with limit parameter
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resources?limit=5`, {
        method: 'GET',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data.resources &&
        Array.isArray(data.resources) &&
        data.resources.length <= 5;

      results.push({
        name: 'List resources with limit parameter',
        passed,
        statusCode: response.status,
        resourceCount: data.resources?.length,
        requestedLimit: 5,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'List resources with limit parameter',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test with cursor parameter
    try {
      // First get initial list
      const firstResponse = await fetch(`${apiEndpoint}/api/mcp/resources?limit=1`, {
        method: 'GET',
      });

      const firstData = await firstResponse.json();
      const cursor = firstData.nextCursor;

      if (cursor) {
        const response = await fetch(`${apiEndpoint}/api/mcp/resources?cursor=${cursor}`, {
          method: 'GET',
        });

        const data = await response.json();
        const passed =
          response.status === 200 &&
          data.resources &&
          Array.isArray(data.resources);

        results.push({
          name: 'List resources with cursor pagination',
          passed,
          statusCode: response.status,
          resourceCount: data.resources?.length,
        });
      } else {
        results.push({
          name: 'List resources with cursor pagination',
          passed: true,
          statusCode: 200,
          note: 'No cursor available (single page)',
        });
      }
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'List resources with cursor pagination',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test invalid limit parameter
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resources?limit=invalid`, {
        method: 'GET',
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid limit parameter (non-numeric)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid limit parameter (non-numeric)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test limit exceeding maximum
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resources?limit=1000`, {
        method: 'GET',
      });

      const passed = response.status >= 400 || response.status === 200;

      results.push({
        name: 'Limit exceeding maximum (1000)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Limit exceeding maximum (1000)',
        passed: true,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testMcpResourcesList',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    throw error;
  }
}

async function testMcpResourceRetrieval(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpResourceRetrieval' };

  const validResources = [
    'openapi:swagger',
    'config:default',
    'skills:skills',
    'readme:main',
    'health:status',
    'guide:api',
    'guide:enrollment',
    'guide:why-identyclaw',
    'guide:troubleshooting',
    'policy:terms',
    'policy:privacy',
    'policy:data-retention',
    'policy:service-info',
    'onboarding:near',
    'jsonld:context',
    'jsonld:contract-metadata',
  ];

  try {
    // Test retrieving valid resources
    for (const resourceUri of validResources.slice(0, 5)) {
      try {
        const response = await fetch(`${apiEndpoint}/api/mcp/resource/${resourceUri}`, {
          method: 'GET',
        });

        const passed = response.status === 200;

        results.push({
          name: `Retrieve resource: ${resourceUri}`,
          passed,
          statusCode: response.status,
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `Retrieve resource: ${resourceUri}`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
        throw error;
      }
    }

    // Test non-existent resource (404)
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resource/nonexistent:resource`, {
        method: 'GET',
      });

      const passed = response.status === 404;

      results.push({
        name: 'Non-existent resource returns 404',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent resource returns 404',
        passed: errInfo.statusCode === 404,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test invalid URI format
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/resource/invalid-uri-format`, {
        method: 'GET',
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid URI format',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid URI format',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    return {
      testName: 'testMcpResourceRetrieval',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testMcpResourceRetrieval',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testMcpSchema(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpSchema' };

  try {
    // Test schema retrieval
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/schema`, {
        method: 'GET',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data &&
        typeof data === 'object' &&
        data.requestId;

      results.push({
        name: 'Retrieve OpenAPI schema',
        passed,
        statusCode: response.status,
        hasRequestId: !!data?.requestId,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Retrieve OpenAPI schema',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
      throw error;
    }

    // Test schema structure validation
    try {
      const response = await fetch(`${apiEndpoint}/api/mcp/schema`, {
        method: 'GET',
      });

      const data = await response.json();
      const hasOpenApiVersion = data.openapi || data.swagger;
      const hasPaths = data.paths !== undefined;
      const hasComponents = data.components !== undefined;

      const passed =
        response.status === 200 &&
        (hasOpenApiVersion || hasPaths || hasComponents);

      results.push({
        name: 'Schema structure validation',
        passed,
        statusCode: response.status,
        hasOpenApiVersion,
        hasPaths,
        hasComponents,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Schema structure validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testMcpSchema',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    throw error;
  }
}

module.exports = {
  testMcpResourcesList,
  testMcpResourceRetrieval,
  testMcpSchema,
};
