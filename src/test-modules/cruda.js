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
  testCrudaFullOperations: async (tco2_api_ep, logContext) => {
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

    const startTime = Date.now();
    
    // Get the shared RoditClient instance from app.locals
    const roditClient = logContext?.app?.locals?.roditClient;
    if (!roditClient) {
      throw new Error("RoditClient not available - server not properly initialized");
    }

    // Authenticate using SDK facilities
    try {
      const loginResult = await roditClient.login_server();
      testData.hasToken = !!loginResult?.jwt_token;
      
      logger.debug("Authentication completed using SDK", {
        component: "CRUDATest",
        hasToken: testData.hasToken,
        loginSuccess: !!loginResult
      });
    } catch (error) {
      logger.warn("Failed to authenticate for CRUDA test", {
        component: "CRUDATest",
        error: error.message
      });
      testData.hasToken = false;
    }

    try {

      // PART 1: Authentication Testing - Try with and without token
      logger.info("Test phase: Authentication check", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "auth_check",
      });

      // Check operation without token (create temporary client without auth)
      const { RoditClient } = require('../../sdk');
      const unauthenticatedClient = new RoditClient();
      await unauthenticatedClient.init();
      
      const noTokenListResult = await unauthenticatedClient.request(
        "POST",
        "/api/cruda/list",
        {}
      ).catch(error => ({ error: error.message }));

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
      
      // CREATE operation using SDK
      const startCreateTime = Date.now();
      const createResult = await roditClient.request(
        "POST",
        "/api/cruda/create",
        {
          comment: "Comprehensive Test Item",
          content: "This is a test item for comprehensive CRUDA tests",
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

      // READ operation using SDK
      const startReadTime = Date.now();
      const readResult = await roditClient.request(
        "POST",
        "/api/cruda/read",
        { id: itemId }
      );
      operationTimings.read = Date.now() - startReadTime;

      testData.readResult = readResult;
      if (readResult.error) {
        const result = {
          success: false,
          details: readResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // UPDATE operation using SDK
      const startUpdateTime = Date.now();
      const updateResult = await roditClient.request(
        "POST",
        "/api/cruda/update",
        {
          id: itemId,
          comment: "Updated Test Item",
          content: "This content has been updated",
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

      // LIST operation using SDK
      const startListTime = Date.now();
      const listResult = await roditClient.request(
        "POST",
        "/api/cruda/list",
        {}
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

      // DELETE operation using SDK
      const startDeleteTime = Date.now();
      const deleteResult = await roditClient.request(
        "POST",
        "/api/cruda/destroy",
        { id: itemId }
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
      const verifyListResult = await roditClient.request(
        "POST",
        "/api/cruda/list",
        {}
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
      
      // Test GET method using SDK
      const getResult = await roditClient.request(
        "GET",
        "/api/cruda/list"
      );
      methodResults.GET = {
        status: getResult.statusCode || 0,
        success: !getResult.error,
        error: getResult.error
      };

      // Test PUT method using SDK
      const putResult = await roditClient.request(
        "PUT",
        "/api/cruda/update",
        {
          id: "test-id", // Use a dummy ID since our item was deleted
          comment: "PUT Test",
          content: "Testing PUT method",
        }
      );
      methodResults.PUT = {
        status: putResult.statusCode || 0,
        success: !putResult.error,
        error: putResult.error
      };

      // Test DELETE method using SDK
      const deleteMethodResult = await roditClient.request(
        "DELETE",
        "/api/cruda/destroy",
        { id: "test-id" } // Use a dummy ID
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