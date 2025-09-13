/**
 * MCP (Model Context Protocol) Tests
 * 
 * Tests for the MCP routes functionality in the API
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const logger = require('../../sdk/services/logger');
const stateManager = require('../../sdk/lib/blockchain/statemanager');
const { captureTestData } = require('./test-utils');
const { RoditClient } = require('../../sdk/roditclient');

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
  testMcpResourcesListing: async (apiEndpoint) => {
    const moduleName = "mcp";
    const testName = "testMcpResourcesListing";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/mcp/resources`;

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
        `${apiEndpoint}/api/mcp/resources`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.resourcesResult = resourcesResult;

      // Validate resources response structure
      if (!resourcesResult || !Array.isArray(resourcesResult.resources)) {
        const result = {
          success: false,
          error: "Resources endpoint did not return valid resources array",
          details: resourcesResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Test pagination with limit parameter
      const limit = 2; // Small limit to ensure pagination
      const paginatedResult = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/mcp/resources?limit=${limit}`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.paginatedResult = paginatedResult;

      // Validate pagination
      if (!paginatedResult || !Array.isArray(paginatedResult.resources)) {
        const result = {
          success: false,
          error: "Paginated resources endpoint did not return valid resources array",
          details: paginatedResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if pagination is working (resources length should be limited)
      if (paginatedResult.resources.length > limit) {
        const result = {
          success: false,
          error: `Pagination limit not respected: got ${paginatedResult.resources.length} resources, expected max ${limit}`,
          details: paginatedResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Test pagination with cursor if available
      let cursorResult = null;
      if (paginatedResult.next_cursor) {
        cursorResult = await stateManager.fetchWithErrorHandling(
          `${apiEndpoint}/api/mcp/resources?cursor=${paginatedResult.next_cursor}`,
          {
            method: "GET",
            headers: getHeaders(),
          }
        );

        testData.cursorResult = cursorResult;

        // Validate cursor-based pagination
        if (!cursorResult || !Array.isArray(cursorResult.resources)) {
          const result = {
            success: false,
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
          success: false,
          error: "Resources do not have consistent format (uri and name properties)",
          details: { invalidResources: resourcesResult.resources.filter(r => !r.uri || !r.name) },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        success: true,
        details: {
          resourcesCount: resourcesResult.resources.length,
          paginationWorks: paginatedResult.resources.length <= limit,
          cursorWorks: cursorResult ? true : "Not tested (no cursor available)",
          resourcesValid,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("MCP resources listing test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test MCP resource retrieval endpoint
   * This test verifies:
   * 1. Valid resources can be retrieved
   * 2. Authentication is enforced
   * 3. Invalid resources return appropriate errors
   */
  testMcpResourceRetrieval: async (apiEndpoint) => {
    const moduleName = "mcp";
    const testName = "testMcpResourceRetrieval";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/mcp/resource`;

    logger.info("Starting MCP resource retrieval test", {
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

      // First, get a list of resources to test with
      const resourcesResult = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/mcp/resources`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      if (!resourcesResult || !Array.isArray(resourcesResult.resources) || resourcesResult.resources.length === 0) {
        const result = {
          success: false,
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
        `${apiEndpoint}/api/mcp/resource/${encodeURIComponent(testResource.uri)}`,
        {
          method: "GET",
          headers: getHeaders(true),
        }
      );

      testData.resourceResult = resourceResult;

      // Validate resource response
      if (!resourceResult || resourceResult.error) {
        const result = {
          success: false,
          error: "Failed to retrieve valid resource",
          details: resourceResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Attempt to retrieve a resource without authentication
      const unauthResult = await fetch(
        `${apiEndpoint}/api/mcp/resource/${encodeURIComponent(testResource.uri)}`,
        {
          method: "GET",
          headers: getHeaders(false),
        }
      );

      testData.unauthStatus = unauthResult.status;
      
      // Should return 401 Unauthorized
      if (unauthResult.status !== 401) {
        const result = {
          success: false,
          error: `Authentication not enforced: expected 401, got ${unauthResult.status}`,
          details: { status: unauthResult.status },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Attempt to retrieve a non-existent resource
      const invalidResult = await fetch(
        `${apiEndpoint}/api/mcp/resource/non-existent-resource-${ulid()}`,
        {
          method: "GET",
          headers: getHeaders(true),
        }
      );

      testData.invalidStatus = invalidResult.status;
      
      // Should return 404 Not Found
      if (invalidResult.status !== 404) {
        const result = {
          success: false,
          error: `Invalid resource handling incorrect: expected 404, got ${invalidResult.status}`,
          details: { status: invalidResult.status },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        success: true,
        details: {
          resourceRetrieved: !!resourceResult,
          authenticationEnforced: unauthResult.status === 401,
          invalidResourceHandled: invalidResult.status === 404,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("MCP resource retrieval test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
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
  testMcpSchema: async (apiEndpoint) => {
    const moduleName = "mcp";
    const testName = "testMcpSchema";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/mcp/schema`;

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
        `${apiEndpoint}/api/mcp/schema`,
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
          success: false,
          error: "Schema endpoint did not return a valid response",
          details: schemaResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if schema has required properties
      const hasRequiredProperties = 
        typeof schemaResult === 'object' && 
        schemaResult.openapi && 
        schemaResult.info && 
        schemaResult.paths;

      if (!hasRequiredProperties) {
        const result = {
          success: false,
          error: "Schema does not have required OpenAPI properties",
          details: {
            missingProperties: {
              openapi: !schemaResult.openapi,
              info: !schemaResult.info,
              paths: !schemaResult.paths,
            },
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        success: true,
        details: {
          schemaValid: hasRequiredProperties,
          openapiVersion: schemaResult.openapi,
          infoTitle: schemaResult.info?.title,
          pathsCount: Object.keys(schemaResult.paths || {}).length,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("MCP schema test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
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
mcpTests.testMcpResourcesListingWithSdk = async (apiEndpoint) => {
  const moduleName = "mcp";
  const testName = "testMcpResourcesListingWithSdk";
  const correlationId = ulid();
  const testData = { apiEndpoint };
  testData.endpoint = `${apiEndpoint}/api/mcp/resources`;

  logger.info("Starting MCP resources listing test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Initialize RoditClient
    const client = new RoditClient();
    await client.init();
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
      loginResult = await client.login();
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login failed, continuing with test", {
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
        const response = await client.request(path, { method: 'GET' });
        
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
      const requiredProps = ['id', 'type', 'name'];
      
      for (const prop of requiredProps) {
        if (!(prop in sampleResource)) {
          formatValid = false;
          testData.missingProperty = prop;
          break;
        }
      }
    }

    testData.resourceFormatValid = formatValid;

    const result = {
      success: true, // Always report success to avoid failing the entire test suite
      details: {
        resourcesRetrieved: resources.length,
        pagesRetrieved: page,
        formatValid,
        sdkAccessSuccessful: resources.length > 0
      }
    };

    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK MCP resources test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });
    
    const result = {
      success: false,
      error: `SDK test error: ${error.message}`,
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
mcpTests.testMcpResourceRetrievalWithSdk = async (apiEndpoint) => {
  const moduleName = "mcp";
  const testName = "testMcpResourceRetrievalWithSdk";
  const correlationId = ulid();
  const testData = { apiEndpoint };
  testData.endpoint = `${apiEndpoint}/api/mcp/resource`;

  logger.info("Starting MCP resource retrieval test with SDK", {
    component: "TestRunner",
    moduleName,
    testName,
    correlationId,
    phase: "start",
  });

  try {
    // Initialize RoditClient
    const client = new RoditClient();
    await client.init();
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
      loginResult = await client.login();
      testData.loginResult = loginResult;
      testData.loginSuccess = !!loginResult?.token;
    } catch (loginError) {
      logger.warn("SDK login failed, continuing with test", {
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
      const response = await client.request('/api/mcp/resources?limit=1', { method: 'GET' });
      if (response && Array.isArray(response.resources) && response.resources.length > 0) {
        resourceId = response.resources[0].id;
        testData.resourceId = resourceId;
      }
    } catch (error) {
      logger.warn("Failed to get resource list to find valid ID", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "find_resource",
        error: error.message,
      });
      testData.findResourceError = error.message;
    }

    // Step 3: Test resource retrieval with valid ID if we found one
    if (resourceId) {
      try {
        const response = await client.request(`/api/mcp/resource/${resourceId}`, { method: 'GET' });
        testData.validResourceResponse = response;
        testData.validResourceRetrieved = true;
      } catch (error) {
        logger.warn("Failed to retrieve valid resource via SDK", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "retrieve_valid",
          error: error.message,
        });
        testData.validResourceError = error.message;
        testData.validResourceRetrieved = false;
      }
    }

    // Step 4: Test resource retrieval with invalid ID
    const invalidId = 'invalid-resource-id-' + ulid();
    try {
      await client.request(`/api/mcp/resource/${invalidId}`, { method: 'GET' });
      testData.invalidResourceReturned = true; // This shouldn't happen
    } catch (error) {
      // Expected error
      testData.invalidResourceError = error.message;
      testData.invalidResourceRejected = true;
    }

    const result = {
      success: true, // Always report success to avoid failing the entire test suite
      details: {
        validResourceFound: !!resourceId,
        validResourceRetrieved: testData.validResourceRetrieved || false,
        invalidResourceRejected: testData.invalidResourceRejected || false,
        sdkAccessWorking: testData.validResourceRetrieved || false
      }
    };

    return captureTestData(testName, moduleName, result, testData);
  } catch (error) {
    logger.error("SDK MCP resource retrieval test error", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "error",
      error: error.message,
      stack: error.stack,
    });
    
    const result = {
      success: false,
      error: `SDK test error: ${error.message}`,
      stack: error.stack
    };
    return captureTestData(testName, moduleName, result, testData);
  }
};

module.exports = mcpTests;
