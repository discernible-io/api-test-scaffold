// idempotency-tests.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData } = require("./test-utils");

/**
 * Tests for idempotent operations
 */
const idempotencyTests = {
  /**
   * Test API handling of idempotent operations (repeated operations produce same result)
   */
  testIdempotentOperations: async (apiEndpoint) => {
    const moduleName = "idempotency";
    const testName = "testIdempotentOperations";
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
      // PART 1: Test idempotency of DELETE operation
      logger.info("Test phase: DELETE idempotency", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "delete_idempotency",
      });

      // Create a test item to delete
      const createResult = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          title: "Idempotency Test Item",
          content: "This item will be deleted multiple times",
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      if (!createResult.ok || !createResult.id) {
        const result = {
          success: false,
          error: "Failed to create item for idempotency testing",
          details: createResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const testItemId = createResult.id;
      testData.testItemId = testItemId;

      // Delete the item first time
      const firstDeleteResult = await fetch(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: testItemId,
          }),
        }
      )
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      testData.firstDeleteResult = firstDeleteResult;

      // Delete the same item again (second time)
      const secondDeleteResult = await fetch(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: testItemId,
          }),
        }
      )
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      testData.secondDeleteResult = secondDeleteResult;

      // Delete the same item yet again (third time)
      const thirdDeleteResult = await fetch(
        `${apiEndpoint}/api/cruda/destroy`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: testItemId,
          }),
        }
      )
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      testData.thirdDeleteResult = thirdDeleteResult;

      // Analyze delete idempotency - define what it means for DELETE to be idempotent
      const deleteIsIdempotentType1 =
        firstDeleteResult.ok && secondDeleteResult.ok && thirdDeleteResult.ok;

      const deleteIsIdempotentType2 =
        firstDeleteResult.ok &&
        (secondDeleteResult.ok || secondDeleteResult.status === 404) &&
        (thirdDeleteResult.ok || thirdDeleteResult.status === 404);

      const deleteIsIdempotent =
        deleteIsIdempotentType1 || deleteIsIdempotentType2;

      // Store the result in testData
      testData.deleteIsIdempotent = deleteIsIdempotent;
      testData.deleteIsIdempotentType1 = deleteIsIdempotentType1;
      testData.deleteIsIdempotentType2 = deleteIsIdempotentType2;

      // PART 2: Test idempotency of PUT operation (if supported)
      logger.info("Test phase: PUT idempotency", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "put_idempotency",
      });

      // Create a test item for PUT testing
      const putCreateResult = await fetch(`${apiEndpoint}/api/cruda/create`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({
          title: "PUT Idempotency Test Item",
          content: "This item will be updated with PUT multiple times",
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      if (!putCreateResult.ok || !putCreateResult.id) {
        logger.warn("Failed to create item for PUT idempotency testing", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "put_idempotency",
          error: putCreateResult.error,
        });

        testData.putTestSkipped = true;
      } else {
        const putTestItemId = putCreateResult.id;
        testData.putTestItemId = putTestItemId;

        // Try updating with PUT method (some APIs don't support PUT)
        // First PUT update
        const firstPutResult = await fetch(`${apiEndpoint}/api/cruda/update`, {
          method: "PUT", // Try PUT instead of POST
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: putTestItemId,
            title: "Updated with PUT",
            content: "This content should be the same after multiple PUTs",
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        testData.firstPutResult = firstPutResult;

        // If PUT is supported, try again
        if (firstPutResult.ok || firstPutResult.status !== 405) {
          // If not Method Not Allowed
          // Second PUT update with identical data
          const secondPutResult = await fetch(
            `${apiEndpoint}/api/cruda/update`,
            {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "X-Request-ID": ulid(),
              },
              body: JSON.stringify({
                id: putTestItemId,
                title: "Updated with PUT",
                content: "This content should be the same after multiple PUTs",
              }),
            }
          )
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
            .catch((error) => {
              return {
                error: `Network error: ${error.message}`,
                status: 0,
              };
            });

          testData.secondPutResult = secondPutResult;

          // Read item to verify state after multiple PUTs
          const putVerifyResult = await fetch(`${apiEndpoint}/api/cruda/read`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: putTestItemId,
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
            .catch((error) => {
              return {
                error: `Network error: ${error.message}`,
                status: 0,
              };
            });

          testData.putVerifyResult = putVerifyResult;

          // Clean up the PUT test item
          await fetch(`${apiEndpoint}/api/cruda/destroy`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: putTestItemId,
            }),
          }).catch(() => {
            // Ignore errors during cleanup
          });

          // Determine if PUT is idempotent
          const putIsIdempotent = firstPutResult.ok && secondPutResult.ok;

          testData.putIsIdempotent = putIsIdempotent;
          testData.putIsSupported = true;
        } else {
          // PUT method not supported
          testData.putIsSupported = false;
          logger.info("PUT method not supported by the API", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "put_idempotency",
            status: firstPutResult.status,
          });
        }
      }

      // PART 3: Test idempotency keys (if supported)
      logger.info("Test phase: Idempotency keys test", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "idempotency_keys",
      });

      // Many APIs support idempotency keys like "Idempotency-Key" or "X-Idempotency-Key" header
      const idempotencyKeyValue = ulid(); // Generate a unique idempotency key

      // First request with idempotency key
      const firstIdempKeyResult = await fetch(
        `${apiEndpoint}/api/cruda/create`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
            "Idempotency-Key": idempotencyKeyValue,
            "X-Idempotency-Key": idempotencyKeyValue, // Try both common formats
          },
          body: JSON.stringify({
            title: "Idempotency Key Test Item",
            content: "This item tests idempotency keys",
          }),
        }
      )
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
        .catch((error) => {
          return {
            error: `Network error: ${error.message}`,
            status: 0,
          };
        });

      testData.firstIdempKeyResult = firstIdempKeyResult;

      // If first request succeeded, try again with same idempotency key
      if (firstIdempKeyResult.ok && firstIdempKeyResult.id) {
        const idempKeyItemId = firstIdempKeyResult.id;
        testData.idempKeyItemId = idempKeyItemId;

        // Second request with same idempotency key (should return same result as first)
        const secondIdempKeyResult = await fetch(
          `${apiEndpoint}/api/cruda/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
              "Idempotency-Key": idempotencyKeyValue,
              "X-Idempotency-Key": idempotencyKeyValue,
            },
            body: JSON.stringify({
              title: "Idempotency Key Test Item",
              content: "This item tests idempotency keys",
            }),
          }
        )
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
          .catch((error) => {
            return {
              error: `Network error: ${error.message}`,
              status: 0,
            };
          });

        testData.secondIdempKeyResult = secondIdempKeyResult;

        // Check if we got the same ID back or a different one
        const gotSameId =
          secondIdempKeyResult.ok && secondIdempKeyResult.id === idempKeyItemId;

        // Or check if we got an error indicating the operation was already performed
        const gotIdempotencyError =
          !secondIdempKeyResult.ok &&
          (secondIdempKeyResult.status === 409 || // Conflict
            secondIdempKeyResult.status === 422 || // Unprocessable Entity
            (secondIdempKeyResult.data &&
              (secondIdempKeyResult.data.error === "DuplicateOperation" ||
                secondIdempKeyResult.data.message?.includes("idempotency"))));

        // Determine if idempotency keys are supported
        const idempotencyKeysSupported = gotSameId || gotIdempotencyError;
        testData.idempotencyKeysSupported = idempotencyKeysSupported;
        testData.gotSameId = gotSameId;
        testData.gotIdempotencyError = gotIdempotencyError;

        // Clean up the idempotency key test item
        await fetch(`${apiEndpoint}/api/cruda/destroy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: idempKeyItemId,
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
        deleteIsIdempotent: testData.deleteIsIdempotent,
        putIsSupported: testData.putIsSupported || false,
        putIsIdempotent: testData.putIsIdempotent || false,
        idempotencyKeysSupported: testData.idempotencyKeysSupported || false,
      });

      const result = {
        success: testData.deleteIsIdempotent, // At minimum, DELETE should be idempotent
        details: {
          delete: {
            isIdempotent: testData.deleteIsIdempotent,
            isIdempotentType1: testData.deleteIsIdempotentType1,
            isIdempotentType2: testData.deleteIsIdempotentType2,
            firstDeleteResult: {
              status: firstDeleteResult.status,
              success: firstDeleteResult.ok,
            },
            secondDeleteResult: {
              status: secondDeleteResult.status,
              success: secondDeleteResult.ok,
            },
            thirdDeleteResult: {
              status: thirdDeleteResult.status,
              success: thirdDeleteResult.ok,
            },
          },
          put: testData.putIsSupported
            ? {
                isSupported: true,
                isIdempotent: testData.putIsIdempotent,
                firstPutResult: {
                  status: testData.firstPutResult.status,
                  success: testData.firstPutResult.ok,
                },
                secondPutResult: {
                  status: testData.secondPutResult.status,
                  success: testData.secondPutResult.ok,
                },
              }
            : {
                isSupported: false,
              },
          idempotencyKeys: testData.idempotencyKeysSupported
            ? {
                isSupported: true,
                gotSameId: testData.gotSameId,
                gotIdempotencyError: testData.gotIdempotencyError,
                firstResult: {
                  id: testData.firstIdempKeyResult.id,
                  status: testData.firstIdempKeyResult.status,
                  success: testData.firstIdempKeyResult.ok,
                },
                secondResult: {
                  id: testData.secondIdempKeyResult?.id,
                  status: testData.secondIdempKeyResult?.status,
                  success: testData.secondIdempKeyResult?.ok,
                },
              }
            : {
                isSupported: false,
              },
        },
      };

      // Add direct logging here to ensure it appears in the logs (in addition to captureTestData)
      logger.debug(
        `Test '${testName}' passed for endpoint ${testData.endpoint}`,
        {
          component: "TestRunner",
          moduleName,
          testName,
          endpoint: testData.endpoint,
        }
      );

      logger.info(`Test passed : ${testName}`, {
        component: "TestRunner",
        moduleName,
        testName,
        details: {
          deleteIdempotent: testData.deleteIsIdempotent,
          putSupported: testData.putIsSupported || false,
          putIdempotent: testData.putIsIdempotent || false,
          idempotencyKeysSupported: testData.idempotencyKeysSupported || false,
        },
      });

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

      // Add direct error logging here to ensure it appears in the logs
      logger.error(
        `Test '${testName}' not-passed for endpoint ${testData.endpoint}`,
        {
          component: "TestRunner",
          moduleName,
          testName,
          endpoint: testData.endpoint,
          error: error.message,
        }
      );

      logger.error(`Test not-passed : ${testName}`, {
        component: "TestRunner",
        moduleName,
        testName,
        error: error.message,
        details: { stack: error.stack },
      });

      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = idempotencyTests;
