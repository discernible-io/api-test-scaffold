const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Stress test utilities for managing results and metrics
 */

const RESULTS_DIR = path.join(__dirname, 'results');

/**
 * Ensure results directory exists
 */
function ensureResultsDir() {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
}

/**
 * Get API URL from environment or default
 */
function getApiUrl() {
  return process.env.STRESS_API_URL || 'http://localhost:3000';
}

/**
 * Get auth token from environment
 */
function getAuthToken() {
  return process.env.STRESS_AUTH_TOKEN || null;
}

/**
 * Get system metrics before test
 */
function getSystemMetricsBefore() {
  const memUsage = process.memoryUsage();
  return {
    memory_before_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
    timestamp_before: Date.now(),
  };
}

/**
 * Get system metrics after test
 */
function getSystemMetricsAfter(metricsBefore) {
  const memUsage = process.memoryUsage();
  const memAfter = Math.round(memUsage.heapUsed / 1024 / 1024);
  const memGrowth = memAfter - metricsBefore.memory_before_mb;
  const memGrowthPercent = (memGrowth / metricsBefore.memory_before_mb) * 100;

  return {
    memory_before_mb: metricsBefore.memory_before_mb,
    memory_after_mb: memAfter,
    memory_growth_mb: memGrowth,
    memory_growth_percent: Math.round(memGrowthPercent * 10) / 10,
    duration_ms: Date.now() - metricsBefore.timestamp_before,
  };
}

/**
 * Get API metrics from /api/metrics endpoint
 */
async function getApiMetrics(apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/api/metrics`, {
      timeout: 5000,
    });
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.metrics || null;
  } catch (error) {
    console.warn('Failed to fetch API metrics:', error.message);
    return null;
  }
}

/**
 * Save test results to file
 */
function saveResults(scenario, results) {
  ensureResultsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = path.join(RESULTS_DIR, `${scenario}-${timestamp}.json`);

  const data = {
    scenario,
    timestamp: new Date().toISOString(),
    results,
  };

  fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  console.log(`\n✓ Results saved to: ${filename}`);
  return filename;
}

/**
 * Format latency percentile for display
 */
function formatLatency(ms) {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Format bytes for display
 */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * Print test results summary
 */
function printSummary(scenario, results) {
  console.log('\n' + '='.repeat(70));
  console.log(`STRESS TEST RESULTS: ${scenario.toUpperCase()}`);
  console.log('='.repeat(70));

  const { requests, latency, throughput, errors, error_rate, timeouts, system_metrics } = results;

  console.log('\n📊 REQUEST METRICS:');
  console.log(`  Total Requests: ${requests.total.toLocaleString()}`);
  console.log(`  Requests/sec: ${throughput.average.toFixed(2)}`);
  console.log(`  Errors: ${errors} (${error_rate.toFixed(2)}%)`);
  console.log(`  Timeouts: ${timeouts}`);

  console.log('\n⏱️  LATENCY (milliseconds):');
  console.log(`  Min: ${formatLatency(latency.min)}`);
  console.log(`  Mean: ${formatLatency(latency.mean)}`);
  console.log(`  p50: ${formatLatency(latency.p50)}`);
  console.log(`  p95: ${formatLatency(latency.p95)}`);
  console.log(`  p99: ${formatLatency(latency.p99)}`);
  console.log(`  Max: ${formatLatency(latency.max)}`);

  console.log('\n💾 MEMORY:');
  console.log(`  Before: ${system_metrics.memory_before_mb}MB`);
  console.log(`  After: ${system_metrics.memory_after_mb}MB`);
  console.log(`  Growth: ${system_metrics.memory_growth_mb}MB (${system_metrics.memory_growth_percent}%)`);

  console.log('\n' + '='.repeat(70));

  // Print pass/fail status
  const checks = {
    'p95 Latency': {
      value: latency.p95,
      threshold: 200,
      unit: 'ms',
      pass: latency.p95 < 200,
    },
    'Error Rate': {
      value: error_rate,
      threshold: 0.5,
      unit: '%',
      pass: error_rate < 0.5,
    },
    'Memory Growth': {
      value: system_metrics.memory_growth_percent,
      threshold: 10,
      unit: '%',
      pass: system_metrics.memory_growth_percent < 10,
    },
  };

  console.log('\n✅ HEALTH CHECKS:');
  Object.entries(checks).forEach(([name, check]) => {
    const status = check.pass ? '✓' : '✗';
    const color = check.pass ? '\x1b[32m' : '\x1b[31m';
    console.log(
      `  ${color}${status}\x1b[0m ${name}: ${check.value.toFixed(2)}${check.unit} (threshold: ${check.threshold}${check.unit})`
    );
  });

  console.log('\n');
}

/**
 * Parse autocannon results
 */
function parseAutocannon(result) {
  return {
    requests: {
      total: result.requests.total,
      average: result.requests.average,
      sent: result.requests.sent,
    },
    latency: {
      min: result.latency.min,
      max: result.latency.max,
      mean: result.latency.mean,
      p50: result.latency.p50,
      p95: result.latency.p95,
      p99: result.latency.p99,
    },
    throughput: {
      average: result.throughput.average,
      total: result.throughput.total,
    },
    errors: result.errors,
    error_rate: (result.errors / result.requests.total) * 100,
    timeouts: result.timeouts,
  };
}

/**
 * Merge autocannon results with system metrics
 */
function mergeResults(autocannonResults, systemMetrics, endpoint, concurrency) {
  const parsed = parseAutocannon(autocannonResults);
  return {
    endpoint,
    concurrency,
    duration_seconds: autocannonResults.duration,
    ...parsed,
    system_metrics: systemMetrics,
  };
}

/**
 * Check if results meet success criteria
 */
function checkSuccessCriteria(results, criteria = {}) {
  const defaults = {
    maxP95Latency: 200,
    maxErrorRate: 0.5,
    maxMemoryGrowthPercent: 10,
    maxTimeoutRate: 5,
  };

  const config = { ...defaults, ...criteria };
  const checks = {
    p95_latency: results.latency.p95 <= config.maxP95Latency,
    error_rate: results.error_rate <= config.maxErrorRate,
    memory_growth: results.system_metrics.memory_growth_percent <= config.maxMemoryGrowthPercent,
    timeout_rate: (results.timeouts / results.requests.total) * 100 <= config.maxTimeoutRate,
  };

  return {
    passed: Object.values(checks).every((v) => v),
    checks,
  };
}

/**
 * Load and analyze previous results
 */
function loadResults(scenario) {
  ensureResultsDir();
  const files = fs
    .readdirSync(RESULTS_DIR)
    .filter((f) => f.startsWith(`${scenario}-`) && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  const latest = files[0];
  const content = fs.readFileSync(path.join(RESULTS_DIR, latest), 'utf8');
  return JSON.parse(content);
}

/**
 * Compare two test results
 */
function compareResults(before, after) {
  const comparison = {
    scenario: after.scenario,
    timestamp_before: before.timestamp,
    timestamp_after: after.timestamp,
    improvements: {},
    regressions: {},
  };

  const metrics = ['p95', 'p99', 'mean'];
  metrics.forEach((metric) => {
    const beforeVal = before.results.latency[metric];
    const afterVal = after.results.latency[metric];
    const change = ((afterVal - beforeVal) / beforeVal) * 100;

    if (change < -5) {
      comparison.improvements[`latency_${metric}`] = `${Math.abs(change).toFixed(1)}% faster`;
    } else if (change > 5) {
      comparison.regressions[`latency_${metric}`] = `${change.toFixed(1)}% slower`;
    }
  });

  const errorBefore = before.results.error_rate;
  const errorAfter = after.results.error_rate;
  const errorChange = errorAfter - errorBefore;

  if (errorChange < -0.1) {
    comparison.improvements.error_rate = `${Math.abs(errorChange).toFixed(2)}% fewer errors`;
  } else if (errorChange > 0.1) {
    comparison.regressions.error_rate = `${errorChange.toFixed(2)}% more errors`;
  }

  return comparison;
}

module.exports = {
  ensureResultsDir,
  getApiUrl,
  getAuthToken,
  getSystemMetricsBefore,
  getSystemMetricsAfter,
  getApiMetrics,
  saveResults,
  formatLatency,
  formatBytes,
  printSummary,
  parseAutocannon,
  mergeResults,
  checkSuccessCriteria,
  loadResults,
  compareResults,
};
