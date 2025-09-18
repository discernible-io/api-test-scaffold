/**
 * Metrics Routes Tests
 * 
 * Tests for the metrics endpoints functionality in the API
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
// Import SDK components using the new interface
const { logger, stateManager } = require('../../sdk');
const { captureTestData } = require('./test-utils');

/**
 * Metrics tests module
 */
const metricsTests = {
  /**
   * Test metrics endpoints
   * This test verifies:
   * 1. The metrics endpoints return valid data
   * 2. The data format is consistent
   * 3. System metrics are available
   */
  testMetricsEndpoints: async (apiEndpoint) => {
    const moduleName = "metrics";
    const testName = "testMetricsEndpoints";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/metrics`;

    logger.info("Starting metrics endpoints test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Function to create headers
      const getHeaders = () => ({
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      });

      // Test 1: Get system metrics
      const systemMetricsResult = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/system`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.systemMetricsResult = systemMetricsResult;

      // Validate system metrics response
      if (!systemMetricsResult || typeof systemMetricsResult !== 'object') {
        const result = {
          success: false,
          error: "System metrics endpoint did not return valid data",
          details: systemMetricsResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for required system metrics fields
      const requiredSystemFields = ['cpu', 'memory', 'uptime'];
      const missingSystemFields = requiredSystemFields.filter(field => 
        !systemMetricsResult.hasOwnProperty(field)
      );

      if (missingSystemFields.length > 0) {
        const result = {
          success: false,
          error: `System metrics missing required fields: ${missingSystemFields.join(', ')}`,
          details: { 
            missingFields: missingSystemFields,
            availableFields: Object.keys(systemMetricsResult)
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Get API metrics
      const apiMetricsResult = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/api`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.apiMetricsResult = apiMetricsResult;

      // Validate API metrics response
      if (!apiMetricsResult || typeof apiMetricsResult !== 'object') {
        const result = {
          success: false,
          error: "API metrics endpoint did not return valid data",
          details: apiMetricsResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for required API metrics fields
      const requiredApiFields = ['requests', 'response_time'];
      const missingApiFields = requiredApiFields.filter(field => 
        !apiMetricsResult.hasOwnProperty(field)
      );

      if (missingApiFields.length > 0) {
        const result = {
          success: false,
          error: `API metrics missing required fields: ${missingApiFields.join(', ')}`,
          details: { 
            missingFields: missingApiFields,
            availableFields: Object.keys(apiMetricsResult)
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 3: Get sessions metrics
      const sessionsMetricsResult = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/sessions`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      testData.sessionsMetricsResult = sessionsMetricsResult;

      // Validate sessions metrics response
      if (!sessionsMetricsResult || typeof sessionsMetricsResult !== 'object') {
        const result = {
          success: false,
          error: "Sessions metrics endpoint did not return valid data",
          details: sessionsMetricsResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for required sessions metrics fields
      const requiredSessionsFields = ['active', 'total'];
      const missingSessionsFields = requiredSessionsFields.filter(field => 
        !sessionsMetricsResult.hasOwnProperty(field)
      );

      if (missingSessionsFields.length > 0) {
        const result = {
          success: false,
          error: `Sessions metrics missing required fields: ${missingSessionsFields.join(', ')}`,
          details: { 
            missingFields: missingSessionsFields,
            availableFields: Object.keys(sessionsMetricsResult)
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        success: true,
        details: {
          systemMetricsValid: missingSystemFields.length === 0,
          apiMetricsValid: missingApiFields.length === 0,
          sessionsMetricsValid: missingSessionsFields.length === 0,
          systemMetricsFields: Object.keys(systemMetricsResult),
          apiMetricsFields: Object.keys(apiMetricsResult),
          sessionsMetricsFields: Object.keys(sessionsMetricsResult),
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Metrics endpoints test error", {
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
   * Test metrics data accuracy
   * This test verifies:
   * 1. Metrics data is accurate by making requests and checking if they're counted
   * 2. Performance metrics reflect actual system state
   */
  testMetricsAccuracy: async (apiEndpoint) => {
    const moduleName = "metrics";
    const testName = "testMetricsAccuracy";
    const correlationId = ulid();
    const testData = { apiEndpoint };
    testData.endpoint = `${apiEndpoint}/api/metrics`;

    logger.info("Starting metrics accuracy test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      // Function to create headers
      const getHeaders = () => ({
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      });

      // Get initial API metrics to establish baseline
      const initialApiMetrics = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/api`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      if (!initialApiMetrics || !initialApiMetrics.requests || typeof initialApiMetrics.requests.total !== 'number') {
        const result = {
          success: false,
          error: "Could not get initial API metrics for baseline",
          details: initialApiMetrics,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const initialRequestCount = initialApiMetrics.requests.total;
      testData.initialRequestCount = initialRequestCount;

      // Make a series of API requests to increment counters
      const requestCount = 3;
      const testEndpoint = `${apiEndpoint}/api/echo`;
      const testRequests = [];

      for (let i = 0; i < requestCount; i++) {
        testRequests.push(
          fetch(testEndpoint, {
            method: "GET",
            headers: getHeaders(),
          })
        );
      }

      // Wait for all requests to complete
      await Promise.all(testRequests);

      // Get updated API metrics
      const updatedApiMetrics = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/api`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      if (!updatedApiMetrics || !updatedApiMetrics.requests || typeof updatedApiMetrics.requests.total !== 'number') {
        const result = {
          success: false,
          error: "Could not get updated API metrics",
          details: updatedApiMetrics,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const updatedRequestCount = updatedApiMetrics.requests.total;
      testData.updatedRequestCount = updatedRequestCount;

      // Check if request count increased by at least the number of test requests
      // Note: Other concurrent requests might also increment the counter, so we check for >= not ===
      const requestCountDifference = updatedRequestCount - initialRequestCount;
      const requestCountAccurate = requestCountDifference >= requestCount;

      if (!requestCountAccurate) {
        const result = {
          success: false,
          error: `Request count metrics not accurate: expected increase of at least ${requestCount}, got ${requestCountDifference}`,
          details: {
            initialCount: initialRequestCount,
            updatedCount: updatedRequestCount,
            difference: requestCountDifference,
            expectedMinimumDifference: requestCount,
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check system metrics for reasonable values
      const systemMetrics = await stateManager.fetchWithErrorHandling(
        `${apiEndpoint}/api/metrics/system`,
        {
          method: "GET",
          headers: getHeaders(),
        }
      );

      if (!systemMetrics || typeof systemMetrics !== 'object') {
        const result = {
          success: false,
          error: "Could not get system metrics",
          details: systemMetrics,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Validate CPU usage is a reasonable percentage
      const cpuUsageValid = 
        typeof systemMetrics.cpu === 'object' && 
        typeof systemMetrics.cpu.usage === 'number' && 
        systemMetrics.cpu.usage >= 0 && 
        systemMetrics.cpu.usage <= 100;

      // Validate memory usage is a reasonable value
      const memoryUsageValid = 
        typeof systemMetrics.memory === 'object' && 
        typeof systemMetrics.memory.used === 'number' && 
        typeof systemMetrics.memory.total === 'number' && 
        systemMetrics.memory.used >= 0 && 
        systemMetrics.memory.used <= systemMetrics.memory.total;

      // All tests passed
      const result = {
        success: true,
        details: {
          requestCountAccurate,
          requestCountDifference,
          cpuUsageValid,
          memoryUsageValid,
          cpuUsage: systemMetrics.cpu?.usage,
          memoryUsed: systemMetrics.memory?.used,
          memoryTotal: systemMetrics.memory?.total,
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      logger.error("Metrics accuracy test error", {
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

module.exports = metricsTests;
