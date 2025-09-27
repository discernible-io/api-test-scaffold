/**
 * performance-service-tests.js
 * Tests for SDK perfServiceTests via npm-like interface (internal path in SDK)
 */

const assert = require('assert');
// Import SDK components using the new interface
const { logger } = require('../../sdk');
const perfServiceTests = require('../../sdk/services/performanceservice');

module.exports = {
  'perfServiceTests - getSystemMetrics has system cpu field': async () => {
    const metrics = perfServiceTests.getSystemMetrics();
    assert.ok(metrics && metrics.cpu && typeof metrics.cpu.system === 'number', 'cpu.system should be a number');
    assert.ok(Array.isArray(metrics.cpu.loadAvg), 'loadAvg should be array');
    return { success: true };
  },

  'perfServiceTests - trace lifecycle with span': async () => {
    perfServiceTests.resetMetrics();

    const traceId = perfServiceTests.startTrace('unit-test-op', { requestId: 'test-req-1' });
    const span = perfServiceTests.startSpan(traceId, 'auth-check');

    // Simulate brief work
    await new Promise(r => setTimeout(r, 10));

    span.stop();
    const completed = perfServiceTests.completeTrace(traceId, { success: true, statusCode: 200 });
    assert.strictEqual(completed, true, 'Trace should complete');

    const trace = perfServiceTests.getTrace(traceId);
    assert.ok(trace && trace.completed === true, 'Trace should be marked completed');
    assert.ok(trace.spans.length === 1, 'One span should be recorded');

    return { success: true };
  },

  'perfServiceTests - recordMetric mappings': async () => {
    perfServiceTests.resetMetrics();

    perfServiceTests.recordMetric('request_count', 1);
    perfServiceTests.recordMetric('http_errors_total', 1);
    perfServiceTests.recordMetric('authentication_duration_ms', 25);
    perfServiceTests.recordMetric('blockchain_duration_ms', 10);

    const m = perfServiceTests.getMetrics();
    assert.ok(m.requestCount >= 1, 'requestCount should be >= 1');
    assert.ok(m.errorCount >= 1, 'errorCount should be >= 1');
    assert.ok(m.authenticationCalls >= 1 && m.authenticationDuration >= 25, 'auth metrics should be updated');
    assert.ok(m.blockchainCalls >= 1 && m.blockchainDuration >= 10, 'blockchain metrics should be updated');

    return { success: true };
  }
};
