/**
 * config-wrapper-tests.js
 * Tests for sdk/services/configsdk wrapper fallbacks and merged behavior
 */

const assert = require('assert');
const config = require('../../sdk/services/configsdk');

module.exports = {
  'Config wrapper - fallback keys available': async () => {
    // Keys with fallbacks in the SDK wrapper
    const logDir = config.get('API_DEFAULT_OPTIONS.LOG_DIR');
    const loadLevels = config.get('PERFORMANCE.LOAD_LEVELS');
    const loadThresholds = config.get('PERFORMANCE.LOAD_THRESHOLDS');

    assert.ok(typeof logDir === 'string' && logDir.length > 0, 'LOG_DIR should be a non-empty string');
    assert.ok(loadLevels && typeof loadLevels === 'object', 'LOAD_LEVELS should be object');
    assert.ok(loadThresholds && typeof loadThresholds === 'object', 'LOAD_THRESHOLDS should be object');
    return { success: true };
  },

  'Config wrapper - excluded key throws': async () => {
    let threw = false;
    try {
      // VAULT_ENDPOINT is intentionally excluded from fallbacks
      // and should throw when not provided
      config.get('VAULT_ENDPOINT');
    } catch (err) {
      threw = true;
      assert.ok(err && err.message && err.message.includes("not defined"));
    }
    assert.strictEqual(threw, true, 'Accessing excluded key must throw');
    return { success: true };
  },

  'Config wrapper - getAllMerged returns object containing fallbacks': async () => {
    const all = config.getAllMerged();
    assert.ok(all && typeof all === 'object', 'getAllMerged should return object');
    assert.ok(all.API_DEFAULT_OPTIONS && all.API_DEFAULT_OPTIONS.LOG_DIR, 'Merged config should include fallback LOG_DIR');
    return { success: true };
  }
};
