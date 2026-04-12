// test-modules/performance.js
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData } = require("./test-utils");
/**
 * Enhanced fetch function that provides raw results without error handling
 * @param {string} url - The URL to fetch
 * @param {Object} dfoptions - Fetch dfoptions
 * @returns {Promise<{response: Response, data: any, status: number, statusText: string, duration: number}>}
 */
async function directFetch(url, dfoptions = {}) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(url, dfoptions);
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    let data;
    const contentType = response.headers.get('content-type');
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }
    
    return {
      response,
      data,
      status: response.status,
      statusText: response.statusText,
      duration,
      success: response.ok
    };
  } catch (error) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    return {
      response: null,
      data: null,
      status: 0,
      statusText: error.message,
      duration,
      success: false,
      error: {
        message: error.message,
        stack: error.stack
      }
    };
  }
}

/**
 * Performance test module - refactored to use direct fetch
 */
const performanceTests = {
  /**
   * Measure API response latency under different loads using echo endpoint
   */
  testApiResponseLatency: async (tarl_api_ep, logContext) => {
    const moduleName = "performance";
    const testName = "testApiResponseLatency";
    const correlationId = ulid();
    const testData = { tarl_api_ep };
    testData.endpoint = `${tarl_api_ep}/api/noncets`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tarl_api_ep: testData.endpoint,
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
      // Test parameters - reduced for faster execution (under 2 minutes total)
      const iterations = 2;
      const concurrentRequests = 2;
      const testTimeout = 90000; // 90 seconds timeout per test

      testData.parameters = { iterations, concurrentRequests };

      // Log test phase
      logger.info("Test phase: Sequential tests", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "sequential_tests",
      });

      // Function to measure a single API request
      const measureApiRequest = async (message) => {
        const fetchResult = await directFetch(
          `${tarl_api_ep}/api/noncets`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({ message }),
          }
        );

        return {
          success: fetchResult.success,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          response: fetchResult.data,
          error: fetchResult.success ? null : {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          }
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
      logger.info("Test phase: Concurrent tests", {
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

      // Calculate success rates
      const sequentialSuccessRate = (sequentialResults.filter(r => r.success).length / sequentialResults.length) * 100;
      const concurrentSuccessRate = (concurrentResults.filter(r => r.success).length / concurrentResults.length) * 100;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        sequentialAvg: Math.round(sequentialAvg),
        concurrentAvg: Math.round(concurrentAvg),
        sequentialSuccessRate,
        concurrentSuccessRate
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
              successRate: sequentialSuccessRate
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
              successRate: concurrentSuccessRate
            },
          },
          comparison: {
            avgDifference: concurrentAvg - sequentialAvg,
            percentChange:
              (((concurrentAvg - sequentialAvg) / sequentialAvg) * 100).toFixed(
                2
              ) + "%",
            successRateDifference: concurrentSuccessRate - sequentialSuccessRate
          },
        },
      };

      testData.sequentialStats = {
        avg: sequentialAvg,
        min: sequentialMin,
        max: sequentialMax,
        successRate: sequentialSuccessRate
      };

      testData.concurrentStats = {
        avg: concurrentAvg,
        min: concurrentMin,
        max: concurrentMax,
        successRate: concurrentSuccessRate
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
  testLoginResponseTimes: async (tlrt_api_ep, logContext) => {
    const moduleName = "performance";
    const testName = "testLoginResponseTimes";
    const correlationId = ulid();
    const testData = { tlrt_api_ep };
    testData.endpoint = `${tlrt_api_ep}/api/login`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tlrt_api_ep: testData.endpoint,
      startTime: new Date().toISOString(),
    });

    try {
      // Get current configuration for login
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit) {
        const result = {
          success: false,
          error: "No RODiT configuration available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test parameters - reduced for faster execution (under 2 minutes total)
      const iterations = 2;
      const concurrentLogins = 2;
      const testTimeout = 60000; // 60 seconds timeout per test

      testData.parameters = { iterations, concurrentLogins };

      // Generate timestamp and signature for login
      logger.info("Test phase: Preparing login data", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "preparing_login_data",
      });

      const generateLoginCredentials = () => {
        // Generate login credentials similar to your implementation
        const timestamp = Math.floor(Date.now() / 1000);
        const roditid = config_own_rodit.own_rodit.token_id;
        const timeString = new Date(timestamp * 1000).toISOString();
        const roditidandtimestamp = new TextEncoder().encode(roditid + timeString);
        
        // Generate signature using the private key
        const bytes_signature = nacl.sign.detached(
          roditidandtimestamp,
          config_own_rodit.own_rodit_bytes_private_key
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
        
        const fetchResult = await directFetch(
          `${tlrt_api_ep}/api/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify(credentials),
          }
        );

        // Consider success if HTTP status is 2xx and response contains token
        const hasToken = fetchResult.data && typeof fetchResult.data === 'object' && fetchResult.data.token;
        
        return {
          success: fetchResult.success && hasToken,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          error: !fetchResult.success ? {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          } : (!hasToken ? {
            message: "Response missing token"
          } : null)
        };
      };

      // Log test phase
      logger.info("Test phase: Sequential login tests", {
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
      const sequentialSuccessRate = (sequentialResults.filter(r => r.success).length / sequentialResults.length) * 100;

      // Log test phase
      logger.info("Test phase: Concurrent login tests", {
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
      const concurrentSuccessRate = (concurrentResults.filter(r => r.success).length / concurrentResults.length) * 100;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        sequentialAvg: Math.round(sequentialAvg),
        concurrentAvg: Math.round(concurrentAvg),
        sequentialSuccessRate,
        concurrentSuccessRate
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
              successRate: sequentialSuccessRate
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
              successRate: concurrentSuccessRate
            },
          },
          comparison: {
            avgDifference: concurrentAvg - sequentialAvg,
            percentChange:
              (((concurrentAvg - sequentialAvg) / sequentialAvg) * 100).toFixed(
                2
              ) + "%",
            successRateDifference: concurrentSuccessRate - sequentialSuccessRate
          },
        },
      };

      testData.sequentialStats = {
        avg: sequentialAvg,
        min: sequentialMin,
        max: sequentialMax,
        successRate: sequentialSuccessRate
      };

      testData.concurrentStats = {
        avg: concurrentAvg,
        min: concurrentMin,
        max: concurrentMax,
        successRate: concurrentSuccessRate
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
  testCrudaPerformance: async (tcp_api_ep, logContext) => {
    const moduleName = "performance";
    const testName = "testCrudaPerformance";
    const correlationId = ulid();
    const testData = { tcp_api_ep };
    testData.endpoint = `${tcp_api_ep}/api/cruda`;

    // Log test start with standardized format
    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      runId: correlationId,
      testId: ulid(),
      tcp_api_ep: testData.endpoint,
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
      // Test parameters - reduced for faster execution (under 2 minutes total)
      const commentCount = 2; // Create this many comments
      const readIterations = 2; // Read each comment this many times
      const testTimeout = 60000; // 60 seconds timeout per test
      
      testData.parameters = { commentCount, readIterations };

      // Log test phase
      logger.info("Test phase: Create performance", {
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
        const fetchResult = await directFetch(
          `${tcp_api_ep}/api/cruda/create`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              comment: `Performance Test Comment ${i + 1}`,
              content: `This is performance test comment #${i + 1} created at ${new Date().toISOString()}`
            }),
          }
        );

        // Check if response contains comment ID
        const hasId = fetchResult.data && typeof fetchResult.data === 'object' && fetchResult.data.id;
        
        if (hasId) {
          commentIds.push(fetchResult.data.id);
        }

        createResults.push({
          commentNumber: i + 1,
          success: fetchResult.success && hasId,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          error: !fetchResult.success ? {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          } : (!hasId ? {
            message: "Response missing comment ID"
          } : null),
          commentId: hasId ? fetchResult.data.id : null,
        });
      }

      // Log test phase
      logger.info("Test phase: Read performance", {
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
          const fetchResult = await directFetch(
            `${tcp_api_ep}/api/cruda/read`,
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

          // Check if response contains comment data
          const hasComment = fetchResult.data && typeof fetchResult.data === 'object' && 
                            (fetchResult.data.id === commentId || 
                             (fetchResult.data.comment && fetchResult.data.comment.id === commentId));

          readResults.push({
            commentId,
            iteration: i + 1,
            success: fetchResult.success && hasComment,
            duration: fetchResult.duration,
            status: fetchResult.status,
            statusText: fetchResult.statusText,
            error: !fetchResult.success ? {
              message: fetchResult.statusText || "Request failed",
              details: fetchResult.error
            } : (!hasComment ? {
              message: "Response missing valid comment data"
            } : null)
          });
        }
      }

      // Log test phase
      logger.info("Test phase: List performance", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "list_performance",
      });

      // Measure LIST performance
      const listResults = [];

      for (let i = 0; i < 3; i++) {
        const fetchResult = await directFetch(
          `${tcp_api_ep}/api/cruda/list`,
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

        // Check if response contains comments array
        const hasComments = fetchResult.data && typeof fetchResult.data === 'object' && 
                            Array.isArray(fetchResult.data.comments);

        listResults.push({
          iteration: i + 1,
          success: fetchResult.success && hasComments,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          error: !fetchResult.success ? {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          } : (!hasComments ? {
            message: "Response missing comments array"
          } : null),
          commentCount: hasComments ? fetchResult.data.comments.length : 0,
        });
      }

      // Log test phase
      logger.info("Test phase: Update performance", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "update_performance",
      });

      // Measure UPDATE performance
      const updateResults = [];

      for (const commentId of commentIds) {
        const fetchResult = await directFetch(
          `${tcp_api_ep}/api/cruda/update`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
              "X-Request-ID": ulid(),
            },
            body: JSON.stringify({
              id: commentId,
              comment: `Updated Performance Test Comment ${commentId}`,
              content: `This comment was updated at ${new Date().toISOString()}`
            }),
          }
        );

        // Check if update was successful
        const updateSuccess = fetchResult.data && typeof fetchResult.data === 'object' && 
                             (fetchResult.data.success === true || fetchResult.data.updated === true);

        updateResults.push({
          commentId,
          success: fetchResult.success && updateSuccess,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          error: !fetchResult.success ? {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          } : (!updateSuccess ? {
            message: "Response does not indicate successful update"
          } : null)
        });
      }

      // Log test phase
      logger.info("Test phase: Destroy performance", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "destroy_performance",
      });

      // Measure DESTROY performance
      const destroyResults = [];

      for (const commentId of commentIds) {
        const fetchResult = await directFetch(
          `${tcp_api_ep}/api/cruda/destroy`,
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

        // Check if delete was successful
        const deleteSuccess = fetchResult.data && typeof fetchResult.data === 'object' && 
                             (fetchResult.data.success === true || fetchResult.data.deleted === true);

        destroyResults.push({
          commentId,
          success: fetchResult.success && deleteSuccess,
          duration: fetchResult.duration,
          status: fetchResult.status,
          statusText: fetchResult.statusText,
          error: !fetchResult.success ? {
            message: fetchResult.statusText || "Request failed",
            details: fetchResult.error
          } : (!deleteSuccess ? {
            message: "Response does not indicate successful deletion"
          } : null)
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
          statusCodes: countStatusCodes(results)
        };
      };

      // Helper to count status codes
      function countStatusCodes(results) {
        const counts = {};
        results.forEach(r => {
          const status = r.status.toString();
          counts[status] = (counts[status] || 0) + 1;
        });
        return counts;
      }

      const createStats = calculateStats(createResults);
      const readStats = calculateStats(readResults);
      const listStats = calculateStats(listResults);
      const updateStats = calculateStats(updateResults);
      const destroyStats = calculateStats(destroyResults);

      // Log test completion
      logger.info("Test completed", {
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
        createSuccessRate: createStats.successRate,
        readSuccessRate: readStats.successRate,
        listSuccessRate: listStats.successRate,
        updateSuccessRate: updateStats.successRate,
        destroySuccessRate: destroyStats.successRate
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
            createSuccessRate: createStats.successRate.toFixed(1),
            readSuccessRate: readStats.successRate.toFixed(1),
            listSuccessRate: listStats.successRate.toFixed(1),
            updateSuccessRate: updateStats.successRate.toFixed(1),
            destroySuccessRate: destroyStats.successRate.toFixed(1),
          }
        },
      };

      testData.summary = {
        createAvg: Math.round(createStats.avg),
        readAvg: Math.round(readStats.avg),
        listAvg: Math.round(listStats.avg),
        updateAvg: Math.round(updateStats.avg),
        destroyAvg: Math.round(destroyStats.avg),
        createSuccessRate: createStats.successRate.toFixed(1),
        readSuccessRate: readStats.successRate.toFixed(1),
        listSuccessRate: listStats.successRate.toFixed(1),
        updateSuccessRate: updateStats.successRate.toFixed(1),
        destroySuccessRate: destroyStats.successRate.toFixed(1)
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