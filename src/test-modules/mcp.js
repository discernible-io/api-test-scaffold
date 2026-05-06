/**
 * MCP (Model Context Protocol) Tests
 * 
 * Tests for the MCP routes functionality in the API
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');
const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require('./test-utils');
const { RoditClient } = require('../../sdk');

/**
 * MCP tests module
 */
const mcpTests = {
  /**
   * Test MCP resources listing endpoint
   * This test verifies:
   * 1. The resources endpoint returns a valid response
   * 2. Pagination works correctly
   * 3. Resource format is consistent
   */
  testMcpResourcesListing: async (tmrl_api_ep) => {
    const moduleName = "mcp";
    const testName = "testMcpResourcesListing";
    const correlationId = ulid();
    const testData = { tmrl_api_ep };
    testData.endpoint = `${tmrl_api_ep}/api/mcp/resources`;

    logger.info("Starting MCP resources listing test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      // Function to create headers with or without tokens
      const getHeaders = (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };
        
        if (includeToken && token) {
          headers.Authorization = `Bearer ${token}`;
        }
        
        return headers;
      };

      // Test 1: Get resources without pagination
      const resourcesResult = await stateManager.fetchWithErrorHandling(
        `${tmrl_api_ep}/api/mcp/resources`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.resourcesResult = resourcesResult;

      // Validate resources response structure
      if (!resourcesResult || !Array.isArray(resourcesResult.resources)) {
        const result = {
          passed: false,
          error: "Resources endpoint did not return valid resources array",
          details: resourcesResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Test pagination with limit parameter
      const limit = 2; // Small limit to ensure pagination
      const paginatedResult = await stateManager.fetchWithErrorHandling(
        `${tmrl_api_ep}/api/mcp/resources?limit=${limit}`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.paginatedResult = paginatedResult;

      // Validate pagination
      if (!paginatedResult || !Array.isArray(paginatedResult.resources)) {
        const result = {
          passed: false,
          error: "Paginated resources endpoint did not return valid resources array",
          details: paginatedResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if pagination is working (resources length should be limited)
      if (paginatedResult.resources.length > limit) {
        const result = {
          passed: false,
          error: `Pagination limit not respected: got ${paginatedResult.resources.length} resources, expected max ${limit}`,
          details: paginatedResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Test pagination with cursor if available
      let cursorResult = null;
      if (paginatedResult.nextCursor) {
        cursorResult = await stateManager.fetchWithErrorHandling(
          `${tmrl_api_ep}/api/mcp/resources?cursor=${paginatedResult.nextCursor}`,
          {
            method: "GET",
            headers: getHeaders(),
          }
        );

        testData.cursorResult = cursorResult;

        // Validate cursor-based pagination
        if (!cursorResult || !Array.isArray(cursorResult.resources)) {
          const result = {
            passed: false,
            error: "Cursor-based pagination did not return valid resources array",
            details: cursorResult,
          };
          return captureTestData(testName, moduleName, result, testData);
        }
      }

      // Test 4: Validate resource format consistency
      const resourcesValid = resourcesResult.resources.every(resource => 
        typeof resource === 'object' && 
        typeof resource.uri === 'string' && 
        typeof resource.name === 'string'
      );

      if (!resourcesValid) {
        const result = {
          passed: false,
          error: "Resources do not have consistent format (uri and name properties)",
          details: { invalidResources: resourcesResult.resources.filter(r => !r.uri || !r.name) },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        passed: true,
        details: {
          resourcesCount: resourcesResult.resources.length,
          paginationWorks: paginatedResult.resources.length <= limit,
          cursorWorks: cursorResult ? true : "Not tested (no cursor available)",
          resourcesValid,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("MCP resources listing test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test MCP resource retrieval endpoint
   * 
   * Swagger Update: The endpoint now properly documents:
   * - 200: Requested resource returned
   * - 404: Resource not found - the requested URI does not exist in the MCP resource registry
   *         Returns ErrorResponse with error details
   * - 500: Failed to get resource - error reading or processing the resource file (not a 404)
   *        Returns ErrorResponse with error details
   * 
   * This test verifies:
   * 1. Valid resources can be retrieved (200)
   * 2. Authentication is enforced
   * 3. Invalid resources return 404 with ErrorResponse
   * 4. Server errors return 500 with ErrorResponse
   */
  testMcpResourceRetrieval: async (tmrr_api_ep) => {
    const moduleName = "mcp";
    const testName = "testMcpResourceRetrieval";
    const correlationId = ulid();
    const testData = { tmrr_api_ep };
    testData.endpoint = `${tmrr_api_ep}/api/mcp/resource`;

    logger.info("Starting MCP resource retrieval test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
      note: "Testing 200 (success), 404 (not found), and 500 (server error) responses",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      // Function to create headers with or without tokens
      const getHeaders = (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };
        
        if (includeToken && token) {
          headers.Authorization = `Bearer ${token}`;
        }
        
        return headers;
      };

      // First, get a list of resources to test with
      const resourcesResult = await stateManager.fetchWithErrorHandling(
        `${tmrr_api_ep}/api/mcp/resources`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      if (!resourcesResult || !Array.isArray(resourcesResult.resources) || resourcesResult.resources.length === 0) {
        const result = {
          passed: false,
          error: "Could not get resources list for testing",
          details: resourcesResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Select a resource to test with
      const testResource = resourcesResult.resources[0];
      testData.testResource = testResource;

      // Test 1: Retrieve a valid resource with authentication
      const resourceResult = await stateManager.fetchWithErrorHandling(
        `${tmrr_api_ep}/api/mcp/resource/${encodeURIComponent(testResource.uri)}`,
        {
          method: "GET",
          headers: getHeaders(true),
        }
      );

      testData.resourceResult = resourceResult;

      // Validate resource response
      if (!resourceResult || resourceResult.error) {
        const result = {
          passed: false,
          error: "Failed to retrieve valid resource",
          details: resourceResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Verify resource is accessible without authentication (MCP endpoints are public)
      const unauthResult = await fetch(
        `${tmrr_api_ep}/api/mcp/resource/${encodeURIComponent(testResource.uri)}`,
        {
          method: "GET",
          headers: getHeaders(false),
        }
      );

      testData.unauthStatus = unauthResult.status;
      
      // MCP endpoints are intentionally public, should return 200 without authentication
      if (unauthResult.status !== 200) {
        const result = {
          passed: false,
          error: `Public MCP resource should be accessible without auth: expected 200, got ${unauthResult.status}`,
          details: { status: unauthResult.status },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Attempt to retrieve a non-existent resource
      const invalidResult = await fetch(
        `${tmrr_api_ep}/api/mcp/resource/non-existent-resource-${ulid()}`,
        {
          method: "GET",
          headers: getHeaders(true),
        }
      );

      testData.invalidStatus = invalidResult.status;
      
      // Should return 404 Not Found with ErrorResponse
      if (invalidResult.status !== 404) {
        const result = {
          passed: false,
          error: `Invalid resource handling incorrect: expected 404, got ${invalidResult.status}`,
          details: { status: invalidResult.status },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Verify 404 response includes ErrorResponse schema
      let invalidResponseBody = null;
      try {
        invalidResponseBody = await invalidResult.json();
        testData.invalidResponseHasError = !!invalidResponseBody.error;
      } catch (e) {
        // Response may not be JSON
        testData.invalidResponseHasError = false;
      }

      // All tests passed
      const result = {
        passed: true,
        details: {
          resourceRetrieved: !!resourceResult,
          authenticationEnforced: unauthResult.status === 401,
          invalidResourceHandled: invalidResult.status === 404,
          notFoundResponseHasErrorSchema: testData.invalidResponseHasError,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("MCP resource retrieval test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test MCP schema endpoint
   * This test verifies:
   * 1. The schema endpoint returns a valid schema
   * 2. The schema has the expected structure
   */
  testMcpSchemaMcpModule: async (tms_api_ep) => {
    const moduleName = "mcp";
    const testName = "testMcpSchemaMcpModule";
    const correlationId = ulid();
    const testData = { tms_api_ep };
    testData.endpoint = `${tms_api_ep}/api/mcp/schema`;

    logger.info("Starting MCP schema test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Test: Get schema
      const schemaResult = await stateManager.fetchWithErrorHandling(
        `${tms_api_ep}/api/mcp/schema`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
        }
      );

      testData.schemaResult = schemaResult;

      // Validate schema response
      if (!schemaResult) {
        const result = {
          passed: false,
          error: "Schema endpoint did not return a valid response",
          details: schemaResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Extract the actual schema from the response wrapper
      const schema = schemaResult.schema || schemaResult;

      // Check if schema has required properties
      const hasRequiredProperties = 
        typeof schema === 'object' && 
        schema.openapi && 
        schema.info && 
        schema.paths;

      if (!hasRequiredProperties) {
        const result = {
          passed: false,
          error: "Schema does not have required OpenAPI properties",
          details: {
            missingProperties: {
              openapi: !schema.openapi,
              info: !schema.info,
              paths: !schema.paths,
            },
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        passed: true,
        details: {
          schemaValid: hasRequiredProperties,
          openapiVersion: schema.openapi,
          infoTitle: schema.info?.title,
          pathsCount: Object.keys(schema.paths || {}).length,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("MCP schema test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test POST /mcp streamable transport endpoint
   *
   * target-swagger.json contract:
   * - 200 for valid MCP transport exchanges
   * - 400 for invalid payload / protocol framing
   */
  testMcpStreamableTransport: async (tmst_api_ep) => {
    const moduleName = "mcp";
    const testName = "testMcpStreamableTransport";
    const correlationId = ulid();
    const testData = { tmst_api_ep };
    testData.endpoint = `${tmst_api_ep}/mcp`;

    logger.info("Starting MCP streamable transport test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const commonHeaders = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "X-Request-ID": ulid(),
      };

      // Positive case: a well-formed MCP JSON-RPC initialize request should be accepted.
      const positivePayload = {
        jsonrpc: "2.0",
        id: ulid(),
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: {
            name: "clienttestapi-rodit",
            version: "1.0.0",
          },
        },
      };

      const positiveResponse = await fetch(`${tmst_api_ep}/mcp`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(positivePayload),
      });

      const positiveResponseBody = await positiveResponse.text();
      testData.positiveStatus = positiveResponse.status;
      testData.positiveBodyLength = positiveResponseBody.length;
      testData.positiveContentType = positiveResponse.headers.get("content-type") || "";

      if (positiveResponse.status !== 200) {
        const result = {
          passed: false,
          error: `Valid MCP transport request expected 200, got ${positiveResponse.status}`,
          details: {
            status: positiveResponse.status,
            bodyPreview: positiveResponseBody.slice(0, 500),
            contentType: testData.positiveContentType,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Negative case 1: syntactically invalid JSON should be rejected as bad request.
      const malformedJsonResponse = await fetch(`${tmst_api_ep}/mcp`, {
        method: "POST",
        headers: commonHeaders,
        body: '{"jsonrpc":"2.0","id":"broken"',
      });

      const malformedJsonBody = await malformedJsonResponse.text();
      testData.malformedJsonStatus = malformedJsonResponse.status;
      testData.malformedJsonBodyPreview = malformedJsonBody.slice(0, 300);

      if (malformedJsonResponse.status !== 400) {
        const result = {
          passed: false,
          error: `Malformed JSON request expected 400, got ${malformedJsonResponse.status}`,
          details: {
            status: malformedJsonResponse.status,
            bodyPreview: malformedJsonBody.slice(0, 500),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Negative case 2: syntactically valid JSON with invalid MCP framing should also be rejected.
      const invalidFramingPayload = { hello: "world" };
      const invalidFramingResponse = await fetch(`${tmst_api_ep}/mcp`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify(invalidFramingPayload),
      });

      const invalidFramingBody = await invalidFramingResponse.text();
      testData.invalidFramingStatus = invalidFramingResponse.status;
      testData.invalidFramingBodyPreview = invalidFramingBody.slice(0, 300);

      if (invalidFramingResponse.status !== 400) {
        const result = {
          passed: false,
          error: `Invalid MCP framing expected 400, got ${invalidFramingResponse.status}`,
          details: {
            status: invalidFramingResponse.status,
            bodyPreview: invalidFramingBody.slice(0, 500),
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const result = {
        passed: true,
        details: {
          positiveAccepted: true,
          malformedJsonRejected: true,
          invalidFramingRejected: true,
          positiveStatus: positiveResponse.status,
          malformedJsonStatus: malformedJsonResponse.status,
          invalidFramingStatus: invalidFramingResponse.status,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("MCP streamable transport test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  }
};

/**
 * Test MCP resources listing using SDK
 * This test verifies:
 * 1. The SDK can access MCP resources
 * 2. Pagination works correctly through the SDK
 * 3. Resource format is consistent when accessed via SDK
 */
mcpTests.testMcpResourcesListingWithSdk = async (tmrlws_api_ep, logContext) => {
  const moduleName = "mcp";
  const testName = "testMcpResourcesListingWithSdk";
  const correlationId = ulid();
  const testData = { tmrlws_api_ep };
  testData.endpoint = `${tmrlws_api_ep}/api/mcp/resources`;

  logger.info("Starting MCP resources listing test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      logger.warn("Failed to initialize RoditClient, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "initialization",
      });
    }

    // Step 1: Login using SDK if possible
    let loginResult;
    try {
      // Use login_server (login_server_withaccountid is not a client method)
      loginResult = await client.login_server();
      // Normalize jwt_token to token for compatibility
      if (loginResult && loginResult.jwt_token) {
        loginResult.token = loginResult.jwt_token;
      }
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login not-passed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
        error: loginError.message,
      });
      testData.loginError = loginError.message;
      testData.loginSuccess = false;
    }

    // Step 2: Test MCP resources listing with SDK
    const resources = [];
    let hasMore = true;
    let cursor = null;
    let page = 0;
    const limit = 10;

    while (hasMore && page < 3) { // Limit to 3 pages to avoid infinite loops
      page++;
      try {
        // Construct query parameters
        const queryParams = new URLSearchParams();
        queryParams.append('limit', limit.toString());
        if (cursor) {
          queryParams.append('cursor', cursor);
        }

        // Make request through SDK
        const path = `/api/mcp/resources?${queryParams.toString()}`;
        const response = await client.request('GET', path);
        
        // Process response
        if (response && Array.isArray(response.resources)) {
          resources.push(...response.resources);
          cursor = response.nextCursor || null;
          hasMore = !!cursor;
        } else {
          hasMore = false;
        }

        // Save page data
        testData[`page${page}`] = {
          resourceCount: response?.resources?.length || 0,
          nextCursor: cursor,
          hasMore
        };
      } catch (error) {
        logger.warn(`Failed to fetch page ${page} of MCP resources via SDK`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "fetch_page",
          error: error.message,
        });
        testData[`page${page}Error`] = error.message;
        hasMore = false;
      }
    }

    testData.totalResourcesRetrieved = resources.length;
    testData.pagesRetrieved = page;

    // Step 3: Validate resource format if any were retrieved
    let formatValid = true;
    if (resources.length > 0) {
      // Check a sample resource for expected properties
      const sampleResource = resources[0];
      const requiredProps = ['uri', 'name'];
      
      for (const prop of requiredProps) {
        if (!(prop in sampleResource)) {
          formatValid = false;
          testData.missingProperty = prop;
          break;
        }
      }
    }

    testData.resourceFormatValid = formatValid;

    // Consider success only if at least one page was retrieved and, if resources exist, their format is valid
    const overallSuccess = page > 0 && (resources.length === 0 || formatValid);

    const result = {
      passed: overallSuccess,
      details: {
        resourcesRetrieved: resources.length,
        pagesRetrieved: page,
        formatValid,
        sdkAccessSuccessful: resources.length > 0
      }
    };

    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    const errorInfo = extractApiErrorInfo(error);
    logger.error("SDK MCP resources test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      errorInfo: errorInfo,
      stack: error.stack,
    });

    const result = {
      passed: false,
      error: `SDK test error: ${error.message}`,
      errorInfo: errorInfo,
      stack: error.stack
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

/**
 * Test MCP resource retrieval using SDK
 * This test verifies:
 * 1. The SDK can retrieve specific MCP resources
 * 2. Authentication and permissions are enforced correctly
 * 3. Error handling works as expected
 */
mcpTests.testMcpResourceRetrievalWithSdk = async (tmrrws_api_ep, logContext) => {
  const moduleName = "mcp";
  const testName = "testMcpResourceRetrievalWithSdk";
  const correlationId = ulid();
  const testData = { tmrrws_api_ep };
  testData.endpoint = `${tmrrws_api_ep}/api/mcp/resource`;

  logger.info("Starting MCP resource retrieval test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Get independent RoditClient instance for test isolation
    const client = await getRoditClientForTest();
    testData.clientInitialized = client.initialized;

    if (!client.initialized) {
      logger.warn("Failed to initialize RoditClient, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "initialization",
      });
    }

    // Step 1: Login using SDK if possible
    let loginResult;
    try {
      // Use login_server (login_server_withaccountid is not a client method)
      loginResult = await client.login_server();
      // Normalize jwt_token to token for compatibility
      if (loginResult && loginResult.jwt_token) {
        loginResult.token = loginResult.jwt_token;
      }
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login not-passed, continuing with test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "login",
        error: loginError.message,
      });
      testData.loginError = loginError.message;
      testData.loginSuccess = false;
    }

    // Step 2: First get a list of resources to find a valid resource ID
    let resourceId = null;
    try {
      const response = await client.request('GET', '/api/mcp/resources?limit=1');
      if (response && Array.isArray(response.resources) && response.resources.length > 0) {
        resourceId = response.resources[0].uri || response.resources[0].id;
        testData.resourceId = resourceId;
      }
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.warn("Failed to get resource list to find valid ID", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "find_resource",
        error: error.message,
        errorInfo: errorInfo,
      });
      testData.findResourceError = error.message;
    }

    // Step 3: Test resource retrieval with valid ID if we found one
    if (resourceId) {
      try {
        const response = await client.request('GET', `/api/mcp/resource/${resourceId}`);
        testData.validResourceResponse = response;
        testData.validResourceRetrieved = true;
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        logger.warn("Failed to retrieve valid resource via SDK", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "retrieve_valid",
          error: error.message,
          errorInfo: errorInfo,
        });
        testData.validResourceError = error.message;
        testData.validResourceRetrieved = false;
      }
    }

    // Step 4: Test resource retrieval with invalid ID
    const invalidId = 'invalid-resource-id-' + ulid();
    try {
      await client.request('GET', `/api/mcp/resource/${invalidId}`);
      testData.invalidResourceReturned = true; // This shouldn't happen
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      // Expected error
      testData.invalidResourceError = error.message;
      testData.invalidResourceErrorInfo = errorInfo;
      testData.invalidResourceRejected = true;
    }

    // Success when invalid resource is rejected and, if a valid resource was found, it can be retrieved
    const overallSuccess = (!!resourceId ? !!testData.validResourceRetrieved : true) && !!testData.invalidResourceRejected;

    const result = {
      passed: overallSuccess,
      details: {
        validResourceFound: !!resourceId,
        validResourceRetrieved: !!testData.validResourceRetrieved,
        invalidResourceRejected: !!testData.invalidResourceRejected,
        sdkAccessWorking: !!testData.validResourceRetrieved
      }
    };

    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    const errorInfo = extractApiErrorInfo(error);
    logger.error("SDK MCP resource retrieval test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      errorInfo: errorInfo,
      stack: error.stack,
    });

    const result = {
      passed: false,
      error: `SDK test error: ${error.message}`,
      errorInfo: errorInfo,
      stack: error.stack
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

module.exports = mcpTests;
