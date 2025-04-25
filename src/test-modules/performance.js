// test-modules/performance.js
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");
const { ulid } = require("ulid");
const logger = require("../../config/logger");

// Add this utility function after imports
function captureTestData(testName, moduleName, result, testData) {
  // Create consistent result format with test info
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
  };

  // Only capture extended data on failure
  if (!result.success) {
    // Create unique ID for this failure
    const correlationId = ulid();
    
    // Add failure info
    result.testInfo.correlationId = correlationId;
    result.testInfo.failureData = true;
    
    // Log with consistent identifiers
    logger.error(`Test '${testName}' failed`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      error: result.error,
    });

    try {
      // Instead of saving to file, log the detailed data
      const failureData = {
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      };
      
      // Log detailed failure data
      logger.info(`Test failure details`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        failureData: JSON.stringify(failureData),
      });
      
      // Add metric for test failure
      logger.metric('test_failure', 1, {
        module: moduleName,
        test: testName,
        correlation_id: correlationId
      });
      
    } catch (logError) {
      logger.error(`Failed to log failure data`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: logError.message,
      });
    }
  } else {
    // Log successful test execution
    logger.debug(`Test '${testName}' passed`, {
      component: "TestRunner",
      moduleName,
      testName
    });
    
    // Add metric for test success
    logger.metric('test_success', 1, {
      module: moduleName,
      test: testName
    });
  }
  
  return result;
}

/**
 * Performance test module - refactored to use actual server endpoints
 */
const performanceTests = {
  /**
   * Measure API response latency under different loads using echo endpoint
   */
  testApiResponseLatency: async (apiEndpoint, logContext) => {
    const moduleName = "performance";
    const testName = "testApiResponseLatency";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start with correlation ID
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
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
      // Test parameters - reduced from original to avoid rate limiting
      const iterations = 5;
      const concurrentRequests = 3;

      testData.parameters = { iterations, concurrentRequests };

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "sequential_tests",
      });

      // Function to measure a single API request
      const measureApiRequest = async (message) => {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/echo`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({ message }),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        return {
          success: !result.error,
          duration,
          error: result.error,
          response: result.error ? null : result.echo,
        };
      };

      // Run sequential tests
      const sequentialResults = [];

      for (let i = 0; i < iterations; i++) {
        logger.debug("Sequential test iteration", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "sequential_iteration",
          iteration: i + 1,
        });

        const result = await measureApiRequest(`Sequential test ${i + 1}`);
        sequentialResults.push({
          iteration: i + 1,
          ...result,
        });
      }

      // Calculate sequential stats
      const sequentialDurations = sequentialResults.map((r) => r.duration);
      const sequentialAvg =
        sequentialDurations.reduce((sum, val) => sum + val, 0) /
        sequentialDurations.length;
      const sequentialMin = Math.min(...sequentialDurations);
      const sequentialMax = Math.max(...sequentialDurations);

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_tests",
      });

      // Run concurrent tests
      const concurrentResults = [];

      for (let i = 0; i < iterations; i++) {
        logger.debug("Concurrent test batch", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "concurrent_batch",
          batch: i + 1,
        });

        const batchPromises = [];

        // Create a batch of concurrent requests
        for (let j = 0; j < concurrentRequests; j++) {
          batchPromises.push(measureApiRequest(`Concurrent test ${i + 1}, request ${j + 1}`));
        }

        // Wait for all concurrent requests to complete
        const batchResults = await Promise.all(batchPromises);

        // Store results with batch number
        batchResults.forEach((result, index) => {
          concurrentResults.push({
            batch: i + 1,
            requestIndex: index + 1,
            ...result,
          });
        });
        
        // Add a small delay between batches to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Calculate concurrent stats
      const concurrentDurations = concurrentResults.map((r) => r.duration);
      const concurrentAvg =
        concurrentDurations.reduce((sum, val) => sum + val, 0) /
        concurrentDurations.length;
      const concurrentMin = Math.min(...concurrentDurations);
      const concurrentMax = Math.max(...concurrentDurations);

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        sequentialAvg: Math.round(sequentialAvg),
        concurrentAvg: Math.round(concurrentAvg),
      });

      const result = {
        success: true,
        details: {
          sequential: {
            iterations,
            results: sequentialResults,
            stats: {
              avg: sequentialAvg,
              min: sequentialMin,
              max: sequentialMax,
            },
          },
          concurrent: {
            iterations,
            concurrentRequests,
            totalRequests: iterations * concurrentRequests,
            results: concurrentResults,
            stats: {
              avg: concurrentAvg,
              min: concurrentMin,
              max: concurrentMax,
            },
          },
          comparison: {
            avgDifference: concurrentAvg - sequentialAvg,
            percentChange:
              (((concurrentAvg - sequentialAvg) / sequentialAvg) * 100).toFixed(
                2
              ) + "%",
          },
        },
      };

      testData.sequentialStats = {
        avg: sequentialAvg,
        min: sequentialMin,
        max: sequentialMax,
      };

      testData.concurrentStats = {
        avg: concurrentAvg,
        min: concurrentMin,
        max: concurrentMax,
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
   * Measure login response times with multiple concurrent users
   */
  testLoginResponseTimes: async (apiEndpoint, logContext) => {
    const moduleName = "performance";
    const testName = "testLoginResponseTimes";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get current configuration for login
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test parameters - reduced from original to avoid rate limiting
      const iterations = 3;
      const concurrentLogins = 2;

      testData.parameters = { iterations, concurrentLogins };

      // Generate timestamp and signature for login
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "preparing_login_data",
      });

      const generateLoginCredentials = () => {
        // Generate login credentials similar to your implementation
        const timestamp = Math.floor(Date.now() / 1000);
        const roditid = config.own_rodit.token_id;
        const timeString = new Date(timestamp * 1000).toISOString();
        const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);
        
        // Generate signature using the private key
        const bytes_signature = nacl.sign.detached(
          roditidandtimestamp,
          config.own_rodit_bytes_private_key
        );
        const roditid_base64url_signature = Buffer.from(bytes_signature).toString("base64url");
        
        return {
          roditid,
          timestamp,
          roditid_base64url_signature
        };
      };

      // Function to measure a single login request
      const measureLogin = async () => {
        const credentials = generateLoginCredentials();
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify(credentials),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        return {
          success: !result.error && !!result.token,
          duration,
          error: result.error,
        };
      };

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "sequential_login_tests",
      });

      // Run sequential login tests
      const sequentialResults = [];

      for (let i = 0; i < iterations; i++) {
        logger.debug("Sequential login test", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "sequential_login",
          iteration: i + 1,
        });

        const result = await measureLogin();
        sequentialResults.push({
          iteration: i + 1,
          ...result,
        });
        
        // Add a small delay between sequential logins
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // Calculate sequential stats
      const sequentialDurations = sequentialResults.map((r) => r.duration);
      const sequentialAvg =
        sequentialDurations.reduce((sum, val) => sum + val, 0) /
        sequentialDurations.length;
      const sequentialMin = Math.min(...sequentialDurations);
      const sequentialMax = Math.max(...sequentialDurations);

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_login_tests",
      });

      // Run concurrent login tests
      const concurrentResults = [];

      for (let i = 0; i < iterations; i++) {
        logger.debug("Concurrent login batch", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "concurrent_login_batch",
          batch: i + 1,
        });

        const batchPromises = [];

        // Create a batch of concurrent login requests
        for (let j = 0; j < concurrentLogins; j++) {
          batchPromises.push(measureLogin());
        }

        // Wait for all concurrent logins to complete
        const batchResults = await Promise.all(batchPromises);

        // Store results with batch number
        batchResults.forEach((result, index) => {
          concurrentResults.push({
            batch: i + 1,
            loginIndex: index + 1,
            ...result,
          });
        });

        // Larger delay between batches to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Calculate concurrent stats
      const concurrentDurations = concurrentResults.map((r) => r.duration);
      const concurrentAvg =
        concurrentDurations.reduce((sum, val) => sum + val, 0) /
        concurrentDurations.length;
      const concurrentMin = Math.min(...concurrentDurations);
      const concurrentMax = Math.max(...concurrentDurations);

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        sequentialAvg: Math.round(sequentialAvg),
        concurrentAvg: Math.round(concurrentAvg),
      });

      const result = {
        success: true,
        details: {
          sequential: {
            iterations,
            results: sequentialResults,
            stats: {
              avg: sequentialAvg,
              min: sequentialMin,
              max: sequentialMax,
            },
          },
          concurrent: {
            iterations,
            concurrentLogins,
            totalLogins: iterations * concurrentLogins,
            results: concurrentResults,
            stats: {
              avg: concurrentAvg,
              min: concurrentMin,
              max: concurrentMax,
            },
          },
          comparison: {
            avgDifference: concurrentAvg - sequentialAvg,
            percentChange:
              (((concurrentAvg - sequentialAvg) / sequentialAvg) * 100).toFixed(
                2
              ) + "%",
          },
        },
      };

      testData.sequentialStats = {
        avg: sequentialAvg,
        min: sequentialMin,
        max: sequentialMax,
      };

      testData.concurrentStats = {
        avg: concurrentAvg,
        min: concurrentMin,
        max: concurrentMax,
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
   * Test CRUDA operations performance
   */
  testCrudaPerformance: async (apiEndpoint, logContext) => {
    const moduleName = "performance";
    const testName = "testCrudaPerformance";
    const correlationId = ulid();
    const testData = { apiEndpoint };

    // Log test start
    logger.info("Starting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
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
      // Test parameters
      const commentCount = 5; // Create this many comments
      const readIterations = 3; // Read each comment this many times
      
      testData.parameters = { commentCount, readIterations };

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "create_performance",
      });

      // Measure CREATE performance
      const createResults = [];
      const commentIds = [];

      for (let i = 0; i < commentCount; i++) {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/cruda/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              title: `Performance Test Comment ${i + 1}`,
              content: `This is performance test comment #${i + 1} created at ${new Date().toISOString()}`
            }),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        if (!result.error && result.id) {
          commentIds.push(result.id);
        }

        createResults.push({
          commentNumber: i + 1,
          success: !result.error && !!result.id,
          duration,
          error: result.error,
          commentId: result.id,
        });
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "read_performance",
      });

      // Measure READ performance
      const readResults = [];

      for (const commentId of commentIds) {
        for (let i = 0; i < readIterations; i++) {
          const startTime = Date.now();

          const result = await fetchWithErrorHandling(
            `${apiEndpoint}/api/cruda/read`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
                "X-Request-ID": ulid(),
              },
              body: JSON.stringify({ id: commentId }),
            }
          );

          const endTime = Date.now();
          const duration = endTime - startTime;

          readResults.push({
            commentId,
            iteration: i + 1,
            success: !result.error,
            duration,
            error: result.error,
          });
        }
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "list_performance",
      });

      // Measure LIST performance
      const listResults = [];

      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/cruda/list`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({}),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        listResults.push({
          iteration: i + 1,
          success: !result.error,
          duration,
          error: result.error,
          commentCount: result.comments?.length,
        });
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "update_performance",
      });

      // Measure UPDATE performance
      const updateResults = [];

      for (const commentId of commentIds) {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/cruda/update`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId,
              title: `Updated Performance Test Comment ${commentId}`,
              content: `This comment was updated at ${new Date().toISOString()}`
            }),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        updateResults.push({
          commentId,
          success: !result.error,
          duration,
          error: result.error,
        });
      }

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "destroy_performance",
      });

      // Measure DESTROY performance
      const destroyResults = [];

      for (const commentId of commentIds) {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/cruda/destroy`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({ id: commentId }),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        destroyResults.push({
          commentId,
          success: !result.error,
          duration,
          error: result.error,
        });
      }

      // Calculate stats for each operation
      const calculateStats = (results) => {
        const durations = results.map((r) => r.duration);
        return {
          count: results.length,
          avg: durations.reduce((sum, val) => sum + val, 0) / durations.length,
          min: Math.min(...durations),
          max: Math.max(...durations),
          successRate: (results.filter((r) => r.success).length / results.length) * 100,
        };
      };

      const createStats = calculateStats(createResults);
      const readStats = calculateStats(readResults);
      const listStats = calculateStats(listResults);
      const updateStats = calculateStats(updateResults);
      const destroyStats = calculateStats(destroyResults);

      // Log test completion
      logger.info("Test completed successfully", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        createAvg: Math.round(createStats.avg),
        readAvg: Math.round(readStats.avg),
        listAvg: Math.round(listStats.avg),
        updateAvg: Math.round(updateStats.avg),
        destroyAvg: Math.round(destroyStats.avg),
      });

      const result = {
        success: true,
        details: {
          operations: {
            create: { results: createResults, stats: createStats },
            read: { results: readResults, stats: readStats },
            list: { results: listResults, stats: listStats },
            update: { results: updateResults, stats: updateStats },
            destroy: { results: destroyResults, stats: destroyStats },
          },
          summary: {
            createAvg: Math.round(createStats.avg),
            readAvg: Math.round(readStats.avg),
            listAvg: Math.round(listStats.avg),
            updateAvg: Math.round(updateStats.avg),
            destroyAvg: Math.round(destroyStats.avg),
          }
        },
      };

      testData.summary = {
        createAvg: Math.round(createStats.avg),
        readAvg: Math.round(readStats.avg),
        listAvg: Math.round(listStats.avg),
        updateAvg: Math.round(updateStats.avg),
        destroyAvg: Math.round(destroyStats.avg),
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

module.exports = performanceTests;