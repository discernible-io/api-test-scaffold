/**
 * config-wrapper-tests.js
 * Tests for sdk/services/configsdk wrapper fallbacks and merged behavior
 */

const assert = require('assert');
const config = require('../../sdk/services/configsdk');

module.exports = {
  'Config wrapper - fallback keys available': async () => {
    // Keys with fallbacks in the SDK wrapper
    const iso639 = config.get('API_DEFAULT_OPTIONS.ISO639');
    const securityOptions = config.get('SECURITY_OPTIONS');
    const nearRpcUrl = config.get('NEAR_RPC_URL');

    assert.ok(typeof iso639 === 'string' && iso639.length > 0, 'ISO639 should be a non-empty string');
    assert.ok(securityOptions && typeof securityOptions === 'object', 'SECURITY_OPTIONS should be object');
    assert.ok(typeof nearRpcUrl === 'string' && nearRpcUrl.length > 0, 'NEAR_RPC_URL should be a non-empty string');
    return { passed: true };
  },

  'Config wrapper - excluded key throws': async () => {
    let threw = false;
    const hadVaultEnv = Object.prototype.hasOwnProperty.call(process.env, 'VAULT_ENDPOINT');
    const previousVaultEnv = process.env.VAULT_ENDPOINT;

    try {
      // VAULT_ENDPOINT is intentionally excluded from fallbacks
      // and should throw when not provided
      if (hadVaultEnv) {
        delete process.env.VAULT_ENDPOINT;
      }
      config.get('VAULT_ENDPOINT');
    } catch (err) {
      threw = true;
      assert.ok(err && err.message && err.message.includes("not defined"));
    } finally {
      if (hadVaultEnv) {
        process.env.VAULT_ENDPOINT = previousVaultEnv;
      }
    }

    assert.strictEqual(threw, true, 'Accessing excluded key must throw');
    return { passed: true };
  },

  'Config wrapper - getAllMerged returns object containing fallbacks': async () => {
    const all = config.getAllMerged();
    assert.ok(all && typeof all === 'object', 'getAllMerged should return object');
    assert.ok(all.API_DEFAULT_OPTIONS && all.API_DEFAULT_OPTIONS.ISO639, 'Merged config should include fallback ISO639');
    return { passed: true };
  }
};
