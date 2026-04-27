/**
 * sdk-npm-surface-tests.js
 * Smoke tests that validate the public npm surface exported by sdk/index.js
 * These tests avoid network or environment dependencies and focus on types and shape.
 */

const assert = require('assert');

module.exports = {
  'SDK surface - exports presence and types': async () => {
    const sdk = require('../../sdk');

    // Core auth/middleware exports
    assert.strictEqual(typeof sdk.authenticate_apicall, 'function');
    assert.strictEqual(typeof sdk.validatepermissions, 'function');
    assert.strictEqual(typeof sdk.logout_client, 'function');
    assert.strictEqual(typeof sdk.login_client_withnep413, 'function');
    assert.strictEqual(typeof sdk.login_server, 'function');

    // Token functions
    assert.strictEqual(typeof sdk.validate_jwt_token_be, 'function');
    assert.strictEqual(typeof sdk.generate_jwt_token, 'function');

    // Services
    assert.ok(sdk.sessionManager);
    assert.ok(sdk.blockchainService);
    assert.ok(sdk.stateManager);
    assert.ok(sdk.roditManager);

    // Webhook
    assert.ok(sdk.webhookHandler && typeof sdk.webhookHandler === 'object');

    // Versioning
    assert.strictEqual(typeof sdk.versioningMiddleware, 'function');
    assert.ok(sdk.versionManager);
    assert.ok(sdk.VersionManager);

    // Middleware
    assert.strictEqual(typeof sdk.loggingmw, 'function');
    assert.strictEqual(typeof sdk.ratelimitmw, 'function');

    // Utils
    assert.ok(sdk.utils);
    assert.strictEqual(typeof sdk.utils.validateAndSetDate, 'function');
    assert.strictEqual(typeof sdk.utils.validateAndSetJson, 'function');
    assert.strictEqual(typeof sdk.utils.validateAndSetUrl, 'function');
    assert.strictEqual(typeof sdk.utils.calculateCanonicalHash, 'function');

    // Logger and performance
    assert.ok(sdk.logger);
    assert.ok(sdk.performanceService);

    // Client & helpers
    assert.ok(sdk.RoditClient);

    return { passed: true };
  },


  'SDK surface - logger facade shape': async () => {
    const sdk = require('../../sdk');
    const lg = sdk.logger;

    ['error','warn','info','debug','log'].forEach(m => {
      assert.strictEqual(typeof lg[m], 'function');
    });

    // Context helpers that actually exist
    ['logWithContext','errorWithContext','warnWithContext','infoWithContext','debugWithContext','metric'].forEach(m => {
      assert.strictEqual(typeof lg[m], 'function');
    });

    return { passed: true };
  },

  'SDK surface - singleton guards expose same instances as deep imports': async () => {
    const sdk = require('../../sdk');
    const deepState = require('../../sdk/lib/blockchain/statemanager');
    const deepRodit = require('../../sdk/lib/auth/roditmanager');

    // The SDK index exports the same singleton instances
    assert.strictEqual(sdk.stateManager, deepState);
    assert.strictEqual(sdk.roditManager, deepRodit);

    return { passed: true };
  }
};
