// rate-limiting.js - Consolidated version

const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');

const { captureTestData } = require("./test-utils");
/**
 * Consolidated Rate Limiting Tests Module
 */
const rateLimitTests = {
  /**
   * Comprehensive rate limit test that checks enforcement, headers, and behavior
   */
  testRateLimiting: async (trl_api_ep) => {
    const moduleName = "rate-limiting";
    const testName = "testRateLimiting";
    const correlationId = ulid();
    const testData = { trl_api_ep };
    testData.endpoint = `${trl_api_ep}/api/noncets`; // Set explicit endpoint

    // Log test start
    logger.info("Starting comprehensive rate limit test", {
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
      // PART 1: Check for rate limit headers in normal response
      logger.info("Test phase: Rate limit headers check", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "header_check",
      });

      // Make a single request and check for rate limit headers
      const headerCheckResponse = await fetch(`${trl_api_ep}/api/noncets`, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Request-ID": ulid(),
        },
      });

      // Collect header information
      const rateLimitHeaders = {};
      const headerPatterns = ["rate", "limit", "remain", "reset", "retry"];

      // Check each header for rate limit related information
      headerPatterns.forEach(pattern => {
        for (const [key, value] of headerCheckResponse.headers.entries()) {
          if (key.toLowerCase().includes(pattern)) {
            rateLimitHeaders[key] = value;
          }
        }
      });

      const hasRateLimitHeaders = Object.keys(rateLimitHeaders).length > 0;
      testData.rateLimitHeaders = rateLimitHeaders;
      testData.hasRateLimitHeaders = hasRateLimitHeaders;

      // PART 2: Test high load behavior
      logger.info("Test phase: High load behavior testing", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "high_load",
      });

      // Get config_own_rodit to determine rate limits (if available)
      const config_own_rodit = await stateManager.getConfigOwnRodit();
      const maxRequests = config_own_rodit?.own_rodit?.metadata?.maxrequests || 100;
      const maxrqwindow = config_own_rodit?.own_rodit?.metadata?.maxrqwindow || 15;
      
      testData.maxRequests = maxRequests;
      testData.maxrqwindow = maxrqwindow;

      // Number of concurrent requests to send
      const concurrentRequests = 10;
      // Number of batches to send
      const batchCount = 3;

      // Function to send a single request and get response
      const sendRequest = async (batchNum, requestNum) => {
        const startTime = Date.now();
        
        const response = await fetch(`${trl_api_ep}/api/noncets`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: `High load test - batch ${batchNum}, request ${requestNum}`,
          }),
        });

        const endTime = Date.now();
        const duration = endTime - startTime;

        let error = null;
        if (response.status === 429) {
          error = "RateLimitExceeded";
        } else if (!response.ok) {
          error = `HTTP error: ${response.status}`;
        }

        // Get rate limit headers if they exist
        const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining") || 
                                  response.headers.get("x-ratelimit-remaining");

        return {
          batchNum,
          requestNum,
          duration,
          status: response.status,
          success: response.ok && !error,
          rateLimitRemaining,
          error,
          hasRateLimitHeaders: !!rateLimitRemaining
        };
      };

      const batchResults = [];

      // Send batches of concurrent requests
      for (let batch = 0; batch < batchCount; batch++) {
        logger.debug("Sending concurrent batch", {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          batch: batch + 1,
          concurrentRequests,
        });

        const batchPromises = [];

        // Create the batch of concurrent requests
        for (let i = 0; i < concurrentRequests; i++) {
          batchPromises.push(sendRequest(batch + 1, i + 1));
        }

        // Wait for all requests in the batch to complete
        const results = await Promise.all(batchPromises);

        batchResults.push({
          batchNum: batch + 1,
          results,
          successCount: results.filter((r) => r.success).length,
          failureCount: results.filter((r) => !r.success).length,
          rateLimitHits: results.filter((r) => r.error === "RateLimitExceeded").length,
        });

        // Add delay between batches
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Analyze the results
      const totalRequests = batchCount * concurrentRequests;
      const successfulRequests = batchResults.reduce(
        (sum, batch) => sum + batch.successCount, 0
      );
      const rateLimitHits = batchResults.reduce(
        (sum, batch) => sum + batch.rateLimitHits, 0
      );

      // Calculate success rate
      const successRate = (successfulRequests / totalRequests) * 100;

      // Check if we hit rate limits
      const hitRateLimits = rateLimitHits > 0;

      // Check if later batches had more rate limit hits (as expected)
      const increasingRateLimits = batchResults.length > 1 &&
        batchResults.slice(1).some((batch, i) => 
          batch.rateLimitHits > batchResults[i].rateLimitHits
        );

      testData.batchResults = batchResults;
      testData.totalRequests = totalRequests;
      testData.successfulRequests = successfulRequests;
      testData.rateLimitHits = rateLimitHits;
      testData.successRate = successRate;
      testData.hitRateLimits = hitRateLimits;
      testData.increasingRateLimits = increasingRateLimits;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        hasRateLimitHeaders,
        hitRateLimits,
        successRate: successRate.toFixed(2) + "%",
      });

      const result = {
        success: hasRateLimitHeaders || hitRateLimits, // Success if we have headers OR hit limits
        details: {
          rateLimitHeaders: {
            present: hasRateLimitHeaders,
            headers: rateLimitHeaders
          },
          highLoad: {
            concurrentRequests,
            batchCount,
            totalRequests,
            successfulRequests,
            rateLimitHits,
            successRate: successRate.toFixed(2) + "%",
            hitRateLimits,
            increasingRateLimits,
            batchSummary: batchResults.map((batch) => ({
              batchNum: batch.batchNum,
              successCount: batch.successCount,
              failureCount: batch.failureCount,
              rateLimitHits: batch.rateLimitHits,
            })),
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

module.exports = rateLimitTests;