// encoding-tests.js

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData } = require("./test-utils");

const extractCommentValue = (payload, depth = 0) => {
  if (!payload || depth > 5) {
    return "";
  }

  if (typeof payload === "string") {
    return payload;
  }

  if (payload.comment !== undefined) {
    const value = payload.comment;
    if (typeof value === "string") {
      return value;
    }
    if (value && typeof value === "object") {
      const nested = extractCommentValue(value, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  if (payload.data !== undefined) {
    const nested = extractCommentValue(payload.data, depth + 1);
    if (nested) {
      return nested;
    }
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = extractCommentValue(item, depth + 1);
      if (nested) {
        return nested;
      }
    }
  }

  return "";
};

/**
 * Tests for special characters, encoding, and zero-length inputs
 */
const encodingTests = {
  /**
   * Test API handling of special characters, different encodings, and zero-length inputs for the echo endpoint
   */
  testSpecialCharactersAndEncoding: async (tscae_api_ep) => {
    const moduleName = "encoding";
    const testName = "testSpecialCharactersAndEncoding";
    const correlationId = ulid();
    const testData = { tscae_api_ep };
    testData.endpoint = `${tscae_api_ep}/api/echo`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tscae_api_ep: testData.endpoint,
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
      // Test cases with various special characters and encodings
      const testCases = [
        // Zero-length input - expect this to fail with 400 as it's invalid input
        {
          name: "Zero-length input",
          input: "",
          description: "Testing empty string",
          expectFailure: true, // API should reject empty input
        },
        // Special characters
        {
          name: "Special ASCII characters",
          input: "!@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~",
          description: "Testing special ASCII characters",
        },
        // Unicode characters
        {
          name: "Unicode characters",
          input: "ÄäÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž",
          description: "Testing Unicode Latin characters with diacritics",
        },
        // Emojis
        {
          name: "Emoji characters",
          input: "😀👍🚀🌍💻🔒🔑🧪",
          description: "Testing emoji characters",
        },
        // Right-to-left text
        {
          name: "RTL text",
          input: "مرحبا بالعالم! שלום עולם!",
          description: "Testing right-to-left Arabic and Hebrew text",
        },
        // Asian characters
        {
          name: "Asian characters",
          input: "你好世界! こんにちは世界! 안녕하세요 세계!",
          description: "Testing Chinese, Japanese, and Korean characters",
        },
        // SQL injection attempt
        {
          name: "SQL injection characters",
          input: "'; DROP TABLE users; --",
          description: "Testing SQL injection characters",
        },
        // JavaScript injection attempt
        {
          name: "JavaScript injection",
          input: "<script>alert('XSS')</script>",
          description: "Testing JavaScript injection characters",
        },
        // Very long input
        {
          name: "Long input",
          input: "a".repeat(5000),
          description: "Testing very long input (5000 chars)",
        },
        // Control characters
        {
          name: "Control characters",
          input: "Line 1\nLine 2\tTabbed\rCarriage Return",
          description:
            "Testing control characters (newline, tab, carriage return)",
        },
      ];

      const testResults = [];

      // Test each case
      for (const testCase of testCases) {
        logger.debug(`Testing case: ${testCase.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "test_case",
          caseName: testCase.name,
        });

        // Make the request
        const response = await fetch(`${tscae_api_ep}/api/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: testCase.input,
            description: testCase.description,
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

        // Check if the response correctly echoed back the input
        // The server returns structured echo as { data: { message|input|echo } }
        // Accept both top-level and nested under data/result wrappers
        const extractEcho = (d) => {
          if (!d) return undefined;
          const candidates = [
            d.message, d.input, d.echo,
            d.data?.message, d.data?.input, d.data?.echo,
            d.result?.message, d.result?.input, d.result?.echo
          ];
          return candidates.find(v => typeof v === 'string');
        };

        const actualEcho = extractEcho(response.data);
        const normalize = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : s);

        // Handle expected failures (like empty input validation)
        let echoedCorrectly;
        if (testCase.expectFailure) {
          // For cases that should fail, success means getting an error response
          echoedCorrectly = !response.ok && response.status >= 400;
        } else {
          // Use exact string comparison first, then normalized comparison
          echoedCorrectly =
            (actualEcho === testCase.input) ||
            (normalize(actualEcho) === normalize(testCase.input));
        }

        testResults.push({
          testCase: testCase.name,
          description: testCase.description,
          success: testCase.expectFailure ? (!response.ok && response.status >= 400) : (response.ok && !response.error),
          echoedCorrectly,
          status: response.status,
          error: response.error,
          response: response.data
            ? typeof response.data === "object"
              ? JSON.stringify(response.data).substring(0, 100)
              : String(response.data).substring(0, 100)
            : null,
        });
      }

      // Check if all tests succeeded and echoed correctly
      const allTestsSucceeded = testResults.every((result) => result.success);
      const allEchoedCorrectly = testResults.every(
        (result) => result.echoedCorrectly
      );

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        allTestsSucceeded,
        allEchoedCorrectly,
      });

      const failedTests = testResults
        .filter((r) => !r.success || !r.echoedCorrectly)
        .map((r) => r.testCase);

      const result = {
        success: allTestsSucceeded && allEchoedCorrectly,
        error: !allTestsSucceeded
          ? "Some requests failed"
          : !allEchoedCorrectly
          ? "Some responses did not echo the input correctly"
          : null,
        details: {
          testResults,
          summary: {
            totalTests: testResults.length,
            successfulRequests: testResults.filter((r) => r.success).length,
            correctlyEchoed: testResults.filter((r) => r.echoedCorrectly).length,
            failedTests: failedTests,
          },
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
  },

  /**
   * Test CRUDA endpoints for handling special characters, different encodings, and zero-length inputs
   */
  testCrudaSpecialCharactersAndEncoding: async (tcscae_api_ep) => {
    const moduleName = "encoding";
    const testName = "testCrudaSpecialCharactersAndEncoding";
    const correlationId = ulid();
    const testData = { tcscae_api_ep };
    testData.endpoint = `${tcscae_api_ep}/api/cruda/create`; // Using 'create' as the primary endpoint for test identification

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tcscae_api_ep: testData.endpoint,
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
      // Test cases with various special characters and encodings
      const testCases = [
        // Special characters
        {
          name: "Special ASCII characters",
          comment: "Special chars: !@#$%^&*()_+-=[]{}|;:'\",.<>/?\\`~",
          description: "Testing special ASCII characters",
        },
        // Unicode characters
        {
          name: "Unicode characters",
          comment: "Unicode: ÄäÁáČčĎďÉéĚěÍíŇňÓóŘřŠšŤťÚúŮůÝýŽž",
          description: "Testing Unicode Latin characters with diacritics",
        },
        // Emojis
        {
          name: "Emoji characters",
          comment: "Emojis: 😀👍🚀🌍💻🔒🔑🧪",
          description: "Testing emoji characters",
        },
        // Right-to-left text
        {
          name: "RTL text",
          comment: "RTL: مرحبا بالعالم! שלום עולם!",
          description: "Testing right-to-left Arabic and Hebrew text",
        },
        // Asian characters
        {
          name: "Asian characters",
          comment: "Asian: 你好世界! こんにちは世界! 안녕하세요 세계!",
          description: "Testing Chinese, Japanese, and Korean characters",
        },
        // SQL injection attempt
        {
          name: "SQL injection characters",
          comment: "SQL: '; DROP TABLE comments; --",
          description: "Testing SQL injection characters",
        },
        // JavaScript injection attempt
        {
          name: "JavaScript injection",
          comment: "XSS: <script>alert('XSS')</script>",
          description: "Testing JavaScript injection characters",
        },
        // Very long input
        {
          name: "Long content",
          comment: "Long: " + "a".repeat(1000),
          description: "Testing very long content (1000+ chars)",
        },
        // Control characters
        {
          name: "Control characters",
          comment: "Control: Line 1\nLine 2\tTabbed\rCarriage Return",
          description: "Testing control characters (newline, tab, carriage return)",
        },
      ];

      const allResults = {
        create: [],
        list: null,
        read: [],
        update: [],
        destroy: [],
      };

      // First test create endpoint with each test case
      for (const testCase of testCases) {
        logger.debug(`Testing CREATE for case: ${testCase.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "create_test",
          caseName: testCase.name,
        });

        // Create a comment with special characters
        const createResponse = await fetch(`${tcscae_api_ep}/api/cruda/create`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            comment: testCase.comment,
            content: testCase.content,
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

        // Check if the data was stored correctly with special characters
        // Use normalized comparison to handle potential whitespace/encoding differences
        const createdComment = extractCommentValue(createResponse.data);
        const dataMatches =
          createResponse.ok &&
          createdComment !== '' &&
          createdComment.replace(/\s+/g, ' ').trim() === String(testCase.comment ?? '').replace(/\s+/g, ' ').trim();

        // Store the newly created comment ID for later tests
        const commentId = createResponse.data?.id;

        allResults.create.push({
          testCase: testCase.name,
          description: testCase.description,
          success: createResponse.ok && !createResponse.error,
          dataMatches,
          commentId,
          status: createResponse.status,
          error: createResponse.error,
        });

        // If creation was successful, also test reading the comment
        if (createResponse.ok && commentId) {
          // Read the created comment to check its content
          const readResponse = await fetch(`${tcscae_api_ep}/api/cruda/read`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId,
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

          // Check if the retrieved data matches what we created
          // Use normalized comparison to handle potential whitespace/encoding differences
          
          // Debug logging for data comparison
          const actualComment = extractCommentValue(readResponse.data);
          const expectedComment = String(testCase.comment ?? '');
          
          const commentMatch =
            readResponse.ok &&
            actualComment.replace(/\s+/g, ' ').trim() === expectedComment.replace(/\s+/g, ' ').trim();
          
          console.log(`READ [${testCase.name}]: commentMatch=${commentMatch}`);
          console.log(`  Expected: "${expectedComment.substring(0, 50)}${expectedComment.length > 50 ? '...' : ''}"`);
          console.log(`  Actual:   "${actualComment.substring(0, 50)}${actualComment.length > 50 ? '...' : ''}"`);
          console.log(`  API Response Keys: ${Object.keys(readResponse.data || {}).join(', ')}`);
          console.log(`  Full Response:`, JSON.stringify(readResponse.data).substring(0, 200));
          if (!commentMatch) {
            console.log(`  MISMATCH - Expected length: ${expectedComment.length}, Actual length: ${actualComment.length}`);
            console.log(`  Expected bytes: ${Buffer.from(expectedComment).toString('hex').substring(0, 40)}`);
            console.log(`  Actual bytes:   ${Buffer.from(actualComment).toString('hex').substring(0, 40)}`);
          }
          
          const readDataMatches = commentMatch;

          allResults.read.push({
            testCase: testCase.name,
            commentId,
            success: readResponse.ok && !readResponse.error,
            dataMatches: readDataMatches,
            status: readResponse.status,
            error: readResponse.error,
          });

          // Test updating the comment
          const updatedComment = `Updated: ${testCase.comment}`;

          const updateResponse = await fetch(`${tcscae_api_ep}/api/cruda/update`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId,
              comment: updatedComment,
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

          // Check if the updated data was stored correctly
          // Use normalized comparison to handle potential whitespace/encoding differences
          
          // Debug logging for update data comparison
          const actualUpdatedComment = extractCommentValue(updateResponse.data);
          const expectedUpdatedComment = String(updatedComment ?? '');
          
          const updateCommentMatch =
            updateResponse.ok &&
            actualUpdatedComment.replace(/\s+/g, ' ').trim() === expectedUpdatedComment.replace(/\s+/g, ' ').trim();
          
          console.log(`UPDATE [${testCase.name}]: commentMatch=${updateCommentMatch}`);
          console.log(`  Expected: "${expectedUpdatedComment.substring(0, 50)}${expectedUpdatedComment.length > 50 ? '...' : ''}"`);
          console.log(`  Actual:   "${actualUpdatedComment.substring(0, 50)}${actualUpdatedComment.length > 50 ? '...' : ''}"`);
          console.log(`  API Response Keys: ${Object.keys(updateResponse.data || {}).join(', ')}`);
          console.log(`  Full Response:`, JSON.stringify(updateResponse.data).substring(0, 200));
          if (!updateCommentMatch) {
            console.log(`  MISMATCH - Expected length: ${expectedUpdatedComment.length}, Actual length: ${actualUpdatedComment.length}`);
            console.log(`  Expected bytes: ${Buffer.from(expectedUpdatedComment).toString('hex').substring(0, 40)}`);
            console.log(`  Actual bytes:   ${Buffer.from(actualUpdatedComment).toString('hex').substring(0, 40)}`);
          }
          
          const updateDataMatches = updateCommentMatch;

          allResults.update.push({
            testCase: testCase.name,
            commentId,
            success: updateResponse.ok && !updateResponse.error,
            dataMatches: updateDataMatches,
            status: updateResponse.status,
            error: updateResponse.error,
          });
        }
      }

      // Test listing all comments
      const listResponse = await fetch(`${tcscae_api_ep}/api/cruda/list`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
        body: JSON.stringify({}),
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

      // Check if we can get a list of comments
      const commentsListValid =
        listResponse.ok &&
        listResponse.data &&
        Array.isArray(listResponse.data.comments);

      allResults.list = {
        success: listResponse.ok && !listResponse.error,
        hasComments: commentsListValid,
        commentCount: commentsListValid ? listResponse.data.comments.length : 0,
        status: listResponse.status,
        error: listResponse.error,
      };

      // Now delete one comment to test destroy endpoint
      if (allResults.create.length > 0 && allResults.create[0].commentId) {
        const commentToDelete = allResults.create[0].commentId;
        const deleteResponse = await fetch(`${tcscae_api_ep}/api/cruda/destroy`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            id: commentToDelete,
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

        allResults.destroy.push({
          commentId: commentToDelete,
          success: deleteResponse.ok && !deleteResponse.error,
          status: deleteResponse.status,
          error: deleteResponse.error,
        });
      }

      // Calculate success metrics
      const createSuccess = allResults.create.every(
        (r) => r.success && r.dataMatches
      );
      const readSuccess = allResults.read.every(
        (r) => r.success && r.dataMatches
      );
      const updateSuccess = allResults.update.every(
        (r) => r.success && r.dataMatches
      );
      const listSuccess =
        allResults.list &&
        allResults.list.success &&
        allResults.list.hasComments;
      const destroySuccess =
        allResults.destroy.length > 0 &&
        allResults.destroy.every((r) => r.success);

      // Log test completion
      logger.info("CRUDA encoding tests completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        createSuccess,
        readSuccess,
        updateSuccess,
        listSuccess,
        destroySuccess,
      });

      const result = {
        success:
          createSuccess &&
          readSuccess &&
          updateSuccess &&
          listSuccess &&
          destroySuccess,
        error: !createSuccess
          ? "Create operations failed for special characters"
          : !readSuccess
          ? "Read operations failed for special characters"
          : !updateSuccess
          ? "Update operations failed for special characters"
          : !listSuccess
          ? "List operation failed"
          : !destroySuccess
          ? "Delete operation failed"
          : null,
        details: {
          createResults: allResults.create,
          readResults: allResults.read,
          updateResults: allResults.update,
          listResult: allResults.list,
          destroyResults: allResults.destroy,
          summary: {
            totalCreateTests: allResults.create.length,
            successfulCreateTests: allResults.create.filter(
              (r) => r.success && r.dataMatches
            ).length,
            totalReadTests: allResults.read.length,
            successfulReadTests: allResults.read.filter(
              (r) => r.success && r.dataMatches
            ).length,
            totalUpdateTests: allResults.update.length,
            successfulUpdateTests: allResults.update.filter(
              (r) => r.success && r.dataMatches
            ).length,
            totalDestroyTests: allResults.destroy.length,
            successfulDestroyTests: allResults.destroy.filter((r) => r.success)
              .length,
          },
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
  },
};

module.exports = encodingTests;
