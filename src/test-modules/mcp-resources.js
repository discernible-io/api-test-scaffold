const { extractApiErrorInfo } = require('./test-utils');
const logger = require('../utils/logger');

async function testMcpResourcesList(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      logger.error('testMcpResourcesList: API endpoint is required', {
        component: 'testMcpResourcesList',
        testId,
        error: 'API endpoint missing'
      });
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];

    // Test basic resource listing
    logger.debug('testMcpResourcesList: Fetching /api/mcp/resources', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: `${apiEndpoint}/api/mcp/resources`
    });
    
    const response1 = await fetch(`${apiEndpoint}/api/mcp/resources`, {
      method: 'GET',
    });
    
    logger.debug('testMcpResourcesList: Received response from /api/mcp/resources', {
      component: 'testMcpResourcesList',
      testId,
      statusCode: response1.status,
      statusText: response1.statusText,
      contentType: response1.headers.get('content-type')
    });
    
    let data1;
    try {
      data1 = await response1.json();
      logger.debug('testMcpResourcesList: Successfully parsed JSON from /api/mcp/resources', {
        component: 'testMcpResourcesList',
        testId,
        hasResources: Array.isArray(data1.resources),
        resourceCount: data1.resources?.length || 0
      });
    } catch (parseError) {
      logger.error('testMcpResourcesList: Failed to parse JSON from /api/mcp/resources', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: response1.status,
        contentType: response1.headers.get('content-type'),
        parseError: parseError.message,
        responseText: await response1.text().catch(() => 'unable to read response')
      });
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/mcp/resources: ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'List all MCP resources',
      passed: response1.status === 200 && Array.isArray(data1.resources) && data1.resources.length > 0,
      statusCode: response1.status,
    });

    // Test with limit parameter
    const response2 = await fetch(`${apiEndpoint}/api/mcp/resources?limit=5`, {
      method: 'GET',
    });
    let data2;
    try {
      data2 = await response2.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/mcp/resources?limit=5: ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'List resources with limit parameter',
      passed: response2.status === 200 && Array.isArray(data2.resources) && data2.resources.length <= 5,
      statusCode: response2.status,
    });

    // Test with cursor parameter
    const firstResponse = await fetch(`${apiEndpoint}/api/mcp/resources?limit=1`, {
      method: 'GET',
    });
    let firstData;
    try {
      firstData = await firstResponse.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/mcp/resources?limit=1: ${parseError.message}`,
        testData,
      };
    }
    const cursor = firstData.nextCursor;

    if (cursor) {
      const response3 = await fetch(`${apiEndpoint}/api/mcp/resources?cursor=${cursor}`, {
        method: 'GET',
      });
      let data3;
      try {
        data3 = await response3.json();
      } catch (parseError) {
        return {
          passed: false,
          error: `Failed to parse JSON response from /api/mcp/resources with cursor: ${parseError.message}`,
          testData,
        };
      }
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

    logger.info('testMcpResourcesList: All tests completed', {
      component: 'testMcpResourcesList',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpResourcesList';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testMcpResourcesList: Outer catch block - unhandled exception', {
      component: 'testMcpResourcesList',
      testId,
      errorMessage,
      errorName: error?.name,
      errorStack,
      errorType: typeof error,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

async function testMcpResourceRetrieval(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      logger.error('testMcpResourceRetrieval: API endpoint is required', {
        component: 'testMcpResourceRetrieval',
        testId,
        error: 'API endpoint missing'
      });
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

    logger.debug('testMcpResourceRetrieval: Starting resource retrieval tests', {
      component: 'testMcpResourceRetrieval',
      testId,
      resourceCount: validResources.length
    });

    // Test retrieving valid resources
    for (const resourceUri of validResources) {
      logger.debug('testMcpResourceRetrieval: Fetching resource', {
        component: 'testMcpResourceRetrieval',
        testId,
        resourceUri,
        endpoint: `${apiEndpoint}/api/mcp/resource/${resourceUri}`
      });
      
      const response = await fetch(`${apiEndpoint}/api/mcp/resource/${resourceUri}`, {
        method: 'GET',
      });
      
      logger.debug('testMcpResourceRetrieval: Received response for resource', {
        component: 'testMcpResourceRetrieval',
        testId,
        resourceUri,
        statusCode: response.status,
        statusText: response.statusText
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

    logger.info('testMcpResourceRetrieval: All tests completed', {
      component: 'testMcpResourceRetrieval',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpResourceRetrieval';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testMcpResourceRetrieval: Outer catch block - unhandled exception', {
      component: 'testMcpResourceRetrieval',
      testId,
      errorMessage,
      errorName: error?.name,
      errorStack,
      errorType: typeof error,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

async function testMcpSchema(apiEndpoint, logContext) {
  const testData = { apiEndpoint };
  const testId = logContext?.testId || 'unknown';

  try {
    if (!apiEndpoint) {
      logger.error('testMcpSchema: API endpoint is required', {
        component: 'testMcpSchema',
        testId,
        error: 'API endpoint missing'
      });
      return {
        passed: false,
        error: 'API endpoint is required',
        testData,
      };
    }

    const results = [];

    // Test schema retrieval
    logger.debug('testMcpSchema: Fetching /api/mcp/schema', {
      component: 'testMcpSchema',
      testId,
      endpoint: `${apiEndpoint}/api/mcp/schema`
    });
    
    const response1 = await fetch(`${apiEndpoint}/api/mcp/schema`, {
      method: 'GET',
    });
    
    logger.debug('testMcpSchema: Received response from /api/mcp/schema', {
      component: 'testMcpSchema',
      testId,
      statusCode: response1.status,
      statusText: response1.statusText,
      contentType: response1.headers.get('content-type')
    });
    
    let data1;
    try {
      data1 = await response1.json();
      logger.debug('testMcpSchema: Successfully parsed JSON from /api/mcp/schema', {
        component: 'testMcpSchema',
        testId,
        hasOpenapi: !!data1.openapi,
        hasSwagger: !!data1.swagger,
        hasPaths: !!data1.paths
      });
    } catch (parseError) {
      logger.error('testMcpSchema: Failed to parse JSON from /api/mcp/schema', {
        component: 'testMcpSchema',
        testId,
        statusCode: response1.status,
        contentType: response1.headers.get('content-type'),
        parseError: parseError.message,
        responseText: await response1.text().catch(() => 'unable to read response')
      });
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/mcp/schema: ${parseError.message}`,
        testData,
      };
    }
    results.push({
      name: 'Retrieve OpenAPI schema',
      passed: response1.status === 200 && data1 && typeof data1 === 'object',
      statusCode: response1.status,
    });

    // Test schema structure validation
    const response2 = await fetch(`${apiEndpoint}/api/mcp/schema`, {
      method: 'GET',
    });
    let data2;
    try {
      data2 = await response2.json();
    } catch (parseError) {
      return {
        passed: false,
        error: `Failed to parse JSON response from /api/mcp/schema (second call): ${parseError.message}`,
        testData,
      };
    }
    const hasOpenApiVersion = data2.openapi || data2.swagger;
    const hasPaths = data2.paths !== undefined;
    const hasComponents = data2.components !== undefined;

    results.push({
      name: 'Schema structure validation',
      passed: response2.status === 200 && (hasOpenApiVersion || hasPaths || hasComponents),
      statusCode: response2.status,
    });

    logger.info('testMcpSchema: All tests completed', {
      component: 'testMcpSchema',
      testId,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    });

    return {
      passed: results.every(r => r.passed),
      testData,
      results,
    };
  } catch (error) {
    const errorMessage = error?.message || error?.toString() || 'Unknown error in testMcpSchema';
    const errorStack = error?.stack || 'no stack trace';
    
    logger.error('testMcpSchema: Outer catch block - unhandled exception', {
      component: 'testMcpSchema',
      testId,
      errorMessage,
      errorName: error?.name,
      errorStack,
      errorType: typeof error,
      fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
    });
    
    return {
      passed: false,
      error: errorMessage,
      testData,
    };
  }
}

module.exports = {
  testMcpResourcesList,
  testMcpResourceRetrieval,
  testMcpSchema,
};
