/**
 * In-process SDK and config tests (no HTTP to the deployed API surface).
 * Replaces legacy config-wrapper, sdk-surface, logger, performance-service, and RoditClient init smoke checks.
 */

"use strict";

const assert = require("assert");
const config = require("../../sdk/services/configsdk");
const { logger } = require("../../sdk");
const perfServiceTests = require("../../sdk/services/performanceservice");
const { RoditClient } = require("../../sdk");
const roditManager = require("../../sdk/lib/auth/roditmanager");
const { extractApiErrorInfo } = require("./test-utils");

module.exports = {
  testConfigSdkFallbackKeysAvailable: async () => {
    const iso639 = config.get("API_DEFAULT_OPTIONS.ISO639");
    const securityOptions = config.get("SECURITY_OPTIONS");
    const nearRpcUrl = config.get("NEAR_RPC_URL");

    assert.ok(typeof iso639 === "string" && iso639.length > 0, "ISO639 should be a non-empty string");
    assert.ok(securityOptions && typeof securityOptions === "object", "SECURITY_OPTIONS should be object");
    assert.ok(typeof nearRpcUrl === "string" && nearRpcUrl.length > 0, "NEAR_RPC_URL should be a non-empty string");
    return { passed: true };
  },

  testConfigSdkExcludedVaultKeyThrows: async () => {
    let threw = false;
    const excludedKey = "VAULT_ROLE_ID";
    const hadVaultEnv = Object.prototype.hasOwnProperty.call(process.env, excludedKey);
    const previousVaultEnv = process.env[excludedKey];

    try {
      if (hadVaultEnv) {
        delete process.env[excludedKey];
      }
      config.get(excludedKey);
    } catch (err) {
      threw = true;
      assert.ok(err && err.message && err.message.includes("not defined"));
    } finally {
      if (hadVaultEnv) {
        process.env[excludedKey] = previousVaultEnv;
      }
    }

    assert.strictEqual(threw, true, "Accessing excluded key must throw");
    return { passed: true };
  },

  testConfigSdkGetAllMergedIncludesFallbacks: async () => {
    const all = config.getAllMerged();
    assert.ok(all && typeof all === "object", "getAllMerged should return object");
    assert.ok(all.API_DEFAULT_OPTIONS && all.API_DEFAULT_OPTIONS.ISO639, "Merged config should include fallback ISO639");
    return { passed: true };
  },

  testSdkSurfaceExportsPresenceAndTypes: async () => {
    const sdk = require("../../sdk");

    assert.strictEqual(typeof sdk.authenticate_apicall, "function");
    assert.strictEqual(typeof sdk.validatepermissions, "function");
    assert.strictEqual(typeof sdk.logout_client, "function");
    assert.strictEqual(typeof sdk.login_client_withnep413, "function");
    assert.strictEqual(typeof sdk.login_server, "function");

    assert.strictEqual(typeof sdk.validate_jwt_token_be, "function");
    assert.strictEqual(typeof sdk.generate_jwt_token, "function");

    assert.ok(sdk.sessionManager);
    assert.ok(sdk.blockchainService);
    assert.ok(sdk.stateManager);
    assert.ok(sdk.roditManager);

    assert.ok(sdk.webhookHandler && typeof sdk.webhookHandler === "object");

    assert.strictEqual(typeof sdk.versioningMiddleware, "function");
    assert.ok(sdk.versionManager);
    assert.ok(sdk.VersionManager);

    assert.strictEqual(typeof sdk.loggingmw, "function");
    assert.strictEqual(typeof sdk.ratelimitmw, "function");

    assert.ok(sdk.utils);
    assert.strictEqual(typeof sdk.utils.validateAndSetDate, "function");
    assert.strictEqual(typeof sdk.utils.validateAndSetJson, "function");
    assert.strictEqual(typeof sdk.utils.validateAndSetUrl, "function");
    assert.strictEqual(typeof sdk.utils.calculateCanonicalHash, "function");

    assert.ok(sdk.logger);
    assert.ok(sdk.performanceService);

    assert.ok(sdk.RoditClient);

    return { passed: true };
  },

  testSdkSurfaceLoggerFacadeShape: async () => {
    const sdk = require("../../sdk");
    const lg = sdk.logger;

    ["error", "warn", "info", "debug"].forEach((m) => {
      assert.strictEqual(typeof lg[m], "function");
    });

    ["logWithContext", "errorWithContext", "warnWithContext", "infoWithContext", "debugWithContext", "metric"].forEach(
      (m) => {
        assert.strictEqual(typeof lg[m], "function");
      },
    );

    return { passed: true };
  },

  testSdkSurfaceSingletonsMatchDeepImports: async () => {
    const sdk = require("../../sdk");
    const deepState = require("../../sdk/lib/blockchain/statemanager");
    const deepRodit = require("../../sdk/lib/auth/roditmanager");

    assert.strictEqual(sdk.stateManager, deepState);
    assert.strictEqual(sdk.roditManager, deepRodit);

    return { passed: true };
  },

  testLoggerFacadeExposesHelpers: async () => {
    const methods = [
      "error",
      "warn",
      "info",
      "debug",
      "logWithContext",
      "errorWithContext",
      "warnWithContext",
      "infoWithContext",
      "debugWithContext",
      "metric",
      "createLogContext",
      "logErrorWithMetrics",
    ];
    methods.forEach((m) => assert.strictEqual(typeof logger[m], "function", `logger.${m} should be a function`));

    if (Object.prototype.hasOwnProperty.call(logger, "logEvent")) {
      assert.strictEqual(typeof logger.logEvent, "function");
    }

    return { passed: true };
  },

  testLoggerSetLoggerSwapsImplementation: async () => {
    const captured = [];
    const custom = {
      log: (...args) => captured.push(["log", ...args]),
      error: (...args) => captured.push(["error", ...args]),
      warn: (...args) => captured.push(["warn", ...args]),
      info: (...args) => captured.push(["info", ...args]),
      debug: (...args) => captured.push(["debug", ...args]),
    };

    logger.setLogger(custom);

    logger.infoWithContext("test-message", { case: "setLogger" });
    logger.metric("unit_metric", 1, { tag: "x" });

    assert.ok(captured.length > 0, "custom logger should receive calls");

    return { passed: true };
  },

  testPerformanceServiceSystemMetricsCpu: async () => {
    const metrics = perfServiceTests.getSystemMetrics();
    assert.ok(metrics && metrics.cpu && typeof metrics.cpu.system === "number", "cpu.system should be a number");
    assert.ok(Array.isArray(metrics.cpu.loadAvg), "loadAvg should be array");
    return { passed: true };
  },

  testPerformanceServiceTraceLifecycle: async () => {
    perfServiceTests.resetMetrics();

    const traceId = perfServiceTests.startTrace("unit-test-op", { requestId: "test-req-1" });
    const span = perfServiceTests.startSpan(traceId, "auth-check");

    await new Promise((r) => setTimeout(r, 10));

    span.stop();
    const completed = perfServiceTests.completeTrace(traceId, { passed: true, statusCode: 200 });
    assert.strictEqual(completed, true, "Trace should complete");

    const trace = perfServiceTests.getTrace(traceId);
    assert.ok(trace && trace.completed === true, "Trace should be marked completed");
    assert.ok(trace.spans.length === 1, "One span should be recorded");

    return { passed: true };
  },

  testPerformanceServiceRecordMetricMappings: async () => {
    perfServiceTests.resetMetrics();

    perfServiceTests.recordMetric("request_count", 1);
    perfServiceTests.recordMetric("http_errors_total", 1);
    perfServiceTests.recordMetric("authentication_duration_ms", 25);
    perfServiceTests.recordMetric("blockchain_duration_ms", 10);

    const m = perfServiceTests.getMetrics();
    assert.ok(m.requestCount >= 1, "requestCount should be >= 1");
    assert.ok(m.errorCount >= 1, "errorCount should be >= 1");
    assert.ok(m.authenticationCalls >= 1 && m.authenticationDuration >= 25, "auth metrics should be updated");
    assert.ok(m.blockchainCalls >= 1 && m.blockchainDuration >= 10, "blockchain metrics should be updated");

    return { passed: true };
  },

  testSdkRoditClientInitialization: async (api_ep) => {
    try {
      await roditManager.initializeRoditConfig("client");
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.warn("Error initializing RODiT config for test, continuing anyway", {
        component: "TestRunner",
        method: "testSdkRoditClientInitialization",
        error: error.message,
        errorInfo: errorInfo,
      });
    }

    const { getRoditClientForTest } = require("./test-utils");
    const client = await getRoditClientForTest();
    assert.strictEqual(client.initialized, true, "Client should be initialized");

    const config_own_rodit = await client.getConfigOwnRodit();
    assert.ok(
      config_own_rodit && config_own_rodit.own_rodit && config_own_rodit.own_rodit.metadata,
      "Token configuration and metadata should be loaded",
    );

    return { passed: true, details: { api_ep } };
  },

  testSdkRoditClientProtocolHandling: async (api_ep) => {
    try {
      await roditManager.initializeRoditConfig("client");
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.warn("Error initializing RODiT config for test, continuing anyway", {
        component: "TestRunner",
        method: "testSdkRoditClientProtocolHandling",
        error: error.message,
        errorInfo: errorInfo,
      });
    }

    const { getRoditClientForTest } = require("./test-utils");
    const client = await getRoditClientForTest();
    const config_own_rodit = await client.getConfigOwnRodit();
    const metadata = config_own_rodit?.own_rodit?.metadata;

    if (metadata && metadata.subjectuniqueidentifier_url) {
      const endpoint = metadata.subjectuniqueidentifier_url;
      assert.ok(
        endpoint.startsWith("http://") || endpoint.startsWith("https://"),
        "API endpoint should have proper protocol prefix",
      );
    } else {
      logger.warn("No API endpoint available in metadata, skipping protocol check", {
        component: "TestRunner",
        method: "testSdkRoditClientProtocolHandling",
        metadata: JSON.stringify(metadata),
      });
    }

    return { passed: true, details: { api_ep } };
  },

  testSdkRoditClientCreateInitializes: async (api_ep) => {
    const client = await RoditClient.create("client");
    assert.strictEqual(client.initialized, true, "Client should be initialized");
    return { passed: true, details: { api_ep } };
  },
};
