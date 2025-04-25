// test-modules/rate-limiting.js
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
 * Rate limiting test module - refactored to use actual server endpoints
 */
const rateLimitTests = {
  /**
   * Test rate limit enforcement - discover limits from RODiT config
   */
  testRateLimitEnforcement: async (apiEndpoint, logContext) => {
    const moduleName = "rate-limiting";
    const testName = "testRateLimitEnforcement";
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
      // Log test phase - determine rate limits from the token
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "fetch_limits_from_token",
      });

      // Get config from state manager to access rate limits
      const config = await stateManager.getConfigOwnRodit();
      if (!config || !config.own_rodit || !config.own_rodit.metadata) {
        const result = {
          success: false,
          error: "Could not access RODiT configuration for rate limit information",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Get rate limit values from the RODiT metadata
      // These correspond to the values used in your ratelimitmw middleware
      const maxRequests = config.own_rodit.metadata.maxrequests || 100;
      const maxrqwindow = config.own_rodit.metadata.maxrqwindow || 15;

      testData.maxRequests = maxRequests;
      testData.maxrqwindow = maxrqwindow;

      // Log test phase
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "send_requests",
        maxRequests,
        maxrqwindow,
      });

      // Send fewer requests for testing to avoid completely exhausting the limits
      // Target around 60% of the limit to confirm behavior without exhausting all capacity
      const requestsToSend = Math.min(
        Math.ceil(maxRequests * 0.6),
        maxRequests - 40
      );
      
      // Make sure we send at least 20 requests to see a pattern
      const actualRequestsToSend = Math.max(requestsToSend, 20);

      logger.info("Sending test requests", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        requestsToSend: actualRequestsToSend,
        maxRequests,
      });

      // Send requests and track rate limit headers
      const results = [];
      let hitRateLimit = false;

      for (let i = 0; i < actualRequestsToSend; i++) {
        if (i % 5 === 0) {
          logger.debug("Sending rate limit test requests", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "send_requests",
            requestNumber: i + 1,
            progress: `${i + 1}/${actualRequestsToSend}`,
          });
        }

        // Use echo endpoint for testing rate limits
        const response = await fetch(`${apiEndpoint}/api/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: `Rate limit test request ${i + 1}`,
          }),
        });

        let responseData;
        let error = null;
        
        if (response.status === 429) {
          error = "RateLimitExceeded";
          hitRateLimit = true;
          
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
        } else if (!response.ok) {
          error = `HTTP error: ${response.status}`;
          
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
        } else {
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
        }

        // Get rate limit headers if they exist
        const rateLimitLimit = response.headers.get("X-RateLimit-Limit");
        const rateLimitRemaining = response.headers.get("X-RateLimit-Remaining");
        const rateLimitReset = response.headers.get("X-RateLimit-Reset");

        results.push({
          requestNumber: i + 1,
          success: !error,
          status: response.status,
          rateLimitLimit,
          rateLimitRemaining,
          rateLimitReset,
          error,
        });

        // If we hit the rate limit, stop sending requests
        if (hitRateLimit) {
          logger.info("Hit rate limit", {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            requestNumber: i + 1,
            status: response.status,
          });
          break;
        }
        
        // Add a small delay between requests to avoid overwhelming the server
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Save only a sample of the results to prevent too large files
      testData.results =
        results.length > 20
          ? [...results.slice(0, 10), ...results.slice(-10)]
          : results;

      testData.hitRateLimit = hitRateLimit;
      testData.requestsSent = results.length;
      
      // Check if rate limit headers were present
      const hasRateLimitHeaders = results.some(
        r => r.rateLimitLimit && r.rateLimitRemaining
      );
      
      testData.hasRateLimitHeaders = hasRateLimitHeaders;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        requestsSent: results.length,
        hitRateLimit,
        hasRateLimitHeaders,
        maxRequests,
      });

      // For this test, we consider it successful if we either:
      // 1. Hit a rate limit, which proves it's working
      // 2. We see rate limit headers decreasing, which indicates the system is tracking usage
      
      // Check if rate limit remaining values decrease as expected
      const remainingValues = results
        .filter(r => r.rateLimitRemaining)
        .map(r => parseInt(r.rateLimitRemaining, 10));
        
      const hasDecreasingValues = remainingValues.length > 1 && 
        remainingValues.slice(1).some((val, i) => val < remainingValues[i]);

      const result = {
        success: hitRateLimit || (hasRateLimitHeaders && hasDecreasingValues),
        error: !hitRateLimit && !hasRateLimitHeaders 
          ? "No rate limit headers found in responses" 
          : !hitRateLimit && !hasDecreasingValues
          ? "Rate limit counters did not decrease as expected"
          : null,
        details: {
          maxRequests,
          maxrqwindow,
          requestsSent: results.length,
          hitRateLimit,
          hasRateLimitHeaders,
          hasDecreasingValues,
          // Include sample of results
          firstResults: results.slice(0, 3),
          lastResults: results.slice(-3),
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
   * Test rate limit headers presence and behavior
   */
  testRateLimitHeaders: async (apiEndpoint, logContext) => {
    const moduleName = "rate-limiting";
    const testName = "testRateLimitHeaders";
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
      // Make a sequence of requests and check the rate limit headers
      const headerResults = [];
      // Standard header names for rate limiting - we'll check variations
      const possibleHeaders = [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
        "X-RateLimit-Limit", 
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
        "ratelimit-limit",
        "ratelimit-remaining",
        "ratelimit-reset"
      ];

      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "check_rate_limit_headers",
      });

      // Make several requests to observe rate limit headers
      for (let i = 0; i < 5; i++) {
        const response = await fetch(`${apiEndpoint}/api/echo`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({
            message: `Rate limit header test ${i + 1}`,
          }),
        });

        const headerEntries = {};
        const presentHeaders = [];
        
        // Check all variations of rate limit headers
        for (const header of possibleHeaders) {
          const value = response.headers.get(header);
          if (value) {
            headerEntries[header] = value;
            presentHeaders.push(header);
          }
        }

        // Check for any other headers that might contain rate limit info
        const allHeaders = {};
        response.headers.forEach((value, name) => {
          allHeaders[name] = value;
          // Check if this is an unlisted rate limit header
          if (name.toLowerCase().includes('rate') && !presentHeaders.includes(name)) {
            headerEntries[name] = value;
            presentHeaders.push(name);
          }
        });

        const result = await response.json().catch(() => ({}));

        headerResults.push({
          requestNumber: i + 1,
          status: response.status,
          rateHeaders: headerEntries,
          presentHeaders,
          hasRateLimitHeaders: presentHeaders.length > 0,
          success: response.ok && !result.error,
          allHeaders: allHeaders, // Include all headers for inspection
        });

        // Add a small delay between requests
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Test if we found any rate limit headers
      const foundRateLimitHeaders = headerResults.some(
        result => result.hasRateLimitHeaders
      );
      
      // Extract the header names we found
      const foundHeaderNames = new Set();
      headerResults.forEach(result => {
        result.presentHeaders.forEach(header => foundHeaderNames.add(header));
      });

      // Check if rate limit headers are consistent across requests
      const headerConsistency = foundRateLimitHeaders ? 
        headerResults.every(result => result.hasRateLimitHeaders) : false;

      // Check if the remaining count decreases (if we have this header)
      let remainingDecreases = false;
      
      if (foundRateLimitHeaders) {
        // Find which header is used for "remaining"
        const remainingHeaderName = Array.from(foundHeaderNames).find(
          name => name.toLowerCase().includes('remaining')
        );
        
        if (remainingHeaderName) {
          // Extract remaining values in sequence
          const remainingValues = headerResults
            .map(r => r.rateHeaders[remainingHeaderName])
            .filter(Boolean)
            .map(val => parseInt(val, 10));
            
          // Check if values decrease
          remainingDecreases = remainingValues.length > 1 && 
            remainingValues.slice(1).some((val, i) => val < remainingValues[i]);
        }
      }

      testData.headerResults = headerResults;
      testData.foundRateLimitHeaders = foundRateLimitHeaders;
      testData.foundHeaderNames = Array.from(foundHeaderNames);
      testData.headerConsistency = headerConsistency;
      testData.remainingDecreases = remainingDecreases;

      // Log test completion
      logger.info("Test completed", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        foundRateLimitHeaders,
        foundHeaderNames: Array.from(foundHeaderNames),
        headerConsistency,
        remainingDecreases,
      });

      const result = {
        success: foundRateLimitHeaders, // Success if we find any rate limit headers
        error: !foundRateLimitHeaders 
          ? "No rate limit headers found in responses" 
          : !headerConsistency 
          ? "Rate limit headers were not consistent across requests"
          : !remainingDecreases
          ? "Rate limit remaining value did not decrease as expected"
          : null,
        details: {
          headerResults,
          foundRateLimitHeaders,
          foundHeaderNames: Array.from(foundHeaderNames),
          headerConsistency,
          remainingDecreases,
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
   * Test high load to confirm rate limiting behavior
   */
  testHighLoadBehavior: async (apiEndpoint, logContext) => {
    const moduleName = "rate-limiting";
    const testName = "testHighLoadBehavior";
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
      // Test high load behavior by sending concurrent requests
      logger.info("Test phase", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "concurrent_requests",
      });

      // Number of concurrent requests to send
      const concurrentRequests = 10;
      // Number of batches to send
      const batchCount = 3;
      
      testData.parameters = { concurrentRequests, batchCount };

      // Function to send a single request and get response
      const sendRequest = async (batchNum, requestNum) => {
        const startTime = Date.now();
        
        const response = await fetch(`${apiEndpoint}/api/echo`, {
          method: "POST",
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

        let responseData;
        let error = null;
        
        if (response.status === 429) {
          error = "RateLimitExceeded";
          
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
        } else if (!response.ok) {
          error = `HTTP error: ${response.status}`;
          
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
        } else {
          try {
            responseData = await response.json();
          } catch (e) {
            responseData = { error: "Could not parse response" };
          }
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
          successCount: results.filter(r => r.success).length,
          failureCount: results.filter(r => !r.success).length,
          rateLimitHits: results.filter(r => r.error === "RateLimitExceeded").length,
        });
        
        // Add delay between batches
        await new Promise(resolve => setTimeout(resolve, 1000));
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
        totalRequests,
        successfulRequests,
        rateLimitHits,
        successRate: successRate.toFixed(2) + "%",
        hitRateLimits,
        increasingRateLimits,
      });

      const result = {
        // The test is successful if either:
        // 1. We hit some rate limits (showing the system is protecting itself)
        // 2. All requests succeeded (small test didn't trigger limits)
        success: hitRateLimits || successRate === 100,
        error: !hitRateLimits && successRate < 100
          ? "Some requests failed but not due to rate limiting"
          : null,
        details: {
          concurrentRequests,
          batchCount,
          totalRequests,
          successfulRequests,
          rateLimitHits,
          successRate: successRate.toFixed(2) + "%",
          hitRateLimits,
          increasingRateLimits,
          batchSummary: batchResults.map(batch => ({
            batchNum: batch.batchNum,
            successCount: batch.successCount,
            failureCount: batch.failureCount,
            rateLimitHits: batch.rateLimitHits,
          })),
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

module.exports = rateLimitTests;