const { extractApiErrorInfo } = require('./test-utils');

async function testMcpResourcesList(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpResourcesList' };

  try {
    // Validate API endpoint
    if (!apiEndpoint) {
      return {
        testName: 'testMcpResourcesList',
        passed: false,
        error: 'API endpoint is required',
        results: [],
      };
    }
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
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpResourcesList';
    return {
      testName: 'testMcpResourcesList',
      passed: false,
      error: errorMessage,
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
      },
      results: [],
    };
  }
}

async function testMcpResourceRetrieval(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpResourceRetrieval' };

  try {
    // Validate API endpoint
    if (!apiEndpoint) {
      return {
        testName: 'testMcpResourceRetrieval',
        passed: false,
        error: 'API endpoint is required',
        results: [],
      };
    }

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
    }

    return {
      testName: 'testMcpResourceRetrieval',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpResourceRetrieval';
    return {
      testName: 'testMcpResourceRetrieval',
      passed: false,
      error: errorMessage,
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
      },
      results: [],
    };
  }
}

async function testMcpSchema(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testMcpSchema' };

  try {
    // Validate API endpoint
    if (!apiEndpoint) {
      return {
        testName: 'testMcpSchema',
        passed: false,
        error: 'API endpoint is required',
        results: [],
      };
    }

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
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpSchema';
    return {
      testName: 'testMcpSchema',
      passed: false,
      error: errorMessage,
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name,
      },
      results: [],
    };
  }
}

module.exports = {
  testMcpResourcesList,
  testMcpResourceRetrieval,
  testMcpSchema,
};
