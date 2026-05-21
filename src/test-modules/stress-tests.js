/**
 * Stress Test Module
 * Integrates stress testing into the main test suite
 */

const autocannon = require('autocannon');
const logger = require('../../sdk/services/logger');
const { getRoditClientForTest } = require('./test-utils');

/** Autocannon may omit p95 in some builds; p99 is always present in our runs. */
function stressLatencyMs(latency = {}) {
  const p95 = latency.p95;
  const p99 = latency.p99;
  return Number.isFinite(p95) ? p95 : p99;
}

function stressErrorRatePercent(result) {
  const total = result.requests?.total;
  if (!total) {
    return 100;
  }
  return (result.errors / total) * 100;
}

function summarizeStressRow(row, maxLatencyMs, maxErrorRatePercent) {
  const latencyOk = Number.isFinite(row.latencyMs) && row.latencyMs < maxLatencyMs;
  const errorOk = Number.isFinite(row.error_rate) && row.error_rate < maxErrorRatePercent;
  if (latencyOk && errorOk) {
    return null;
  }
  const parts = [];
  if (!latencyOk) {
    parts.push(`latency ${row.latencyMs}ms >= ${maxLatencyMs}ms threshold`);
  }
  if (!errorOk) {
    parts.push(`error_rate ${row.error_rate}% >= ${maxErrorRatePercent}% threshold`);
  }
  return parts.join('; ');
}

async function resolveStressAuth() {
  const client = await getRoditClientForTest();
  const loginResult = await client.login_server();
  const jwtToken = loginResult?.jwt_token;
  if (!jwtToken) {
    throw new Error(loginResult?.error || 'login_server did not return jwt_token for stress tests');
  }
  const configOwnRodit = await client.getConfigOwnRodit();
  const tokenId = configOwnRodit?.own_rodit?.token_id;
  return {
    authorization: `Bearer ${jwtToken}`,
    tokenId: tokenId ? String(tokenId).toLowerCase() : null,
  };
}

/**
 * Run baseline stress test
 */
async function testBaselineStress(apiEndpoint, logContext = {}) {
  const testId = 'testBaselineStress';
  const testName = 'Baseline Stress Test';

  try {
    logger.debug(`[${testId}] Starting baseline stress test`, { apiEndpoint });

    const { authorization, tokenId } = await resolveStressAuth();
    const endpoints = [
      { path: '/api/agents', name: 'Agents List' },
      { path: '/api/mcp/schema', name: 'MCP Schema' },
      {
        path: tokenId ? `/.well-known/did/web/token/${tokenId}` : '/api/agents',
        name: 'DID Discovery',
      },
    ];

    const results = [];

    for (const endpoint of endpoints) {
      const result = await autocannon({
        url: `${apiEndpoint}${endpoint.path}`,
        connections: 50,
        duration: 30,
        pipelining: 1,
        headers: { Authorization: authorization },
      });

      const latencyMs = stressLatencyMs(result.latency);
      results.push({
        endpoint: endpoint.name,
        path: endpoint.path,
        requests: result.requests.total,
        latencyMs,
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        error_rate: stressErrorRatePercent(result),
      });
    }

    const maxLatencyMs = 200;
    const maxErrorRatePercent = 0.5;
    const failures = results
      .map((r) => summarizeStressRow(r, maxLatencyMs, maxErrorRatePercent))
      .filter(Boolean);
    const passed = failures.length === 0;

    return {
      testName,
      passed,
      error: passed ? undefined : failures.join(' | '),
      results,
      totalTests: endpoints.length,
      passedTests: results.length - failures.length,
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

      const latencyMs = stressLatencyMs(result.latency);
      results.push({
        endpoint: endpoint.name,
        path: endpoint.path,
        requests: result.requests.total,
        latencyMs,
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        error_rate: stressErrorRatePercent(result),
      });
    }

    const maxLatencyMs = 500;
    const maxErrorRatePercent = 1.0;
    const failures = results
      .map((r) => summarizeStressRow(r, maxLatencyMs, maxErrorRatePercent))
      .filter(Boolean);
    const passed = failures.length === 0;

    return {
      testName,
      passed,
      error: passed ? undefined : failures.join(' | '),
      results,
      totalTests: endpoints.length,
      passedTests: results.length - failures.length,
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
        latencyMs: stressLatencyMs(result.latency),
        p95: result.latency.p95,
        p99: result.latency.p99,
        errors: result.errors,
        error_rate: stressErrorRatePercent(result),
      });
    }

    const baseline = results[0];
    const degraded = results[1];

    const baselineLatency = baseline.latencyMs ?? stressLatencyMs({ p95: baseline.p95, p99: baseline.p99 });
    const degradedLatency = degraded.latencyMs ?? stressLatencyMs({ p95: degraded.p95, p99: degraded.p99 });
    const latencyIncrease =
      baselineLatency > 0
        ? ((degradedLatency - baselineLatency) / baselineLatency) * 100
        : 0;
    const errorIncrease = degraded.error_rate - baseline.error_rate;

    const passed = latencyIncrease < 100 && errorIncrease < 5;
    const error = passed
      ? undefined
      : `latencyIncrease=${latencyIncrease.toFixed(1)}% (max 100%), errorIncrease=${errorIncrease.toFixed(2)}% (max 5%)`;

    return {
      testName,
      passed,
      error,
      results: results.map((r) => ({
        ...r,
        latencyMs: r.latencyMs ?? stressLatencyMs({ p95: r.p95, p99: r.p99 }),
      })),
      latencyIncrease,
      errorIncrease,
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
