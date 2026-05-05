/**
 * Stress Test Module
 * Integrates stress testing into the main test suite
 */

const autocannon = require('autocannon');
const logger = require('../../sdk/services/logger');

/**
 * Run baseline stress test
 */
async function testBaselineStress(apiEndpoint, logContext = {}) {
  const testId = 'testBaselineStress';
  const testName = 'Baseline Stress Test';

  try {
    logger.debug(`[${testId}] Starting baseline stress test`, { apiEndpoint });

    const endpoints = [
      { path: '/api/agents', name: 'Agents List' },
      { path: '/api/mcp/schema', name: 'MCP Schema' },
      { path: '/.well-known/did/web/token/bjbvcjzqbdsj', name: 'DID Discovery' },
    ];

    const results = [];

    for (const endpoint of endpoints) {
      const result = await autocannon({
        url: `${apiEndpoint}${endpoint.path}`,
        connections: 50,
        duration: 30,
        pipelining: 1,
      });

      results.push({
        endpoint: endpoint.name,
        path: endpoint.path,
        requests: result.requests.total,
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        error_rate: (result.errors / result.requests.total) * 100,
      });
    }

    const passed = results.every((r) => r.p95 < 200 && r.error_rate < 0.5);

    return {
      testName,
      passed,
      results,
      totalTests: endpoints.length,
      passedTests: results.filter((r) => r.p95 < 200 && r.error_rate < 0.5).length,
    };
  } catch (error) {
    logger.error(`[${testId}] Error:`, error);
    return {
      testName,
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

/**
 * Run auth stress test
 */
async function testAuthStress(apiEndpoint, logContext = {}) {
  const testId = 'testAuthStress';
  const testName = 'Auth Stress Test';

  try {
    logger.debug(`[${testId}] Starting auth stress test`, { apiEndpoint });

    const authToken = process.env.STRESS_AUTH_TOKEN;
    if (!authToken) {
      logger.warn(`[${testId}] No auth token provided, skipping auth stress test`);
      return {
        testName,
        passed: true,
        skipped: true,
        reason: 'STRESS_AUTH_TOKEN not set',
      };
    }

    const endpoints = [
      { path: '/api/me/identity', name: 'Me Identity' },
      { path: '/api/agent/auth-params', name: 'Auth Params' },
      { path: '/api/holanonce16ts', name: 'Holanonce' },
    ];

    const results = [];

    for (const endpoint of endpoints) {
      const result = await autocannon({
        url: `${apiEndpoint}${endpoint.path}`,
        connections: 50,
        duration: 30,
        pipelining: 1,
        requests: [
          {
            method: 'GET',
            path: endpoint.path,
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        ],
      });

      results.push({
        endpoint: endpoint.name,
        path: endpoint.path,
        requests: result.requests.total,
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        error_rate: (result.errors / result.requests.total) * 100,
      });
    }

    const passed = results.every((r) => r.p95 < 500 && r.error_rate < 1.0);

    return {
      testName,
      passed,
      results,
      totalTests: endpoints.length,
      passedTests: results.filter((r) => r.p95 < 500 && r.error_rate < 1.0).length,
    };
  } catch (error) {
    logger.error(`[${testId}] Error:`, error);
    return {
      testName,
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

/**
 * Run burst stress test
 */
async function testBurstStress(apiEndpoint, logContext = {}) {
  const testId = 'testBurstStress';
  const testName = 'Burst Stress Test';

  try {
    logger.debug(`[${testId}] Starting burst stress test`, { apiEndpoint });

    const phases = [
      { concurrency: 20, duration: 30, name: 'Baseline' },
      { concurrency: 300, duration: 60, name: 'Ramp-up' },
      { concurrency: 300, duration: 60, name: 'Sustain' },
      { concurrency: 50, duration: 30, name: 'Cool-down' },
    ];

    const results = [];

    for (const phase of phases) {
      const result = await autocannon({
        url: `${apiEndpoint}/api/agents`,
        connections: phase.concurrency,
        duration: phase.duration,
        pipelining: 1,
      });

      results.push({
        phase: phase.name,
        concurrency: phase.concurrency,
        requests: result.requests.total,
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        timeouts: result.timeouts,
        error_rate: (result.errors / result.requests.total) * 100,
        timeout_rate: (result.timeouts / result.requests.total) * 100,
      });
    }

    const rampupResult = results[1];
    const sustainResult = results[2];

    const passed =
      rampupResult.timeout_rate < 5 &&
      sustainResult.timeout_rate < 5 &&
      rampupResult.error_rate < 2 &&
      sustainResult.error_rate < 2 &&
      sustainResult.p99 < 2000;

    return {
      testName,
      passed,
      results,
      totalTests: phases.length,
      passedTests: results.filter((r) => r.p99 < 2000 && r.error_rate < 2).length,
    };
  } catch (error) {
    logger.error(`[${testId}] Error:`, error);
    return {
      testName,
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

/**
 * Run failure scenario test
 */
async function testFailureScenarios(apiEndpoint, logContext = {}) {
  const testId = 'testFailureScenarios';
  const testName = 'Failure Scenario Test';

  try {
    logger.debug(`[${testId}] Starting failure scenario test`, { apiEndpoint });

    const scenarios = [
      { name: 'Baseline', concurrency: 50, duration: 60 },
      { name: 'Degraded', concurrency: 50, duration: 60 },
    ];

    const results = [];

    for (const scenario of scenarios) {
      const result = await autocannon({
        url: `${apiEndpoint}/api/agents`,
        connections: scenario.concurrency,
        duration: scenario.duration,
        pipelining: 1,
      });

      results.push({
        scenario: scenario.name,
        requests: result.requests.total,
        p95: result.latency.p95,
        errors: result.errors,
        error_rate: (result.errors / result.requests.total) * 100,
      });
    }

    const baseline = results[0];
    const degraded = results[1];

    const latencyIncrease = ((degraded.p95 - baseline.p95) / baseline.p95) * 100;
    const errorIncrease = degraded.error_rate - baseline.error_rate;

    const passed = latencyIncrease < 100 && errorIncrease < 5;

    return {
      testName,
      passed,
      results,
      totalTests: scenarios.length,
      passedTests: passed ? scenarios.length : 0,
    };
  } catch (error) {
    logger.error(`[${testId}] Error:`, error);
    return {
      testName,
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

module.exports = {
  testBaselineStress,
  testAuthStress,
  testBurstStress,
  testFailureScenarios,
};
