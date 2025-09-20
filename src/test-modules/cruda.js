// cruda-operations.js - Consolidated version

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager, RoditClient } = require('../../sdk');
// Import the centralized test fetch utility
const { testFetchWithErrorHandling } = require('../../sdk/services/utils');

const { captureTestData } = require("./test-utils");

/**
 * Consolidated CRUDA Operations Test Module
 */
const crudaTests = {
  /**
   * Comprehensive CRUDA operations test that covers basic functionality,
   * authentication, permissions, and performance aspects
   */
  testCrudaFullOperations: async (tco2_api_ep) => {
    const moduleName = "cruda";
    const testName = "testCrudaFullOperations";
    const correlationId = ulid();
    const testData = { tco2_api_ep };
    testData.endpoint = `${tco2_api_ep}/api/cruda`;

    // Log test start
    logger.info("Starting comprehensive CRUDA operations test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    const token = await stateManager.getJwtToken();
    testData.hasToken = !!token;
    
    // Enhanced logging for token debugging
    logger.debug("CRUDA test token check", {
      component: "CRUDATest",
      hasToken: !!token,
      tokenType: typeof token,
      tokenLength: token ? token.length : 0,
      tokenStart: token ? token.substring(0, 30) + '...' : 'null/undefined'
    });

    try {
      // Function to create headers with or without tokens
      const getHeaders = async (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };
        
        if (includeToken) {
          const jwt_token = await stateManager.getJwtToken();
          logger.debug("Token retrieval for CRUDA test", {
            component: "CRUDATest",
            hasToken: !!jwt_token,
            tokenLength: jwt_token ? jwt_token.length : 0,
            tokenStart: jwt_token ? jwt_token.substring(0, 20) + '...' : 'null'
          });
          
          if (jwt_token) {
            headers.Authorization = `Bearer ${jwt_token}`;
            logger.debug("Authorization header set", {
              component: "CRUDATest",
              authHeaderSet: true,
              authHeaderLength: headers.Authorization.length
            });
          } else {
            logger.warn("No JWT token available for CRUDA test", {
              component: "CRUDATest",
              includeToken,
              tokenValue: jwt_token
            });
          }
        }
        
        return headers;
      };

      // PART 1: Authentication Testing - Try with and without token
      logger.info("Test phase: Authentication check", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_check",
      });

      // Check operation without token
      const noTokenListResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/list`,
        {
          method: "POST",
          headers: await getHeaders(false),
          body: JSON.stringify({}),
        }
      );

      testData.noTokenListResult = noTokenListResult;
      const requiresAuth = !!noTokenListResult.error;

      // PART 2: Basic CRUD Operations
      logger.info("Test phase: Basic CRUD operations", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "basic_crud",
      });

      // Use for detailed timing of operations
      const operationTimings = {};
      
      // CREATE operation
      const startCreateTime = Date.now();
      const createResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/create`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({
            comment: "Comprehensive Test Item",
            content: "This is a test item for comprehensive CRUDA tests",
          }),
        }
      );
      operationTimings.create = Date.now() - startCreateTime;

      testData.createResult = createResult;
      if (createResult.error) {
        const result = {
          success: false,
          error: `Create operation failed: ${createResult.error}`,
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const itemId = createResult.id;
      testData.itemId = itemId;

      // READ operation
      const startReadTime = Date.now();
      const readResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/read`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({ id: itemId }),
        }
      );
      operationTimings.read = Date.now() - startReadTime;

      testData.readResult = readResult;
      if (readResult.error) {
        const result = {
          success: false,
          error: `Read operation failed: ${readResult.error}`,
          details: readResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // UPDATE operation
      const startUpdateTime = Date.now();
      const updateResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/update`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({
            id: itemId,
            comment: "Updated Test Item",
            content: "This item has been updated during the comprehensive test",
          }),
        }
      );
      operationTimings.update = Date.now() - startUpdateTime;

      testData.updateResult = updateResult;
      if (updateResult.error) {
        const result = {
          success: false,
          error: `Update operation failed: ${updateResult.error}`,
          details: updateResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // LIST operation
      const startListTime = Date.now();
      const listResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/list`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({}),
        }
      );
      operationTimings.list = Date.now() - startListTime;

      testData.listResult = listResult;
      if (listResult.error) {
        const result = {
          success: false,
          error: `List operation failed: ${listResult.error}`,
          details: listResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check if our item is in the list
      const foundInList = listResult.comments && 
        listResult.comments.some(item => item.id === itemId);
      testData.foundInList = foundInList;

      // DELETE operation
      const startDeleteTime = Date.now();
      const deleteResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/destroy`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({ id: itemId }),
        }
      );
      operationTimings.delete = Date.now() - startDeleteTime;

      testData.deleteResult = deleteResult;
      if (deleteResult.error) {
        const result = {
          success: false,
          error: `Delete operation failed: ${deleteResult.error}`,
          details: deleteResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Verify deletion
      const verifyListResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/list`,
        {
          method: "POST",
          headers: await getHeaders(),
          body: JSON.stringify({}),
        }
      );

      // Check if item is still in the list
      const stillInList = verifyListResult.comments && 
        verifyListResult.comments.some(item => item.id === itemId);
      testData.stillInList = stillInList;

      // PART 3: Alternative Methods Testing
      logger.info("Test phase: HTTP methods testing", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "method_tests",
      });

      // Test alternative HTTP methods
      const methodResults = {};
      
      // Test GET method
      const getResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/list`,
        {
          method: "GET",
          headers: await getHeaders(),
        }
      );
      methodResults.GET = {
        status: getResult.statusCode || 0,
        success: !getResult.error,
        error: getResult.error
      };

      // Test PUT method
      const putResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/update`,
        {
          method: "PUT",
          headers: await getHeaders(),
          body: JSON.stringify({
            id: "test-id", // Use a dummy ID since our item was deleted
            comment: "PUT Test",
            content: "Testing PUT method",
          }),
        }
      );
      methodResults.PUT = {
        status: putResult.statusCode || 0,
        success: !putResult.error,
        error: putResult.error
      };

      // Test DELETE method (direct method)
      const deleteMethodResult = await testFetchWithErrorHandling(
        `${tco2_api_ep}/api/cruda/destroy`,
        {
          method: "DELETE",
          headers: await getHeaders(),
          body: JSON.stringify({ id: "test-id" }), // Use a dummy ID
        }
      );
      methodResults.DELETE = {
        status: deleteMethodResult.statusCode || 0,
        success: !deleteMethodResult.error,
        error: deleteMethodResult.error
      };

      testData.methodResults = methodResults;
      
      // Determine which HTTP methods are supported
      const supportedMethods = Object.entries(methodResults)
        .filter(([_, result]) => result.success)
        .map(([method, _]) => method);
      
      testData.supportedMethods = supportedMethods;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        requiresAuth,
        foundInList,
        deletedSuccessfully: !stillInList,
        supportedMethods,
      });

      const result = {
        success: (!stillInList) && foundInList, // Basic success criteria
        details: {
          authentication: {
            requiresAuth,
            authTested: true,
          },
          operations: {
            createSuccessful: !createResult.error,
            readSuccessful: !readResult.error,
            updateSuccessful: !updateResult.error,
            listSuccessful: !listResult.error,
            deleteSuccessful: !deleteResult.error,
            itemId,
            foundInList,
            itemDeletedProperly: !stillInList,
          },
          performance: {
            timings: operationTimings,
          },
          methods: {
            supportedMethods,
            methodResults,
          }
        },
      };

      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Test exception", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };

      return captureTestData(testName, moduleName, result, testData);
    }
  }
};

module.exports = crudaTests;