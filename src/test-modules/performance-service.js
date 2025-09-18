/**
 * performance-service-tests.js
 * Tests for SDK PerformanceService via npm-like interface (internal path in SDK)
 */

const assert = require('assert');
// Import SDK components using the new interface
const { logger } = require('@rodit/rodit-auth-be');
const performanceService = require('../../sdk/services/performanceservice');

module.exports = {
  'PerformanceService - getSystemMetrics has system cpu field': async () => {
    const metrics = performanceService.getSystemMetrics();
    assert.ok(metrics && metrics.cpu && typeof metrics.cpu.system === 'number', 'cpu.system should be a number');
    assert.ok(Array.isArray(metrics.cpu.loadAvg), 'loadAvg should be array');
    return { success: true };
  },

  'PerformanceService - trace lifecycle with span': async () => {
    performanceService.resetMetrics();

    const traceId = performanceService.startTrace('unit-test-op', { requestId: 'test-req-1' });
    const span = performanceService.startSpan(traceId, 'auth-check');

    // Simulate brief work
    await new Promise(r => setTimeout(r, 10));

    span.stop();
    const completed = performanceService.completeTrace(traceId, { success: true, statusCode: 200 });
    assert.strictEqual(completed, true, 'Trace should complete');

    const trace = performanceService.getTrace(traceId);
    assert.ok(trace && trace.completed === true, 'Trace should be marked completed');
    assert.ok(trace.spans.length === 1, 'One span should be recorded');

    return { success: true };
  },

  'PerformanceService - recordMetric mappings': async () => {
    performanceService.resetMetrics();

    performanceService.recordMetric('request_count', 1);
    performanceService.recordMetric('http_errors_total', 1);
    performanceService.recordMetric('authentication_duration_ms', 25);
    performanceService.recordMetric('blockchain_duration_ms', 10);

    const m = performanceService.getMetrics();
    assert.ok(m.requestCount >= 1, 'requestCount should be >= 1');
    assert.ok(m.errorCount >= 1, 'errorCount should be >= 1');
    assert.ok(m.authenticationCalls >= 1 && m.authenticationDuration >= 25, 'auth metrics should be updated');
    assert.ok(m.blockchainCalls >= 1 && m.blockchainDuration >= 10, 'blockchain metrics should be updated');

    return { success: true };
  }
};
