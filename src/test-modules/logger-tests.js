/**
 * logger-tests.js
 * Tests for the SDK logger facade and setLogger injection
 */

const assert = require('assert');
// Import SDK components using the new interface
const { logger } = require('../../sdk');

module.exports = {
  'Logger - facade exposes helper methods': async () => {
    const methods = [
      'log','error','warn','info','debug',
      'logWithContext','errorWithContext','warnWithContext','infoWithContext','debugWithContext',
      'metric','logEvent','createLogContext','logErrorWithMetrics'
    ];
    methods.forEach(m => assert.strictEqual(typeof logger[m], 'function', `logger.${m} should be a function`));
    return { passed: true };
  },

  'Logger - setLogger swaps implementation and preserves helpers': async () => {
    const captured = [];
    // Minimal custom logger implementing required core methods
    const custom = {
      log: (...args) => captured.push(['log', ...args]),
      error: (...args) => captured.push(['error', ...args]),
      warn: (...args) => captured.push(['warn', ...args]),
      info: (...args) => captured.push(['info', ...args]),
      debug: (...args) => captured.push(['debug', ...args])
    };

    // Swap logger
    logger.setLogger(custom);

    // After swap, helpers should still exist on the facade
    logger.infoWithContext('test-message', { case: 'setLogger' });
    logger.metric('unit_metric', 1, { tag: 'x' });

    // Ensure underlying custom logger was used at least once
    assert.ok(captured.length > 0, 'custom logger should receive calls');

    return { passed: true };
  }
};
