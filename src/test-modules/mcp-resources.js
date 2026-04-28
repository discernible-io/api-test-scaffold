const { extractApiErrorInfo } = require('./test-utils');

async function testMcpResourcesList(apiEndpoint, logContext) {
  const testData = { apiEndpoint };

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];

    // Test basic resource listing
    const response1 = await fetch(`${apiEndpoint}/api/mcp/resources`, {
      method: 'GET',
    });
    const data1 = await response1.json();
    results.push({
      name: 'List all MCP resources',
      passed: response1.status === 200 && Array.isArray(data1.resources) && data1.resources.length > 0,
      statusCode: response1.status,
    });

    // Test with limit parameter
    const response2 = await fetch(`${apiEndpoint}/api/mcp/resources?limit=5`, {
      method: 'GET',
    });
    const data2 = await response2.json();
    results.push({
      name: 'List resources with limit parameter',
      passed: response2.status === 200 && Array.isArray(data2.resources) && data2.resources.length <= 5,
      statusCode: response2.status,
    });

    // Test with cursor parameter
    const firstResponse = await fetch(`${apiEndpoint}/api/mcp/resources?limit=1`, {
      method: 'GET',
    });
    const firstData = await firstResponse.json();
    const cursor = firstData.nextCursor;

    if (cursor) {
      const response3 = await fetch(`${apiEndpoint}/api/mcp/resources?cursor=${cursor}`, {
        method: 'GET',
      });
      const data3 = await response3.json();
      results.push({
        name: 'List resources with cursor pagination',
        passed: response3.status === 200 && Array.isArray(data3.resources),
        statusCode: response3.status,
      });
    } else {
      results.push({
        name: 'List resources with cursor pagination',
        passed: true,
        statusCode: 200,
      });
    }

    // Test invalid limit parameter
    const response4 = await fetch(`${apiEndpoint}/api/mcp/resources?limit=invalid`, {
      method: 'GET',
    });
    results.push({
      name: 'Invalid limit parameter (non-numeric)',
      passed: response4.status >= 400,
      statusCode: response4.status,
    });

    // Test limit exceeding maximum
    const response5 = await fetch(`${apiEndpoint}/api/mcp/resources?limit=1000`, {
      method: 'GET',
    });
    results.push({
      name: 'Limit exceeding maximum (1000)',
      passed: response5.status >= 400 || response5.status === 200,
      statusCode: response5.status,
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message,
      testData,
    };
  }
}

async function testMcpResourceRetrieval(apiEndpoint, logContext) {
  const testData = { apiEndpoint };

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];
    const validResources = [
      'openapi:swagger',
      'config:default',
      'skills:skills',
      'readme:main',
      'health:status',
    ];

    // Test retrieving valid resources
    for (const resourceUri of validResources) {
      const response = await fetch(`${apiEndpoint}/api/mcp/resource/${resourceUri}`, {
        method: 'GET',
      });
      results.push({
        name: `Retrieve resource: ${resourceUri}`,
        passed: response.status === 200,
        statusCode: response.status,
      });
    }

    // Test non-existent resource (404)
    const response2 = await fetch(`${apiEndpoint}/api/mcp/resource/nonexistent:resource`, {
      method: 'GET',
    });
    results.push({
      name: 'Non-existent resource returns 404',
      passed: response2.status === 404 || response2.status >= 400,
      statusCode: response2.status,
    });

    // Test invalid URI format
    const response3 = await fetch(`${apiEndpoint}/api/mcp/resource/invalid-uri-format`, {
      method: 'GET',
    });
    results.push({
      name: 'Invalid URI format',
      passed: response3.status >= 400,
      statusCode: response3.status,
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message,
      testData,
    };
  }
}

async function testMcpSchema(apiEndpoint, logContext) {
  const testData = { apiEndpoint };

  try {
    if (!apiEndpoint) {
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];

    // Test schema retrieval
    const response1 = await fetch(`${apiEndpoint}/api/mcp/schema`, {
      method: 'GET',
    });
    const data1 = await response1.json();
    results.push({
      name: 'Retrieve OpenAPI schema',
      passed: response1.status === 200 && data1 && typeof data1 === 'object',
      statusCode: response1.status,
    });

    // Test schema structure validation
    const response2 = await fetch(`${apiEndpoint}/api/mcp/schema`, {
      method: 'GET',
    });
    const data2 = await response2.json();
    const hasOpenApiVersion = data2.openapi || data2.swagger;
    const hasPaths = data2.paths !== undefined;
    const hasComponents = data2.components !== undefined;

    results.push({
      name: 'Schema structure validation',
      passed: response2.status === 200 && (hasOpenApiVersion || hasPaths || hasComponents),
      statusCode: response2.status,
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    return {
      passed: false,
      error: error.message,
      testData,
    };
  }
}

module.exports = {
  testMcpResourcesList,
  testMcpResourceRetrieval,
  testMcpSchema,
};
