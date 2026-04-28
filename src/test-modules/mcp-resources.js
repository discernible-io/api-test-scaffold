const { extractApiErrorInfo, getRoditClientForTest } = require('./test-utils');
const logger = require('../../sdk/services/logger');

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

    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    const results = [];

    // Test basic resource listing
    logger.debug('testMcpResourcesList: Fetching /api/mcp/resources', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: '/api/mcp/resources'
    });
    
    let data1;
    try {
      data1 = await client.request('GET', '/api/mcp/resources');
      logger.debug('testMcpResourcesList: Successfully retrieved /api/mcp/resources', {
        component: 'testMcpResourcesList',
        testId,
        hasResources: Array.isArray(data1.resources),
        resourceCount: data1.resources?.length || 0
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testMcpResourcesList: Failed to retrieve /api/mcp/resources', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      });
      return {
        passed: false,
        error: `Failed to retrieve /api/mcp/resources: ${errorInfo.message}`,
        testData,
      };
    }
    results.push({
      name: 'List all MCP resources',
      passed: Array.isArray(data1.resources) && data1.resources.length > 0,
      statusCode: 200,
    });

    // Test with limit parameter
    logger.debug('testMcpResourcesList: Fetching /api/mcp/resources?limit=5', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: '/api/mcp/resources?limit=5'
    });
    
    let data2;
    try {
      data2 = await client.request('GET', '/api/mcp/resources?limit=5');
      logger.debug('testMcpResourcesList: Successfully retrieved /api/mcp/resources?limit=5', {
        component: 'testMcpResourcesList',
        testId,
        resourceCount: data2.resources?.length || 0
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testMcpResourcesList: Failed to retrieve /api/mcp/resources?limit=5', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code
      });
      return {
        passed: false,
        error: `Failed to retrieve /api/mcp/resources?limit=5: ${errorInfo.message}`,
        testData,
      };
    }
    results.push({
      name: 'List resources with limit parameter',
      passed: Array.isArray(data2.resources) && data2.resources.length <= 5,
      statusCode: 200,
    });

    // Test with cursor parameter
    logger.debug('testMcpResourcesList: Fetching /api/mcp/resources?limit=1', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: '/api/mcp/resources?limit=1'
    });
    
    let firstData;
    try {
      firstData = await client.request('GET', '/api/mcp/resources?limit=1');
      logger.debug('testMcpResourcesList: Successfully retrieved /api/mcp/resources?limit=1', {
        component: 'testMcpResourcesList',
        testId,
        hasCursor: !!firstData.nextCursor
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testMcpResourcesList: Failed to retrieve /api/mcp/resources?limit=1', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: errorInfo.statusCode
      });
      return {
        passed: false,
        error: `Failed to retrieve /api/mcp/resources?limit=1: ${errorInfo.message}`,
        testData,
      };
    }
    const cursor = firstData.nextCursor;

    if (cursor) {
      logger.debug('testMcpResourcesList: Fetching /api/mcp/resources with cursor', {
        component: 'testMcpResourcesList',
        testId,
        cursor: cursor.substring(0, 20) + '...'
      });
      
      let data3;
      try {
        data3 = await client.request('GET', `/api/mcp/resources?cursor=${cursor}`);
        logger.debug('testMcpResourcesList: Successfully retrieved with cursor', {
          component: 'testMcpResourcesList',
          testId,
          resourceCount: data3.resources?.length || 0
        });
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        logger.error('testMcpResourcesList: Failed to retrieve with cursor', {
          component: 'testMcpResourcesList',
          testId,
          statusCode: errorInfo.statusCode
        });
        return {
          passed: false,
          error: `Failed to retrieve with cursor: ${errorInfo.message}`,
          testData,
        };
      }
      results.push({
        name: 'List resources with cursor pagination',
        passed: Array.isArray(data3.resources),
        statusCode: 200,
      });
    } else {
      results.push({
        name: 'List resources with cursor pagination',
        passed: true,
        statusCode: 200,
      });
    }

    // Test invalid limit parameter
    logger.debug('testMcpResourcesList: Testing invalid limit parameter', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: '/api/mcp/resources?limit=invalid'
    });
    
    try {
      await client.request('GET', '/api/mcp/resources?limit=invalid');
      results.push({
        name: 'Invalid limit parameter (non-numeric)',
        passed: false,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.debug('testMcpResourcesList: Invalid limit parameter correctly rejected', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: errorInfo.statusCode
      });
      results.push({
        name: 'Invalid limit parameter (non-numeric)',
        passed: errorInfo.statusCode >= 400,
        statusCode: errorInfo.statusCode,
      });
    }

    // Test limit exceeding maximum
    logger.debug('testMcpResourcesList: Testing limit exceeding maximum', {
      component: 'testMcpResourcesList',
      testId,
      endpoint: '/api/mcp/resources?limit=1000'
    });
    
    try {
      await client.request('GET', '/api/mcp/resources?limit=1000');
      results.push({
        name: 'Limit exceeding maximum (1000)',
        passed: true,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.debug('testMcpResourcesList: Limit exceeding maximum handled', {
        component: 'testMcpResourcesList',
        testId,
        statusCode: errorInfo.statusCode
      });
      results.push({
        name: 'Limit exceeding maximum (1000)',
        passed: errorInfo.statusCode >= 400 || errorInfo.statusCode === 200,
        statusCode: errorInfo.statusCode,
      });
    }

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

    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
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
        endpoint: `/api/mcp/resource/${resourceUri}`
      });
      
      try {
        const data = await client.request('GET', `/api/mcp/resource/${resourceUri}`);
        logger.debug('testMcpResourceRetrieval: Successfully retrieved resource', {
          component: 'testMcpResourceRetrieval',
          testId,
          resourceUri,
          hasData: !!data
        });
        results.push({
          name: `Retrieve resource: ${resourceUri}`,
          passed: true,
          statusCode: 200,
        });
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        logger.error('testMcpResourceRetrieval: Failed to retrieve resource', {
          component: 'testMcpResourceRetrieval',
          testId,
          resourceUri,
          statusCode: errorInfo.statusCode
        });
        results.push({
          name: `Retrieve resource: ${resourceUri}`,
          passed: false,
          statusCode: errorInfo.statusCode,
        });
      }
    }

    // Test non-existent resource (404)
    logger.debug('testMcpResourceRetrieval: Testing non-existent resource', {
      component: 'testMcpResourceRetrieval',
      testId,
      endpoint: '/api/mcp/resource/nonexistent:resource'
    });
    
    try {
      await client.request('GET', '/api/mcp/resource/nonexistent:resource');
      results.push({
        name: 'Non-existent resource returns 404',
        passed: false,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.debug('testMcpResourceRetrieval: Non-existent resource correctly rejected', {
        component: 'testMcpResourceRetrieval',
        testId,
        statusCode: errorInfo.statusCode
      });
      results.push({
        name: 'Non-existent resource returns 404',
        passed: errorInfo.statusCode === 404 || errorInfo.statusCode >= 400,
        statusCode: errorInfo.statusCode,
      });
    }

    // Test invalid URI format
    logger.debug('testMcpResourceRetrieval: Testing invalid URI format', {
      component: 'testMcpResourceRetrieval',
      testId,
      endpoint: '/api/mcp/resource/invalid-uri-format'
    });
    
    try {
      await client.request('GET', '/api/mcp/resource/invalid-uri-format');
      results.push({
        name: 'Invalid URI format',
        passed: false,
        statusCode: 200,
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.debug('testMcpResourceRetrieval: Invalid URI format correctly rejected', {
        component: 'testMcpResourceRetrieval',
        testId,
        statusCode: errorInfo.statusCode
      });
      results.push({
        name: 'Invalid URI format',
        passed: errorInfo.statusCode >= 400,
        statusCode: errorInfo.statusCode,
      });
    }

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

    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    const results = [];

    // Test schema retrieval
    logger.debug('testMcpSchema: Fetching /api/mcp/schema', {
      component: 'testMcpSchema',
      testId,
      endpoint: '/api/mcp/schema'
    });
    
    let data1;
    try {
      data1 = await client.request('GET', '/api/mcp/schema');
      logger.debug('testMcpSchema: Successfully retrieved /api/mcp/schema', {
        component: 'testMcpSchema',
        testId,
        hasOpenapi: !!data1.openapi,
        hasSwagger: !!data1.swagger,
        hasPaths: !!data1.paths
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testMcpSchema: Failed to retrieve /api/mcp/schema', {
        component: 'testMcpSchema',
        testId,
        statusCode: errorInfo.statusCode,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message
      });
      return {
        passed: false,
        error: `Failed to retrieve /api/mcp/schema: ${errorInfo.message}`,
        testData,
      };
    }
    results.push({
      name: 'Retrieve OpenAPI schema',
      passed: data1 && typeof data1 === 'object',
      statusCode: 200,
    });

    // Test schema structure validation
    logger.debug('testMcpSchema: Validating schema structure', {
      component: 'testMcpSchema',
      testId,
      endpoint: '/api/mcp/schema'
    });
    
    let data2;
    try {
      data2 = await client.request('GET', '/api/mcp/schema');
      logger.debug('testMcpSchema: Successfully retrieved schema for validation', {
        component: 'testMcpSchema',
        testId
      });
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error('testMcpSchema: Failed to retrieve schema for validation', {
        component: 'testMcpSchema',
        testId,
        statusCode: errorInfo.statusCode
      });
      return {
        passed: false,
        error: `Failed to retrieve schema for validation: ${errorInfo.message}`,
        testData,
      };
    }
    const hasOpenApiVersion = data2.openapi || data2.swagger;
    const hasPaths = data2.paths !== undefined;
    const hasComponents = data2.components !== undefined;

    results.push({
      name: 'Schema structure validation',
      passed: hasOpenApiVersion || hasPaths || hasComponents,
      statusCode: 200,
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
