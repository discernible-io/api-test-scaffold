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
    assert.strictEqual(typeof sdk.authenticate, 'function');
    assert.strictEqual(typeof sdk.authenticate_apicall, 'function');
    assert.strictEqual(typeof sdk.validatePermissions, 'function');
    assert.strictEqual(typeof sdk.login, 'function');
    assert.strictEqual(typeof sdk.logout, 'function');
    assert.strictEqual(typeof sdk.loginWithNEP413, 'function');
    assert.strictEqual(typeof sdk.login_server, 'function');

    // Token functions
    assert.strictEqual(typeof sdk.validateToken, 'function');
    assert.strictEqual(typeof sdk.generateToken, 'function');

    // Services
    assert.ok(sdk.sessionManager);
    assert.ok(sdk.blockchainService);
    assert.ok(sdk.stateManager);
    assert.ok(sdk.roditManager);

    // Webhook
    assert.ok(sdk.webhook && typeof sdk.webhook === 'object');

    // Versioning
    assert.ok(sdk.versioning && typeof sdk.versioning === 'object');
    assert.strictEqual(typeof sdk.versioning.middleware, 'function');
    assert.ok(sdk.versioning.manager);
    assert.ok(sdk.versioning.VersionManager);

    // Middleware
    assert.strictEqual(typeof sdk.loggingmw, 'function');
    assert.strictEqual(typeof sdk.ratelimitmw, 'function');

    // Utils
    assert.ok(sdk.utils);
    assert.strictEqual(typeof sdk.validateAndSetDate, 'function');
    assert.strictEqual(typeof sdk.validateAndSetJson, 'function');
    assert.strictEqual(typeof sdk.validateAndSetUrl, 'function');
    assert.strictEqual(typeof sdk.calculateCanonicalHash, 'function');

    // Logger and performance
    assert.ok(sdk.logger);
    assert.ok(sdk.performanceService);

    // Client & helpers
    assert.ok(sdk.RoditClient);
    assert.strictEqual(typeof sdk.configure, 'function');
    assert.strictEqual(typeof sdk.initConfig, 'function');

    return { success: true };
  },

  'SDK surface - configure() returns module and sets basic options without throwing': async () => {
    const sdk = require('../../sdk');

    const returned = sdk.configure({ apiVersion: '1.0', versionHeaderType: 'header' });
    assert.strictEqual(returned, sdk, 'configure should return the module for chaining');

    // Ensure versioning middleware is still a function after configure
    assert.strictEqual(typeof sdk.versioning.middleware, 'function');

    return { success: true };
  },

  'SDK surface - logger facade shape': async () => {
    const sdk = require('../../sdk');
    const lg = sdk.logger;

    ['error','warn','info','debug','log'].forEach(m => {
      assert.strictEqual(typeof lg[m], 'function');
    });

    // Context helpers
    ['logWithContext','errorWithContext','warnWithContext','infoWithContext','debugWithContext','metric','logEvent'].forEach(m => {
      assert.strictEqual(typeof lg[m], 'function');
    });

    return { success: true };
  },

  'SDK surface - singleton guards expose same instances as deep imports': async () => {
    const sdk = require('../../sdk');
    const deepState = require('../../sdk/lib/blockchain/statemanager');
    const deepRodit = require('../../sdk/lib/auth/roditmanager');

    // The SDK index exports the same singleton instances
    assert.strictEqual(sdk.stateManager, deepState);
    assert.strictEqual(sdk.roditManager, deepRodit);

    return { success: true };
  }
};
