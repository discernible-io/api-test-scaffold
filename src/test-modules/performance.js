// test-modules/performance.js
const crypto = require("crypto");
const { fetchWithErrorHandling, stateManager } = require("../middleware/rodit");

// Add this utility function after imports
function captureTestData(testName, moduleName, result, testData) {
  const fs = require("fs");
  const path = require("path");
  const { ulid } = require("ulid");

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
      // Ensure directory exists
      const failureDirPath = path.join(process.cwd(), "test-failures");
      if (!fs.existsSync(failureDirPath)) {
        fs.mkdirSync(failureDirPath, { recursive: true });
      }

      // Save detailed data to file
      const failureData = {
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      };

      const filename = path.join(
        failureDirPath,
        `${moduleName}_${testName}_${correlationId}.json`
      );
      fs.writeFileSync(filename, JSON.stringify(failureData, null, 2));

      result.testInfo.failureDataPath = filename;

      logger.info(`Failure data saved to file`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        filePath: filename,
      });
    } catch (saveError) {
      logger.error(`Failed to save failure data`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: saveError.message,
      });
    }
  }

  return result;
}
/**
 * Performance test module
 */
const performanceTests = {
  /**
   * Measure token validation latency under different loads
   */
  testTokenValidationLatency: async (apiEndpoint, logContext) => {
    const moduleName = "performance";
    const testName = "testTokenValidationLatency";
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
      // Test parameters
      const iterations = 10;
      const concurrentRequests = 5;

      testData.parameters = { iterations, concurrentRequests };

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "sequential_tests",
      });

      // Function to measure a single validation request
      const measureValidation = async () => {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/auth/validate_token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        return {
          success: !result.error,
          duration,
          error: result.error,
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

        const result = await measureValidation();
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
          batchPromises.push(measureValidation());
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
    try {
      // Get current configuration
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit) {
        return {
          success: false,
          error: "No RODiT configuration available for testing",
        };
      }

      // Test parameters
      const iterations = 5;
      const concurrentLogins = 3;

      // Function to measure a single login request
      const measureLogin = async () => {
        const startTime = Date.now();

        const result = await fetchWithErrorHandling(
          `${apiEndpoint}/api/auth/login`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              rodit: config.own_rodit,
            }),
          }
        );

        const endTime = Date.now();
        const duration = endTime - startTime;

        return {
          success: !result.error && !!result.jwt_token,
          duration,
          error: result.error,
        };
      };

      // Run sequential login tests
      const sequentialResults = [];

      for (let i = 0; i < iterations; i++) {
        const result = await measureLogin();
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

      // Run concurrent login tests
      const concurrentResults = [];

      for (let i = 0; i < iterations; i++) {
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

        // Small delay between batches to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      // Calculate concurrent stats
      const concurrentDurations = concurrentResults.map((r) => r.duration);
      const concurrentAvg =
        concurrentDurations.reduce((sum, val) => sum + val, 0) /
        concurrentDurations.length;
      const concurrentMin = Math.min(...concurrentDurations);
      const concurrentMax = Math.max(...concurrentDurations);

      return {
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
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },

  /**
   * Test system behavior at rate limit boundaries
   */
  testRateLimitBoundaries: async (apiEndpoint, logContext) => {
    const token = await stateManager.getJwtToken();
    if (!token) {
      return {
        success: false,
        error: "No JWT token available for testing",
      };
    }

    try {
      // Get current rate limit configuration
      const configResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/system/rate_limit_config`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (configResult.error) {
        return {
          success: false,
          error: `Failed to get rate limit configuration: ${configResult.error}`,
          details: configResult,
        };
      }

      const maxRequests = configResult.maxRequests || 100;
      const windowMinutes = configResult.windowMinutes || 1;

      // Try to reach exactly the rate limit boundary
      const results = [];
      let remaining = null;
      let reset = null;

      // Keep sending requests until we're at exactly 1 remaining
      for (let i = 0; i < maxRequests; i++) {
        const result = await fetchWithErrorHandling(`${apiEndpoint}/api/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: `Rate limit boundary test ${i + 1}`,
          }),
        });

        // Extract rate limit headers
        remaining = result.headers?.["x-ratelimit-remaining"];
        reset = result.headers?.["x-ratelimit-reset"];

        results.push({
          requestNumber: i + 1,
          success: !result.error,
          remaining,
          reset,
          error: result.error,
        });

        // Stop if we're at 1 remaining request
        if (remaining === "1") {
          break;
        }

        // Stop if we hit an error
        if (result.error) {
          break;
        }
      }

      // Now make the final request that should be the last allowed one
      const boundaryResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: "Final request at boundary",
          }),
        }
      );

      results.push({
        requestNumber: results.length + 1,
        success: !boundaryResult.error,
        remaining: boundaryResult.headers?.["x-ratelimit-remaining"],
        reset: boundaryResult.headers?.["x-ratelimit-reset"],
        error: boundaryResult.error,
        isBoundary: true,
      });

      // Now make one more request that should exceed the limit
      const exceedResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: "Request exceeding boundary",
          }),
        }
      );

      results.push({
        requestNumber: results.length + 1,
        success: !exceedResult.error,
        remaining: exceedResult.headers?.["x-ratelimit-remaining"],
        reset: exceedResult.headers?.["x-ratelimit-reset"],
        error: exceedResult.error,
        isExceeding: true,
      });

      // Wait for the rate limit window to reset
      const resetTime = parseInt(reset, 10) * 1000; // Convert to milliseconds
      const currentTime = Date.now();
      const timeToWait = Math.max(0, resetTime - currentTime) + 1000; // Add a buffer

      await new Promise((resolve) => setTimeout(resolve, timeToWait));

      // Make a request after reset
      const resetResult = await fetchWithErrorHandling(
        `${apiEndpoint}/api/echo`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            message: "Request after reset",
          }),
        }
      );

      results.push({
        requestNumber: results.length + 1,
        success: !resetResult.error,
        remaining: resetResult.headers?.["x-ratelimit-remaining"],
        reset: resetResult.headers?.["x-ratelimit-reset"],
        error: resetResult.error,
        isAfterReset: true,
      });

      // Analyze boundary behavior
      const boundaryRequest = results.find((r) => r.isBoundary);
      const exceedingRequest = results.find((r) => r.isExceeding);
      const resetRequest = results.find((r) => r.isAfterReset);

      const boundaryBehaviorCorrect =
        boundaryRequest?.success &&
        !exceedingRequest?.success &&
        exceedingRequest?.error?.includes("RateLimit") &&
        resetRequest?.success;

      return {
        success: boundaryBehaviorCorrect,
        error: !boundaryBehaviorCorrect
          ? "Rate limit boundary behavior not as expected"
          : null,
        details: {
          maxRequests,
          windowMinutes,
          requestsMade: results.length,
          boundaryRequest,
          exceedingRequest,
          resetRequest,
          boundaryBehaviorCorrect,
          results: results.slice(-5), // Just include the last 5 results
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        details: { stack: error.stack },
      };
    }
  },
};

module.exports = performanceTests;
