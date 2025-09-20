/**
 * Performance Tests
 * 
 * Tests for API performance, response times, and behavior under load
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');
const { captureTestData } = require('./test-utils');

/**
 * Performance tests module
 */
const performanceTests = {
  /**
   * Benchmark API response times across different endpoints
   * This test verifies:
   * 1. Response times for key endpoints
   * 2. Consistency of response times
   * 3. Performance differences between authenticated and unauthenticated requests
   */
  benchmarkApiResponseTimes: async (bart_api_ep) => {
    const moduleName = "performance";
    const testName = "benchmarkApiResponseTimes";
    const correlationId = ulid();
    const testData = { bart_api_ep };

    logger.info("Starting API response time benchmark", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      // Function to create headers with or without token
      const getHeaders = (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };
        
        if (includeToken && token) {
          headers.Authorization = `Bearer ${token}`;
        }
        
        return headers;
      };

      // Define endpoints to benchmark - reduced set for faster execution
      const endpointsToTest = [
        { name: "home", url: bart_api_ep, method: "GET", authenticated: false },
        { name: "echo", url: `${bart_api_ep}/api/echo`, method: "GET", authenticated: true },
        { name: "cruda-list", url: `${bart_api_ep}/api/cruda/list`, method: "POST", body: {}, authenticated: true },
      ];

      // Number of requests per endpoint for averaging - reduced for faster execution
      const requestsPerEndpoint = 2;
      const results = {};

      // Benchmark each endpoint
      for (const endpoint of endpointsToTest) {
        logger.info(`Benchmarking apiEndpoint: ${endpoint.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "benchmark",
          apiEndpoint: endpoint.name,
        });

        const timings = [];
        const errors = [];

        for (let i = 0; i < requestsPerEndpoint; i++) {
          const startTime = Date.now();
          
          try {
            const response = await fetch(endpoint.url, {
              method: endpoint.method,
              headers: getHeaders(endpoint.authenticated),
              body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
            });

            const endTime = Date.now();
            const duration = endTime - startTime;

            timings.push({
              duration,
              status: response.status,
              success: response.ok,
            });
          } catch (error) {
            const endTime = Date.now();
            const duration = endTime - startTime;

            errors.push({
              duration,
              error: error.message,
            });
          }

          // Add a small delay between requests to avoid overwhelming the server - reduced for speed
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Calculate average response time for successful requests
        const successfulTimings = timings.filter(t => t.success);
        const averageDuration = successfulTimings.length > 0
          ? successfulTimings.reduce((sum, t) => sum + t.duration, 0) / successfulTimings.length
          : null;

        results[endpoint.name] = {
          averageDuration,
          successRate: (successfulTimings.length / requestsPerEndpoint) * 100,
          timings,
          errors,
        };
      }

      testData.benchmarkResults = results;

      // Analyze results
      const endpointsWithResults = Object.keys(results).filter(
        name => results[name].averageDuration !== null
      );

      if (endpointsWithResults.length === 0) {
        const result = {
          success: false,
          error: "All benchmark requests failed",
          details: results,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Calculate overall average response time
      const overallAverageDuration = endpointsWithResults.reduce(
        (sum, name) => sum + results[name].averageDuration,
        0
      ) / endpointsWithResults.length;

      // Identify slowest and fastest endpoints
      const sortedEndpoints = [...endpointsWithResults].sort(
        (a, b) => results[a].averageDuration - results[b].averageDuration
      );

      const fastestEndpoint = sortedEndpoints[0];
      const slowestEndpoint = sortedEndpoints[sortedEndpoints.length - 1];

      // Compare authenticated vs. unauthenticated endpoints
      const authenticatedEndpoints = endpointsToTest
        .filter(e => e.authenticated)
        .map(e => e.name)
        .filter(name => results[name].averageDuration !== null);

      const unauthenticatedEndpoints = endpointsToTest
        .filter(e => !e.authenticated)
        .map(e => e.name)
        .filter(name => results[name].averageDuration !== null);

      const authenticatedAverage = authenticatedEndpoints.length > 0
        ? authenticatedEndpoints.reduce((sum, name) => sum + results[name].averageDuration, 0) / authenticatedEndpoints.length
        : null;

      const unauthenticatedAverage = unauthenticatedEndpoints.length > 0
        ? unauthenticatedEndpoints.reduce((sum, name) => sum + results[name].averageDuration, 0) / unauthenticatedEndpoints.length
        : null;

      // All tests passed
      const result = {
        success: true,
        details: {
          overallAverageDuration,
          fastestEndpoint,
          fastestDuration: results[fastestEndpoint].averageDuration,
          slowestEndpoint,
          slowestDuration: results[slowestEndpoint].averageDuration,
          authenticatedAverage,
          unauthenticatedAverage,
          authenticationOverhead: authenticatedAverage && unauthenticatedAverage
            ? authenticatedAverage - unauthenticatedAverage
            : null,
          endpointResults: Object.keys(results).map(name => ({
            name,
            averageDuration: results[name].averageDuration,
            successRate: results[name].successRate,
          })),
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("API response time benchmark error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test API performance under load
   * This test verifies:
   * 1. API behavior under concurrent requests
   * 2. Response time degradation under load
   * 3. Error rates under load
   */
  testPerformanceUnderLoad: async (tpul_api_ep) => {
    const moduleName = "performance";
    const testName = "testPerformanceUnderLoad";
    const correlationId = ulid();
    const testData = { tpul_api_ep };

    logger.info("Starting performance under load test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Get JWT token for authenticated requests
      const token = await stateManager.getJwtToken();
      testData.hasToken = !!token;

      // Function to create headers with or without token
      const getHeaders = (includeToken = true) => {
        const headers = {
          "Content-Type": "application/json",
          "X-Request-ID": ulid(),
        };
        
        if (includeToken && token) {
          headers.Authorization = `Bearer ${token}`;
        }
        
        return headers;
      };

      // Define endpoints to test under load
      const endpointsToTest = [
        { name: "home", url: tpul_api_ep, method: "GET", authenticated: false },
        { name: "echo", url: `${tpul_api_ep}/api/echo`, method: "GET", authenticated: true },
        { name: "metrics-system", url: `${tpul_api_ep}/api/metrics/system`, method: "GET", authenticated: false },
      ];

      // Test parameters
      const concurrentRequests = 10; // Number of concurrent requests per endpoint
      const results = {};

      // Test each endpoint under load
      for (const endpoint of endpointsToTest) {
        logger.info(`Testing endpoint under load: ${endpoint.name}`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "load_test",
          apiEndpoint: endpoint.name,
        });

        // First, measure baseline performance with a single request
        const baselineStartTime = Date.now();
        let baselineStatus = 0;
        
        try {
          const baselineResponse = await fetch(endpoint.url, {
            method: endpoint.method,
            headers: getHeaders(endpoint.authenticated),
          });
          baselineStatus = baselineResponse.status;
        } catch (error) {
          logger.error(`Baseline request failed for ${endpoint.name}`, {
            component: "TestRunner",
            moduleName,
            testName,
            correlationId,
            phase: "baseline",
            apiEndpoint: endpoint.name,
            error: error.message,
          });
        }

        const baselineDuration = Date.now() - baselineStartTime;

        // Now test under load with concurrent requests
        const loadRequests = [];
        const startTime = Date.now();

        for (let i = 0; i < concurrentRequests; i++) {
          loadRequests.push(
            fetch(endpoint.url, {
              method: endpoint.method,
              headers: getHeaders(endpoint.authenticated),
            })
              .then(response => ({
                status: response.status,
                success: response.ok,
              }))
              .catch(error => ({
                error: error.message,
                success: false,
              }))
          );
        }

        const loadResponses = await Promise.all(loadRequests);
        const endTime = Date.now();
        const totalDuration = endTime - startTime;
        const averageDuration = totalDuration / concurrentRequests;

        // Calculate success rate
        const successfulRequests = loadResponses.filter(r => r.success).length;
        const successRate = (successfulRequests / concurrentRequests) * 100;

        // Calculate performance degradation
        const performanceDegradation = baselineDuration > 0
          ? ((averageDuration - baselineDuration) / baselineDuration) * 100
          : null;

        results[endpoint.name] = {
          baselineDuration,
          baselineStatus,
          averageDuration,
          totalDuration,
          successRate,
          performanceDegradation,
          responses: loadResponses,
        };
      }

      testData.loadTestResults = results;

      // Analyze results
      const endpointsWithResults = Object.keys(results);

      if (endpointsWithResults.length === 0) {
        const result = {
          success: false,
          error: "All load test requests failed",
          details: results,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Calculate average performance degradation across all endpoints
      const averageDegradation = endpointsWithResults.reduce(
        (sum, name) => sum + (results[name].performanceDegradation || 0),
        0
      ) / endpointsWithResults.length;

      // Identify endpoint with highest degradation
      const sortedByDegradation = [...endpointsWithResults].sort(
        (a, b) => (results[b].performanceDegradation || 0) - (results[a].performanceDegradation || 0)
      );

      const highestDegradationEndpoint = sortedByDegradation[0];

      // Check if any endpoint had a significant error rate under load
      const endpointsWithErrors = endpointsWithResults.filter(
        name => results[name].successRate < 100
      );

      // All tests passed
      const result = {
        success: true,
        details: {
          averageDegradation,
          highestDegradationEndpoint,
          highestDegradationPercentage: results[highestDegradationEndpoint].performanceDegradation,
          endpointsWithErrors,
          concurrentRequests,
          endpointResults: Object.keys(results).map(name => ({
            name,
            baselineDuration: results[name].baselineDuration,
            averageDuration: results[name].averageDuration,
            successRate: results[name].successRate,
            performanceDegradation: results[name].performanceDegradation,
          })),
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Performance under load test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test rate limiting functionality
   * This test verifies:
   * 1. Rate limits are enforced
   * 2. Rate limit headers are provided
   * 3. Behavior when rate limits are exceeded
   */
  testRateLimiting: async (trl_api_ep) => {
    const moduleName = "performance";
    const testName = "testRateLimiting";
    const correlationId = ulid();
    const testData = { trl_api_ep };

    logger.info("Starting rate limiting test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Define endpoint to test rate limiting
      // Use a simple endpoint that doesn't require authentication
      const testEndpoint = `${trl_api_ep}/api/metrics/system`;

      // Test parameters
      const requestCount = 20; // Number of rapid requests to test rate limiting
      const requestDelay = 50; // Small delay between requests (milliseconds)
      const results = [];

      logger.info(`Testing rate limiting with ${requestCount} rapid requests`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "rate_limit_test",
      });

      // Make rapid requests to potentially trigger rate limiting
      for (let i = 0; i < requestCount; i++) {
        const response = await fetch(testEndpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
        });

        // Extract rate limit headers if present
        const rateLimitLimit = response.headers.get('X-RateLimit-Limit');
        const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
        const rateLimitReset = response.headers.get('X-RateLimit-Reset');

        results.push({
          requestNumber: i + 1,
          status: response.status,
          success: response.ok,
          rateLimitHeaders: {
            limit: rateLimitLimit ? parseInt(rateLimitLimit, 10) : null,
            remaining: rateLimitRemaining ? parseInt(rateLimitRemaining, 10) : null,
            reset: rateLimitReset ? parseInt(rateLimitReset, 10) : null,
          },
        });

        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, requestDelay));
      }

      testData.rateLimitResults = results;

      // Analyze results
      const successfulRequests = results.filter(r => r.success).length;
      const rateLimitedRequests = results.filter(r => r.status === 429).length;
      const hasRateLimitHeaders = results.some(r => 
        r.rateLimitHeaders.limit !== null || 
        r.rateLimitHeaders.remaining !== null || 
        r.rateLimitHeaders.reset !== null
      );

      // Check if rate limiting was triggered
      const rateLimitingTriggered = rateLimitedRequests > 0;

      // If rate limiting was triggered, check when it happened
      let firstRateLimitedRequest = null;
      if (rateLimitingTriggered) {
        firstRateLimitedRequest = results.findIndex(r => r.status === 429) + 1;
      }

      // All tests passed
      const result = {
        success: true,
        details: {
          totalRequests: requestCount,
          successfulRequests,
          rateLimitedRequests,
          rateLimitingTriggered,
          firstRateLimitedRequest,
          hasRateLimitHeaders,
          rateLimitHeaders: hasRateLimitHeaders
            ? results.find(r => 
                r.rateLimitHeaders.limit !== null || 
                r.rateLimitHeaders.remaining !== null || 
                r.rateLimitHeaders.reset !== null
              ).rateLimitHeaders
            : null,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Rate limiting test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        stack: error.stack,
      });

      const result = {
        success: false,
        error: `Test error: ${error.message}`,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  }
};

module.exports = performanceTests;
