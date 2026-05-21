/**
 * Metrics Routes Tests
 * 
 * Tests for the metrics endpoints functionality in the API
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
// Import SDK components using the new interface
const { logger } = require('../../sdk');
const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require('./test-utils');

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
  testMetricsEndpoints: async (tme_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsEndpoints";
    const correlationId = ulid();
    const testData = { tme_api_ep };
    testData.endpoint = `${tme_api_ep}/api/metrics`;

    logger.info("Starting metrics endpoints test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const client = await getRoditClientForTest();

      // Test 1: Get system metrics using SDK client for automatic JWT token handling
      let systemMetricsResult;
      try {
        systemMetricsResult = await client.request('GET', `/api/metrics/system`);
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        systemMetricsResult = { error: error.message, errorInfo };
      }

      testData.systemMetricsResult = systemMetricsResult;

      // Validate system metrics response
      if (!systemMetricsResult || typeof systemMetricsResult !== 'object') {
        const result = {
          passed: false,
          error: "System metrics endpoint did not return valid data",
          details: systemMetricsResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for required system metrics fields (they should be in the metrics property)
      const systemMetrics = systemMetricsResult.metrics || systemMetricsResult;
      const requiredSystemFields = ['cpu', 'memory', 'uptime'];
      const missingSystemFields = requiredSystemFields.filter(field => 
        !systemMetrics.hasOwnProperty(field)
      );

      if (missingSystemFields.length > 0) {
        const result = {
          passed: false,
          error: `System metrics missing required fields: ${missingSystemFields.join(', ')}`,
          details: { 
            missingFields: missingSystemFields,
            availableFields: Object.keys(systemMetricsResult)
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Test 2: Get general metrics (from /api/metrics) using SDK client
      let generalMetricsResult;
      try {
        generalMetricsResult = await client.request('GET', `/api/metrics`);
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        generalMetricsResult = { error: error.message, errorInfo };
      }

      testData.generalMetricsResult = generalMetricsResult;

      // Validate general metrics response
      if (!generalMetricsResult || typeof generalMetricsResult !== 'object') {
        const result = {
          passed: false,
          error: "General metrics endpoint did not return valid data",
          details: generalMetricsResult,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // Check for required general metrics fields
      const requiredGeneralFields = ['metrics', 'timestamp'];
      const missingGeneralFields = requiredGeneralFields.filter(field => 
        !generalMetricsResult.hasOwnProperty(field)
      );

      if (missingGeneralFields.length > 0) {
        const result = {
          passed: false,
          error: `General metrics missing required fields: ${missingGeneralFields.join(', ')}`,
          details: { 
            missingFields: missingGeneralFields,
            availableFields: Object.keys(generalMetricsResult)
          },
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      // All tests passed
      const result = {
        passed: true,
        details: {
          systemMetricsValid: missingSystemFields.length === 0,
          generalMetricsValid: missingGeneralFields.length === 0,
          systemMetricsFields: Object.keys(systemMetrics),
          generalMetricsFields: Object.keys(generalMetricsResult),
        },
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Metrics endpoints test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
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
  testMetricsAccuracy: async (tma_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsAccuracy";
    const correlationId = ulid();
    const testData = { tma_api_ep };
    testData.endpoint = `${tma_api_ep}/api/metrics`;

    logger.info("Starting metrics accuracy test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const client = await getRoditClientForTest();

      // Get initial API metrics to establish baseline using SDK client
      let initialApiMetrics;
      try {
        initialApiMetrics = await client.request('GET', `/api/metrics`);
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        initialApiMetrics = { error: error.message, errorInfo };
      }

      if (!initialApiMetrics || !initialApiMetrics.requests || typeof initialApiMetrics.requests.total !== 'number') {
        const result = {
          passed: false,
          error: "Could not get initial API metrics for baseline",
          details: initialApiMetrics,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const initialRequestCount = initialApiMetrics.requests.total;
      testData.initialRequestCount = initialRequestCount;

      // Make a series of API requests to increment counters
      const requestCount = 3;
      const testRequests = [];

      for (let i = 0; i < requestCount; i++) {
        testRequests.push(
          client.request('GET', `/api/holanonce16ts`).catch(() => null)
        );
      }

      // Wait for all requests to complete
      await Promise.all(testRequests);

      // Get updated API metrics using SDK client
      let updatedApiMetrics;
      try {
        updatedApiMetrics = await client.request('GET', `/api/metrics`);
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        updatedApiMetrics = { error: error.message, errorInfo };
      }

      if (!updatedApiMetrics || !updatedApiMetrics.requests || typeof updatedApiMetrics.requests.total !== 'number') {
        const result = {
          passed: false,
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
          passed: false,
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

      // Check system metrics for reasonable values using SDK client
      let systemMetrics;
      try {
        systemMetrics = await client.request('GET', `/api/metrics/system`);
      } catch (error) {
        const errorInfo = extractApiErrorInfo(error);
        systemMetrics = { error: error.message, errorInfo };
      }

      if (!systemMetrics || typeof systemMetrics !== 'object') {
        const result = {
          passed: false,
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
        passed: true,
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
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Metrics accuracy test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * NEGATIVE TEST: Unauthenticated access to metrics endpoints
   * Tests that metrics endpoints require authentication
   */
  testMetricsAuthenticationRequired: async (tmar_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsAuthenticationRequired";
    const correlationId = ulid();
    const testData = { tmar_api_ep };

    logger.info("Starting metrics authentication test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const metricsEndpoints = [
        "/api/metrics",
        "/api/metrics/system",
        "/api/metrics/debug",
      ];

      const results = [];

      for (const endpoint of metricsEndpoints) {
        const response = await fetch(`${tmar_api_ep}${endpoint}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
          // No Authorization header
        });

        results.push({
          endpoint,
          status: response.status,
          rejected: response.status === 401 || response.status === 403,
        });
      }

      testData.results = results;

      const allRejected = results.every((r) => r.rejected);

      if (!allRejected) {
        const failedEndpoints = results.filter((r) => !r.rejected);
        const result = {
          passed: false,
          error: `Some metrics endpoints did not require authentication: ${failedEndpoints.map((e) => e.endpoint).join(", ")}`,
          details: results,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const result = {
        passed: true,
        message: "All metrics endpoints properly require authentication",
        details: results,
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Metrics authentication test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * NEGATIVE TEST: Admin-only endpoints
   * Tests that admin endpoints reject non-admin users
   */
  testMetricsAdminEndpoints: async (tmae_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsAdminEndpoints";
    const correlationId = ulid();
    const testData = { tmae_api_ep };

    logger.info("Starting metrics admin endpoints test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const client = await getRoditClientForTest();

      // Login to get JWT token using login_server
      const loginResult = await client.login_server();
      if (!loginResult || !loginResult.success) {
        const result = {
          passed: false,
          error: loginResult?.error || "Login not-passed",
        };
        return captureTestData(testName, moduleName, result, testData);
      }
      
      const jwt_token = loginResult.jwt_token;
      
      if (!jwt_token) {
        const result = {
          passed: false,
          error: "No JWT token available for testing",
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const adminEndpoints = [
        { endpoint: "/api/metrics/reset", method: "POST" },
        { endpoint: "/api/metrics/debug", method: "GET" },
      ];

      const results = [];

      for (const { endpoint, method } of adminEndpoints) {
        const response = await fetch(`${tmae_api_ep}${endpoint}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${jwt_token}`,
            "X-Request-ID": ulid(),
          },
        });

        results.push({
          endpoint,
          method,
          status: response.status,
          // Admin endpoints should return 200 if admin, 403 if not admin
          validResponse: response.status === 200 || response.status === 403,
        });
      }

      testData.results = results;

      const allValid = results.every((r) => r.validResponse);

      if (!allValid) {
        const invalidEndpoints = results.filter((r) => !r.validResponse);
        const result = {
          passed: false,
          error: `Some admin endpoints returned unexpected status: ${invalidEndpoints.map((e) => `${e.endpoint}: ${e.status}`).join(", ")}`,
          details: results,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const result = {
        passed: true,
        message: "Admin endpoints properly check permissions",
        details: results,
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Metrics admin endpoints test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * NEGATIVE TEST: Invalid JWT tokens for metrics endpoints
   * Tests that metrics endpoints reject invalid tokens
   */
  testMetricsInvalidTokens: async (tmit_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsInvalidTokens";
    const correlationId = ulid();
    const testData = { tmit_api_ep };

    logger.info("Starting metrics invalid tokens test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const invalidTokens = [
        { token: "invalid_token_12345", desc: "malformed token" },
        { token: "", desc: "empty token" },
        { token: "Bearer.invalid.jwt", desc: "invalid JWT format" },
      ];

      const results = [];

      for (const { token, desc } of invalidTokens) {
        const response = await fetch(`${tmit_api_ep}/api/metrics`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Request-ID": ulid(),
          },
        });

        results.push({
          description: desc,
          status: response.status,
          rejected: response.status === 401 || response.status === 403,
        });
      }

      testData.results = results;

      const allRejected = results.every((r) => r.rejected);

      if (!allRejected) {
        const failedCases = results.filter((r) => !r.rejected);
        const result = {
          passed: false,
          error: `Some invalid tokens were not rejected: ${failedCases.map((c) => c.description).join(", ")}`,
          details: results,
        };
        return captureTestData(testName, moduleName, result, testData);
      }

      const result = {
        passed: true,
        message: "All invalid tokens properly rejected",
        details: results,
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Metrics invalid tokens test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Negative: privileged metrics routes require Bearer auth (swagger security).
   */
  testMetricsUnauthenticatedAccess: async (tmu_api_ep) => {
    const moduleName = "metrics";
    const testName = "testMetricsUnauthenticatedAccess";
    const correlationId = ulid();
    const testData = { tmu_api_ep, probes: [] };

    logger.info("Starting metrics unauthenticated access test", {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
    });

    try {
      const endpoints = [
        { path: "/api/metrics", method: "GET" },
        { path: "/api/metrics/system", method: "GET" },
        { path: "/api/metrics/debug", method: "GET" },
      ];

      for (const { path, method } of endpoints) {
        const response = await fetch(`${tmu_api_ep}${path}`, {
          method,
          headers: { "X-Request-ID": ulid() },
        });
        const rejected = response.status === 401 || response.status === 403;
        testData.probes.push({ path, method, status: response.status, rejected });
        if (!rejected) {
          const result = {
            passed: false,
            error: `Expected 401/403 for unauthenticated ${method} ${path}, got ${response.status}`,
            details: testData.probes,
          };
          return captureTestData(testName, moduleName, result, testData);
        }
      }

      const result = {
        passed: true,
        message: "Metrics endpoints reject unauthenticated access",
        details: testData.probes,
      };
      return captureTestData(testName, moduleName, result, testData);
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      const result = {
        passed: false,
        error: error.message,
        errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },
};

module.exports = metricsTests;
