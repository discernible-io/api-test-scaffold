// concurrency-tests.js

const { ulid } = require("ulid");
const logger = require("../../config/logger");
const stateManager = require("../blockchain/statemanager");

const { captureTestData } = require("./test-utils");

/**
 * Tests for concurrency issues and race conditions
 */
const concurrencyTests = {
  /**
   * Test API handling of concurrent requests and potential race conditions
   */
  testConcurrentOperations: async (apiEndpoint) => {
    const moduleName = "concurrency";
    const testName = "testConcurrentOperations";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/cruda`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      apiEndpoint: testData.endpoint,
      startTime: new Date().toISOString(),
    });

    const token = await stateManager.getJwtToken();
    if (!token) {
      const result = {
        success: false,
        error: "No JWT token available for testing",
      };
      return captureTestData(testName, moduleName, result, testData);
    }

    testData.token = token;

    try {
      // PART 1: Concurrent creation of items with similar content
      logger.info("Test phase: Concurrent creation", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_creation",
      });

      const numConcurrentCreations = 5;
      const creationPromises = [];
      
      for (let i = 0; i < numConcurrentCreations; i++) {
        creationPromises.push(
          fetch(`${apiEndpoint}/api/cruda/create`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              title: `Concurrent Creation Test ${i+1}`,
              content: `This is a test item created concurrently ${i+1}`,
            }),
          })
          .then(async (response) => {
            try {
              const data = await response.json();
              return {
                index: i,
                id: data.id,
                status: response.status,
                ok: response.ok,
                data,
                error: !response.ok ? `HTTP error: ${response.status}` : null,
              };
            } catch (e) {
              return {
                index: i,
                status: response.status,
                ok: response.ok,
                error: `Failed to parse response: ${e.message}`,
              };
            }
          })
          .catch(error => {
            return {
              index: i,
              error: `Network error: ${error.message}`,
              status: 0,
            };
          })
        );
      }

      // Wait for all creation operations to complete
      const creationResults = await Promise.all(creationPromises);
      
      // Extract item IDs for later use
      const createdItemIds = creationResults
        .filter(result => result.ok && result.id)
        .map(result => result.id);
      
      testData.createdItemIds = createdItemIds;
      testData.creationResults = creationResults;

      // Check if all creations succeeded
      const allCreationsSucceeded = creationResults.every(result => result.ok);

    // PART 2: Concurrent updates to the same item
    logger.info("Test phase: Concurrent updates", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_updates",
      });

      // Create a new item for update testing
      const updateTestItem = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          title: "Concurrent Update Test Item",
          content: "This item will be updated concurrently",
        }),
      })
      .then(async (response) => {
        try {
          const data = await response.json();
          return {
            id: data.id,
            status: response.status,
            ok: response.ok,
            data,
            error: !response.ok ? `HTTP error: ${response.status}` : null,
          };
        } catch (e) {
          return {
            status: response.status,
            ok: response.ok,
            error: `Failed to parse response: ${e.message}`,
          };
        }
      })
      .catch(error => {
        return {
          error: `Network error: ${error.message}`,
          status: 0,
        };
      });

      if (!updateTestItem.ok || !updateTestItem.id) {
        const result = {
          success: false,
          error: "Failed to create item for concurrent update testing",
          details: updateTestItem,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.updateTestItemId = updateTestItem.id;

      // Perform concurrent updates to the same item
      const numConcurrentUpdates = 5;
      const updatePromises = [];

      for (let i = 0; i < numConcurrentUpdates; i++) {
        updatePromises.push(
          fetch(`${apiEndpoint}/api/cruda/update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: updateTestItem.id,
              title: `Concurrent Update ${i+1}`,
              content: `This item was updated concurrently by update ${i+1} at ${new Date().toISOString()}`,
            }),
          })
          .then(async (response) => {
            try {
              const data = await response.json();
              return {
                index: i,
                status: response.status,
                ok: response.ok,
                data,
                error: !response.ok ? `HTTP error: ${response.status}` : null,
              };
            } catch (e) {
              return {
                index: i,
                status: response.status,
                ok: response.ok,
                error: `Failed to parse response: ${e.message}`,
              };
            }
          })
          .catch(error => {
            return {
              index: i,
              error: `Network error: ${error.message}`,
              status: 0,
            };
          })
        );
      }

      // Wait for all update operations to complete
      const updateResults = await Promise.all(updatePromises);
      testData.updateResults = updateResults;

      // Check if all updates succeeded
      const allUpdatesSucceeded = updateResults.every(result => result.ok);

      // Read the final state of the item to see which update "won"
      const finalState = await fetch(`${apiEndpoint}/api/cruda/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          id: updateTestItem.id,
        }),
      })
      .then(async (response) => {
        try {
          const data = await response.json();
          return {
            status: response.status,
            ok: response.ok,
            data,
            error: !response.ok ? `HTTP error: ${response.status}` : null,
          };
        } catch (e) {
          return {
            status: response.status,
            ok: response.ok,
            error: `Failed to parse response: ${e.message}`,
          };
        }
      })
      .catch(error => {
        return {
          error: `Network error: ${error.message}`,
          status: 0,
        };
      });

      testData.finalState = finalState;

      // PART 3: Concurrent deletion testing
      logger.info("Test phase: Concurrent deletion", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_deletion",
      });

      // Create a new item for deletion testing
      const deletionTestItem = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          title: "Concurrent Deletion Test Item",
          content: "This item will be deleted concurrently",
        }),
      })
      .then(async (response) => {
        try {
          const data = await response.json();
          return {
            id: data.id,
            status: response.status,
            ok: response.ok,
            data,
            error: !response.ok ? `HTTP error: ${response.status}` : null,
          };
        } catch (e) {
          return {
            status: response.status,
            ok: response.ok,
            error: `Failed to parse response: ${e.message}`,
          };
        }
      })
      .catch(error => {
        return {
          error: `Network error: ${error.message}`,
          status: 0,
        };
      });

      if (!deletionTestItem.ok || !deletionTestItem.id) {
        const result = {
          success: false,
          error: "Failed to create item for concurrent deletion testing",
          details: deletionTestItem,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      testData.deletionTestItemId = deletionTestItem.id;

      // Perform concurrent deletions of the same item
      const numConcurrentDeletions = 3;
      const deletionPromises = [];

      for (let i = 0; i < numConcurrentDeletions; i++) {
        deletionPromises.push(
          fetch(`${apiEndpoint}/api/cruda/destroy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: deletionTestItem.id,
            }),
          })
          .then(async (response) => {
            try {
              const data = await response.json();
              return {
                index: i,
                status: response.status,
                ok: response.ok,
                data,
                error: !response.ok ? `HTTP error: ${response.status}` : null,
              };
            } catch (e) {
              return {
                index: i,
                status: response.status,
                ok: response.ok,
                error: `Failed to parse response: ${e.message}`,
              };
            }
          })
          .catch(error => {
            return {
              index: i,
              error: `Network error: ${error.message}`,
              status: 0,
            };
          })
        );
      }

      // Wait for all deletion operations to complete
      const deletionResults = await Promise.all(deletionPromises);
      testData.deletionResults = deletionResults;

      // Check the results of deletion operations
      const firstDeletionSucceeded = deletionResults[0].ok;
      const subsequentDeletionsExpectedBehavior = deletionResults.slice(1).every(result => 
        // Either it succeeded (idempotent delete) or failed with appropriate error
        result.ok || 
        result.status === 404 || 
        (result.data && (
          result.data.error === 'NotFound' || 
          result.data.message?.includes('not found')
        ))
      );

      // Try to read the deleted item to confirm deletion
      const verifyDeletion = await fetch(`${apiEndpoint}/api/cruda/read`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          id: deletionTestItem.id,
        }),
      })
      .then(async (response) => {
        try {
          const data = await response.json();
          return {
            status: response.status,
            ok: response.ok,
            data,
            error: !response.ok ? `HTTP error: ${response.status}` : null,
          };
        } catch (e) {
          return {
            status: response.status,
            ok: response.ok,
            error: `Failed to parse response: ${e.message}`,
          };
        }
      })
      .catch(error => {
        return {
          error: `Network error: ${error.message}`,
          status: 0,
        };
      });

      // Item should be deleted, so read should fail with a 404
      const verifyDeletionCorrect = !verifyDeletion.ok && 
        (verifyDeletion.status === 404 || 
         (verifyDeletion.data && (
           verifyDeletion.data.error === 'NotFound' || 
           verifyDeletion.data.message?.includes('not found')
         ))
        );

      testData.verifyDeletion = verifyDeletion;
      testData.verifyDeletionCorrect = verifyDeletionCorrect;

      // Clean up all created items (except those already deleted)
      logger.info("Test cleanup: Deleting remaining test items", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "cleanup",
      });

      const itemsToDelete = [...createdItemIds, updateTestItem.id];
      
      for (const id of itemsToDelete) {
        await fetch(`${apiEndpoint}/api/cruda/destroy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: id,
          }),
        }).catch(() => {
          // Ignore errors during cleanup
        });
      }

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allCreationsSucceeded,
        allUpdatesSucceeded,
        firstDeletionSucceeded,
        subsequentDeletionsExpectedBehavior,
        verifyDeletionCorrect,
      });

      const result = {
        success: allCreationsSucceeded && 
                allUpdatesSucceeded && 
                firstDeletionSucceeded && 
                subsequentDeletionsExpectedBehavior &&
                verifyDeletionCorrect,
        error: !allCreationsSucceeded ? 
          "Some concurrent creation operations failed" : 
          !allUpdatesSucceeded ? 
            "Some concurrent update operations failed" :
            !firstDeletionSucceeded ?
              "Initial deletion operation failed" :
              !subsequentDeletionsExpectedBehavior ?
                "Subsequent deletion operations did not behave as expected" :
                !verifyDeletionCorrect ?
                  "Deleted item was still accessible" :
                  null,
        details: {
          creation: {
            allCreationsSucceeded,
            creationResults,
            createdItemIds,
          },
          update: {
            allUpdatesSucceeded,
            updateResults,
            finalState: finalState.data,
            // Analyze which update "won"
            finalUpdateIndex: finalState.ok && finalState.data ? 
              updateResults.findIndex(r => 
                finalState.data.title === `Concurrent Update ${r.index+1}` ||
                finalState.data.comment?.title === `Concurrent Update ${r.index+1}`
              ) : -1,
          },
          deletion: {
            firstDeletionSucceeded,
            subsequentDeletionsExpectedBehavior,
            deletionResults,
            verifyDeletionCorrect,
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

module.exports = concurrencyTests;