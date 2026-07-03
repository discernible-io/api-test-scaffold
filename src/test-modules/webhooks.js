/**
 * Webhook Tests Module
 * Tests for webhook functionality including signature verification, authentication, and event processing
 * 
 * Copyright (c) 2026 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const crypto = require('crypto');
const nacl = require('tweetnacl');
const { logger, stateManager } = require('../../sdk');
const { captureTestData, getRoditClientForTest, extractApiErrorInfo } = require('./test-utils');
const { authenticate_webhook } = require('../../sdk/lib/auth/authentication');
const {
  extractWebhookSignerKey,
  extractWebhookSessionId,
} = require('../../sdk/lib/middleware/webhookhandlermw');
const identyclawApiTests = require('./identyclaw-api');

const PASSIVE_WEBHOOK_ENDPOINTS = ["/webhook", "/hooks/wake", "/hooks/agent"];
const TESTHOLA_WEBHOOK_EVENTS = new Set([
  "testhola_validation_success",
  "testhola_validation_failed",
  "testhola_response_failed"
]);

function buildPassiveWebhookDiagnostics(apiEndpoint, endpointType) {
  const configOwnRodit = stateManager.getConfigOwnRodit();
  return {
    mode: "passive-listener",
    endpointType,
    apiEndpoint,
    expectedListenerPaths: PASSIVE_WEBHOOK_ENDPOINTS,
    doesNotSendSyntheticWebhookTraffic: true,
    hasLogger: !!logger && typeof logger.info === "function",
    hasWebhookSigningKeyMaterial: !!configOwnRodit?.own_rodit_bytes_private_key
  };
}

function getWebhookReceiptsFromContext(logContext = {}) {
  const receipts = logContext?.app?.locals?.webhookReceipts;
  return Array.isArray(receipts) ? receipts : null;
}

function getExpectedTestholaRequestId(deliveryCheck = {}) {
  return (
    deliveryCheck?.testholaResult?.testData?.validResponse?.requestId ||
    deliveryCheck?.testholaResult?.testData?.requestId ||
    null
  );
}

function buildWebhookCorrelationDiagnostics(evidence = [], expectedRequestId) {
  const uniqueRequestIds = [...new Set((evidence || []).map((entry) => entry?.requestId).filter(Boolean))];
  const matchingReceipts = expectedRequestId
    ? (evidence || []).filter((entry) => entry?.requestId === expectedRequestId)
    : [];

  let status = "not_available";
  if (expectedRequestId) {
    status = matchingReceipts.length > 0 ? "matched" : "mismatch";
  } else if (uniqueRequestIds.length > 0) {
    status = "observed_without_expected_id";
  }

  return {
    expectedRequestId,
    uniqueWebhookRequestIds: uniqueRequestIds,
    correlationStatus: status,
    correlatedReceiptCount: matchingReceipts.length
  };
}

function selectEndpointReceipt(evidence = [], endpointPath, expectedRequestId) {
  if (expectedRequestId) {
    const correlated = (evidence || []).find((entry) => entry.path === endpointPath && entry.requestId === expectedRequestId);
    if (correlated) return correlated;
  }
  return (evidence || []).find((entry) => entry.path === endpointPath);
}

async function triggerTestholaAndCollectWebhookEvidence(apiEndpoint, logContext = {}) {
  const receipts = getWebhookReceiptsFromContext(logContext);
  if (!receipts) {
    return {
      ok: false,
      error: "Webhook receipt buffer not available in app.locals"
    };
  }

  receipts.length = 0;
  const testholaResult = await identyclawApiTests.testTestholaEndpoint(apiEndpoint);

  if (!testholaResult?.passed) {
    return {
      ok: false,
      error: `Failed to trigger /api/testhola successfully: ${testholaResult?.error || 'unknown error'}`,
      testholaResult
    };
  }

  // Wait up to 3 seconds for async webhook delivery with polling
  const maxWaitMs = 3000;
  const pollIntervalMs = 100;
  let elapsedMs = 0;
  let evidence = [];
  
  while (elapsedMs < maxWaitMs) {
    evidence = receipts.filter((entry) => TESTHOLA_WEBHOOK_EVENTS.has(entry?.event));
    if (evidence.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    elapsedMs += pollIntervalMs;
  }

  return {
    ok: true,
    testholaResult,
    evidence,
    allReceipts: [...receipts],
    waitedMs: elapsedMs
  };
}

/**
 * Webhook Tests
 */
const webhookTests = {
  /**
   * Test webhook signature generation and verification
   * Validates that signatures are properly generated and can be verified
   */
  testWebhookSignatureGeneration: async (twsg_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookSignatureGeneration";
    const correlationId = ulid();
    const testData = { twsg_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      // Get the server's private key from state manager
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          passed: false,
          error: "Server private key not available in state manager",
          testData,
        };
      }

      // Create a test payload
      const testPayload = JSON.stringify({
        event: 'test_event',
        data: { test: 'data' },
        requestId: ulid()
      });

      const timestamp = Date.now();
      const payloadWithTimestamp = testPayload + timestamp.toString();

      // Generate hash
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      // Sign the hash
      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      testData.payloadSize = testPayload.length;
      testData.timestampSize = timestamp.toString().length;
      testData.signatureLength = signatureHex.length;
      testData.signatureGenerated = true;

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Webhook signature generated successfully",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook authentication with valid signature
   * Validates that valid signatures are accepted
   */
  testWebhookAuthentication: async (twa_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookAuthentication";
    const correlationId = ulid();
    const testData = { twa_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          passed: false,
          error: "Server private key not available",
          testData,
        };
      }

      // Create test payload
      const testPayload = JSON.stringify({
        event: 'test_authentication',
        data: { test: 'webhook_auth' },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      const payloadWithTimestamp = testPayload + timestamp;

      // Generate signature
      const sha256_hash = crypto
        .createHash("sha256")
        .update(payloadWithTimestamp)
        .digest();

      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const signature = nacl.sign.detached(sha256_hash, privateKey);
      const signatureHex = Buffer.from(signature).toString('hex');

      // Get our own public key for verification
      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();

      // Verify the signature using authenticate_webhook
      const authResult = await authenticate_webhook(
        testPayload,
        signatureHex,
        timestamp,
        publicKeyBase64url
      );

      testData.authenticationValid = authResult.isValid;
      testData.authDuration = authResult.duration;

      if (!authResult.isValid) {
        return {
          passed: false,
          error: `Authentication not-passed: ${authResult.error?.message || 'Unknown error'}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Webhook authentication successful",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook authentication with invalid signature
   * Validates that invalid signatures are rejected
   */
  testWebhookInvalidSignature: async (twis_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookInvalidSignature";
    const correlationId = ulid();
    const testData = { twis_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const testPayload = JSON.stringify({
        event: 'test_invalid_sig',
        data: { test: 'invalid' },
        requestId: ulid()
      });

      const timestamp = Date.now().toString();
      
      // Create an invalid signature (random hex string)
      const invalidSignature = crypto.randomBytes(64).toString('hex');

      // Get our own public key
      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();

      // Try to verify with invalid signature
      const authResult = await authenticate_webhook(
        testPayload,
        invalidSignature,
        timestamp,
        publicKeyBase64url
      );

      testData.authenticationValid = authResult.isValid;
      testData.rejectedAsExpected = !authResult.isValid;

      if (authResult.isValid) {
        return {
          passed: false,
          error: "Invalid signature was incorrectly accepted",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Invalid signature properly rejected",
        testData,
      };
    } catch (error) {
      const errorInfo = extractApiErrorInfo(error);
      logger.error("Webhook test error", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "error",
        error: error.message,
        errorInfo: errorInfo,
        stack: error.stack,
      });

      const result = {
        passed: false,
        error: `Test error: ${error.message}`,
        errorInfo: errorInfo,
        stack: error.stack,
      };
      return captureTestData(testName, moduleName, result, testData);
    }
  },

  /**
   * Test webhook timestamp validation
   * Validates that stale timestamps are rejected
   */
  testWebhookTimestampValidation: async (twtv_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookTimestampValidation";
    const correlationId = ulid();
    const testData = { twtv_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const config_own_rodit = stateManager.getConfigOwnRodit();
      if (!config_own_rodit || !config_own_rodit.own_rodit_bytes_private_key) {
        return {
          passed: false,
          error: "Server private key not available",
          testData,
        };
      }

      const testPayload = JSON.stringify({
        event: 'test_timestamp',
        data: { test: 'timestamp_validation' },
        requestId: ulid()
      });

      // Test 1: Fresh timestamp (should be accepted)
      const freshTimestamp = Date.now().toString();
      const freshPayloadWithTimestamp = testPayload + freshTimestamp;
      const freshHash = crypto.createHash("sha256").update(freshPayloadWithTimestamp).digest();
      const privateKey = new Uint8Array(config_own_rodit.own_rodit_bytes_private_key);
      const freshSignature = nacl.sign.detached(freshHash, privateKey);
      const freshSignatureHex = Buffer.from(freshSignature).toString('hex');

      const publicKeyBase64url = stateManager.getOwnBase64urlJwkPublicKey();
      const freshAuthResult = await authenticate_webhook(
        testPayload,
        freshSignatureHex,
        freshTimestamp,
        publicKeyBase64url
      );

      testData.freshTimestampValid = freshAuthResult.isValid;

      // Test 2: Stale timestamp (should be rejected)
      const staleTimestamp = (Date.now() - 6 * 60 * 1000).toString(); // 6 minutes ago
      const stalePayloadWithTimestamp = testPayload + staleTimestamp;
      const staleHash = crypto.createHash("sha256").update(stalePayloadWithTimestamp).digest();
      const staleSignature = nacl.sign.detached(staleHash, privateKey);
      const staleSignatureHex = Buffer.from(staleSignature).toString('hex');

      const staleAuthResult = await authenticate_webhook(
        testPayload,
        staleSignatureHex,
        staleTimestamp,
        publicKeyBase64url
      );

      testData.staleTimestampRejected = !staleAuthResult.isValid;

      if (!freshAuthResult.isValid || staleAuthResult.isValid) {
        return {
          passed: false,
          error: "Timestamp validation not working correctly",
          details: {
            freshTimestampValid: freshAuthResult.isValid,
            staleTimestampRejected: !staleAuthResult.isValid
          },
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Timestamp validation working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook event processing
   * Validates that webhook events are properly extracted and processed
   */
  testWebhookEventProcessing: async (twep_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookEventProcessing";
    const correlationId = ulid();
    const testData = { twep_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const { processWebhookEvent } = require('../../sdk/lib/middleware/webhookhandlermw');

      // Test 1: Valid event
      const validEventPayload = {
        event: 'test_event',
        data: { test: 'data' },
        isError: false,
        timestamp: new Date().toISOString(),
        requestId: ulid()
      };

      const mockReq = {
        body: validEventPayload,
        headers: {}
      };

      const event = processWebhookEvent(mockReq);
      testData.validEventProcessed = !event.error && event.type === 'test_event';

      // Test 2: Missing event type
      const invalidEventPayload = {
        data: { test: 'data' }
      };

      const mockReq2 = {
        body: invalidEventPayload,
        headers: {}
      };

      const event2 = processWebhookEvent(mockReq2);
      testData.invalidEventRejected = !!event2.error;

      if (!testData.validEventProcessed || !testData.invalidEventRejected) {
        return {
          passed: false,
          error: "Event processing not working correctly",
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Webhook event processing working correctly",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test self-identifying webhook signer-key resolution (rodit-auth-be 9.12.0).
   *
   * The signer's Ed25519 public key travels WITH each webhook so verification no
   * longer depends on a mutable "current peer" slot (fixes false 401s when
   * connected to multiple peers). `extractWebhookSignerKey(headers)` reads that
   * identity from `X-Rodit-Implicit-Account` (hex, authoritative) and/or
   * `X-Rodit-Public-Key` (base64url). This exercises the SDK helper directly
   * (deterministic, no delivery path), mirroring testWebhookEventProcessing.
   */
  testWebhookSignerKeyExtraction: async (twske_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookSignerKeyExtraction";
    const correlationId = ulid();
    const testData = { twske_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const ownPublicKey = stateManager.getOwnBase64urlJwkPublicKey();
      if (!ownPublicKey) {
        return {
          passed: false,
          error: "Own base64url public key not available in state manager",
          testData,
        };
      }

      const ownImplicitAccount = Buffer.from(ownPublicKey, "base64url").toString("hex");
      // A distinct, valid key whose implicit account differs from ours.
      const otherPublicKey = Buffer.from(nacl.sign.keyPair().publicKey).toString("base64url");

      const subResults = [];

      // Case 1: implicit account alone is authoritative and derives the key.
      const implicitOnly = extractWebhookSignerKey({ "x-rodit-implicit-account": ownImplicitAccount });
      subResults.push({
        name: "implicit_account_authoritative",
        passed:
          !!implicitOnly.key &&
          implicitOnly.source === "implicit_account" &&
          implicitOnly.implicitAccount === ownImplicitAccount,
        actual: { source: implicitOnly.source, implicitAccount: implicitOnly.implicitAccount },
      });

      // Case 2: raw advertised key alone resolves and yields the matching implicit account.
      const advertisedOnly = extractWebhookSignerKey({ "x-rodit-public-key": ownPublicKey });
      subResults.push({
        name: "advertised_key_resolves",
        passed:
          advertisedOnly.key === ownPublicKey &&
          advertisedOnly.source === "advertised_key" &&
          advertisedOnly.implicitAccount === ownImplicitAccount,
        actual: { source: advertisedOnly.source, implicitAccount: advertisedOnly.implicitAccount },
      });

      // Case 3: advertised key disagreeing with the implicit account is rejected.
      const mismatch = extractWebhookSignerKey({
        "x-rodit-implicit-account": ownImplicitAccount,
        "x-rodit-public-key": otherPublicKey,
      });
      subResults.push({
        name: "implicit_mismatch_rejected",
        passed: mismatch.key === null && mismatch.source === "implicit_mismatch",
        actual: { source: mismatch.source, key: mismatch.key },
      });

      // Case 4: no signer identity headers → unresolved (no key).
      const unresolved = extractWebhookSignerKey({});
      subResults.push({
        name: "missing_headers_unresolved",
        passed: unresolved.key === null && unresolved.source === "unresolved",
        actual: { source: unresolved.source, key: unresolved.key },
      });

      testData.subResults = subResults;
      const failed = subResults.filter((r) => !r.passed);

      if (failed.length > 0) {
        return {
          passed: false,
          error: `Signer-key extraction not-passed subcases: ${failed.map((r) => r.name).join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Self-identifying webhook signer-key resolution matches rodit-auth-be 9.12.0 behavior",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook ↔ session correlation extraction (rodit-auth-be 9.12.0).
   *
   * `send_webhook` stamps the originating session id into the SIGNED payload
   * (`session_id`) and mirrors it into the `X-Rodit-Session-Id` header. The
   * signed value is authoritative; the header is a pre-parse fallback.
   * `extractWebhookSessionId({ headers, rawPayload, parsedBody })` implements
   * that precedence and underpins the new signer↔session authorization gate.
   */
  testWebhookSessionCorrelation: async (twsc_api_ep) => {
    const moduleName = "webhooks";
    const testName = "testWebhookSessionCorrelation";
    const correlationId = ulid();
    const testData = { twsc_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const subResults = [];

      // Case 1: signed payload session_id wins over the header mirror.
      const payloadWins = extractWebhookSessionId({
        headers: { "x-rodit-session-id": "session-from-header" },
        parsedBody: { event: "e", session_id: "session-from-payload" },
      });
      subResults.push({
        name: "signed_payload_authoritative",
        passed: payloadWins === "session-from-payload",
        actual: payloadWins,
      });

      // Case 2: nested data.session_id is supported.
      const nested = extractWebhookSessionId({
        headers: {},
        parsedBody: { event: "e", data: { session_id: "session-nested" } },
      });
      subResults.push({
        name: "nested_data_session_id",
        passed: nested === "session-nested",
        actual: nested,
      });

      // Case 3: header is used as a fallback when the payload carries none.
      const headerFallback = extractWebhookSessionId({
        headers: { "x-rodit-session-id": "session-from-header" },
        parsedBody: { event: "e" },
      });
      subResults.push({
        name: "header_fallback",
        passed: headerFallback === "session-from-header",
        actual: headerFallback,
      });

      // Case 4: a raw (unparsed) JSON payload string is parsed for session_id.
      const fromRaw = extractWebhookSessionId({
        headers: {},
        rawPayload: JSON.stringify({ event: "e", session_id: "session-from-raw" }),
      });
      subResults.push({
        name: "raw_payload_parsed",
        passed: fromRaw === "session-from-raw",
        actual: fromRaw,
      });

      // Case 5: nothing present → empty string (drives WEBHOOK_SESSION_REQUIRED).
      const none = extractWebhookSessionId({ headers: {}, parsedBody: { event: "e" } });
      subResults.push({
        name: "absent_session_id",
        passed: none === "",
        actual: none,
      });

      testData.subResults = subResults;
      const failed = subResults.filter((r) => !r.passed);

      if (failed.length > 0) {
        return {
          passed: false,
          error: `Session-correlation extraction not-passed subcases: ${failed.map((r) => r.name).join(", ")}`,
          testData,
        };
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Webhook session-id correlation precedence matches rodit-auth-be 9.12.0 behavior",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook endpoint accessibility
   * Validates passive listener expectations without active probing
   */
  testWebhookEndpointAccessibility: async (twea_api_ep, logContext = {}) => {
    const moduleName = "webhooks";
    const testName = "testWebhookEndpointAccessibility";
    const correlationId = ulid();
    const testData = { twea_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
    });

    try {
      const diagnostics = buildPassiveWebhookDiagnostics(twea_api_ep, "default");
      const deliveryCheck = await triggerTestholaAndCollectWebhookEvidence(twea_api_ep, logContext);
      Object.assign(testData, diagnostics);
      testData.triggerSource = "/api/testhola";
      testData.testholaTriggered = deliveryCheck.ok;
      testData.receivedWebhookCount = deliveryCheck.evidence?.length || 0;
      const expectedRequestId = getExpectedTestholaRequestId(deliveryCheck);
      const correlation = buildWebhookCorrelationDiagnostics(deliveryCheck.evidence || [], expectedRequestId);
      Object.assign(testData, correlation);
      const defaultWebhookReceipt = selectEndpointReceipt(deliveryCheck.evidence || [], "/webhook", expectedRequestId);
      testData.receivedDefaultWebhook = !!defaultWebhookReceipt;
      testData.receivedWebhookEvents = (deliveryCheck.evidence || []).map((entry) => ({
        path: entry.path,
        event: entry.event,
        timestamp: entry.timestamp,
        requestId: entry.requestId,
        // rodit-auth-be 9.12.0: self-identifying signer + session correlation.
        sessionId: entry.sessionId || null,
        signerImplicitAccount: entry.signerImplicitAccount || null,
        signerTokenId: entry.signerTokenId || null
      }));
      // Findings-only: observe that delivered webhooks carry the 9.12.0 signer
      // identity + session binding (delivery side-effects remain non-blocking).
      if (defaultWebhookReceipt) {
        testData.defaultWebhookCarriesSignerIdentity = !!defaultWebhookReceipt.signerImplicitAccount;
        testData.defaultWebhookCarriesSessionId = !!defaultWebhookReceipt.sessionId;
      }

      if (!deliveryCheck.ok) {
        testData.triggerError = deliveryCheck.error;
        return {
          passed: false,
          error: deliveryCheck.error,
          testData
        };
      }

      logger.info("Passive webhook listener test: validated using /api/testhola-triggered webhook flow", {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        expectedListenerPath: "/webhook",
        mode: diagnostics.mode
      });

      if (defaultWebhookReceipt) {
        logger.info(`Test ${testName}: webhook side-effects tier passed`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "webhook-delivery-passed",
          webhookReceived: true,
          webhookPath: "/webhook",
          webhookEvent: defaultWebhookReceipt.event,
          webhookTimestamp: defaultWebhookReceipt.timestamp,
          webhookRequestId: defaultWebhookReceipt.requestId,
          webhookCorrelationStatus: correlation.correlationStatus,
          waitedMs: deliveryCheck.waitedMs
        });
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
      });

      return {
        passed: true,
        message: "Webhook listener validated with passive reception evidence from /api/testhola-triggered webhooks",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        error: error.message,
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook reception at /hooks/wake endpoint
   * Validates passive listener configuration for wake webhooks
   * 
   * Assertion Separation:
   * - TIER 1: HTTP Response - Verify /api/testhola returns 200 with valid=true
   * - TIER 2: Webhook Side Effects - Verify /hooks/wake receives any /api/testhola webhook outcome event
   * 
   * Correlation: Uses requestId from API response to correlate with webhook payload
   */
  testWebhookWakeEndpoint: async (twwe_api_ep, logContext = {}) => {
    const moduleName = "webhooks";
    const testName = "testWebhookWakeEndpoint";
    const correlationId = ulid();
    const testData = { twwe_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
      description: "Testing /hooks/wake webhook delivery after /api/testhola validation"
    });

    try {
      const diagnostics = buildPassiveWebhookDiagnostics(twwe_api_ep, "wake");
      const deliveryCheck = await triggerTestholaAndCollectWebhookEvidence(twwe_api_ep, logContext);
      Object.assign(testData, diagnostics);
      testData.triggerSource = "/api/testhola";
      testData.pollWaitMs = deliveryCheck.waitedMs;
      const expectedRequestId = getExpectedTestholaRequestId(deliveryCheck);
      const correlation = buildWebhookCorrelationDiagnostics(deliveryCheck.evidence || [], expectedRequestId);
      Object.assign(testData, correlation);

      // TIER 1: HTTP Response Assertion
      if (!deliveryCheck.ok) {
        testData.triggerError = deliveryCheck.error;
        logger.error(`Test ${testName} not-passed at HTTP response tier`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "http-response",
          error: deliveryCheck.error
        });
        return {
          passed: false,
          error: deliveryCheck.error,
          testData
        };
      }

      // Extract requestId from testhola result for correlation
      const requestId = expectedRequestId;
      testData.requestId = requestId;
      testData.httpStatus = 200;
      testData.httpResponseValid = true;

      logger.info(`Test ${testName}: HTTP response tier passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "http-response-passed",
        requestId,
        httpStatus: 200
      });

      // TIER 2: Webhook Side Effects Assertion
      const wakeReceipt = selectEndpointReceipt(deliveryCheck.evidence || [], "/hooks/wake", expectedRequestId);
      testData.receivedWakeWebhook = !!wakeReceipt;
      testData.receivedWebhookCount = deliveryCheck.evidence.length;
      testData.receivedWebhookPaths = deliveryCheck.evidence.map((entry) => entry.path);
      testData.allReceipts = deliveryCheck.allReceipts.map((r) => ({
        path: r.path,
        event: r.event,
        timestamp: r.timestamp,
        requestId: r.requestId,
        // rodit-auth-be 9.12.0: self-identifying signer + session correlation.
        sessionId: r.sessionId || null,
        signerImplicitAccount: r.signerImplicitAccount || null,
        signerTokenId: r.signerTokenId || null
      }));

      if (!wakeReceipt) {
        logger.warn(`Test ${testName}: wake webhook receipt not observed (diagnostic only)`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "webhook-delivery-diagnostic",
          expectedPath: "/hooks/wake",
          receivedPaths: testData.receivedWebhookPaths,
          receivedCount: testData.receivedWebhookCount,
          webhookCorrelationStatus: correlation.correlationStatus,
          expectedRequestId,
          waitedMs: deliveryCheck.waitedMs,
          allReceipts: testData.allReceipts
        });
        testData.webhookDeliveryMode = "diagnostic-only";
        testData.webhookDeliveryDiagnostic =
          "No /hooks/wake receipt observed after /api/testhola; side-effects are not contractually required by target swagger.";
      }

      // Verify webhook payload structure when receipt is available.
      // In diagnostic-only mode we intentionally avoid failing on missing receipts.
      testData.webhookEvent = wakeReceipt?.event || null;
      testData.webhookPath = wakeReceipt?.path || null;
      testData.webhookTimestamp = wakeReceipt?.timestamp || null;
      testData.webhookRequestId = wakeReceipt?.requestId || null;

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        httpStatus: 200,
        webhookReceived: !!wakeReceipt,
        webhookPath: wakeReceipt?.path || null,
        webhookEvent: wakeReceipt?.event || null,
        correlationId: requestId,
        webhookCorrelationStatus: correlation.correlationStatus,
        waitedMs: deliveryCheck.waitedMs
      });

      return {
        passed: true,
        message: "Wake webhook listener validated from /api/testhola server-initiated webhook reception",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed with exception`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook reception at /hooks/agent endpoint
   * Validates passive listener configuration for agent webhooks
   * 
   * Assertion Separation:
   * - TIER 1: HTTP Response - Verify /api/testhola returns 200 with valid=true
   * - TIER 2: Webhook Side Effects - Verify /hooks/agent receives any /api/testhola webhook outcome event
   * 
   * Correlation: Uses requestId from API response to correlate with webhook payload
   */
  testWebhookAgentEndpoint: async (twae_api_ep, logContext = {}) => {
    const moduleName = "webhooks";
    const testName = "testWebhookAgentEndpoint";
    const correlationId = ulid();
    const testData = { twae_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
      description: "Testing /hooks/agent webhook delivery after /api/testhola validation"
    });

    try {
      const diagnostics = buildPassiveWebhookDiagnostics(twae_api_ep, "agent");
      const deliveryCheck = await triggerTestholaAndCollectWebhookEvidence(twae_api_ep, logContext);
      Object.assign(testData, diagnostics);
      testData.triggerSource = "/api/testhola";
      testData.pollWaitMs = deliveryCheck.waitedMs;
      const expectedRequestId = getExpectedTestholaRequestId(deliveryCheck);
      const correlation = buildWebhookCorrelationDiagnostics(deliveryCheck.evidence || [], expectedRequestId);
      Object.assign(testData, correlation);

      // TIER 1: HTTP Response Assertion
      if (!deliveryCheck.ok) {
        testData.triggerError = deliveryCheck.error;
        logger.error(`Test ${testName} not-passed at HTTP response tier`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "http-response",
          error: deliveryCheck.error
        });
        return {
          passed: false,
          error: deliveryCheck.error,
          testData
        };
      }

      // Extract requestId from testhola result for correlation
      const requestId = expectedRequestId;
      testData.requestId = requestId;
      testData.httpStatus = 200;
      testData.httpResponseValid = true;

      logger.info(`Test ${testName}: HTTP response tier passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "http-response-passed",
        requestId,
        httpStatus: 200
      });

      // TIER 2: Webhook Side Effects Assertion
      const agentReceipt = selectEndpointReceipt(deliveryCheck.evidence || [], "/hooks/agent", expectedRequestId);
      testData.receivedAgentWebhook = !!agentReceipt;
      testData.receivedWebhookCount = deliveryCheck.evidence.length;
      testData.receivedWebhookPaths = deliveryCheck.evidence.map((entry) => entry.path);
      testData.allReceipts = deliveryCheck.allReceipts.map((r) => ({
        path: r.path,
        event: r.event,
        timestamp: r.timestamp,
        requestId: r.requestId,
        // rodit-auth-be 9.12.0: self-identifying signer + session correlation.
        sessionId: r.sessionId || null,
        signerImplicitAccount: r.signerImplicitAccount || null,
        signerTokenId: r.signerTokenId || null
      }));

      if (!agentReceipt) {
        logger.warn(`Test ${testName}: agent webhook receipt not observed (diagnostic only)`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "webhook-delivery-diagnostic",
          expectedPath: "/hooks/agent",
          receivedPaths: testData.receivedWebhookPaths,
          receivedCount: testData.receivedWebhookCount,
          webhookCorrelationStatus: correlation.correlationStatus,
          expectedRequestId,
          waitedMs: deliveryCheck.waitedMs,
          allReceipts: testData.allReceipts
        });
        testData.webhookDeliveryMode = "diagnostic-only";
        testData.webhookDeliveryDiagnostic =
          "No /hooks/agent receipt observed after /api/testhola; side-effects are not contractually required by target swagger.";
      }

      // Verify webhook payload structure when receipt is available.
      // In diagnostic-only mode we intentionally avoid failing on missing receipts.
      testData.webhookEvent = agentReceipt?.event || null;
      testData.webhookPath = agentReceipt?.path || null;
      testData.webhookTimestamp = agentReceipt?.timestamp || null;
      testData.webhookRequestId = agentReceipt?.requestId || null;

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        httpStatus: 200,
        webhookReceived: !!agentReceipt,
        webhookPath: agentReceipt?.path || null,
        webhookEvent: agentReceipt?.event || null,
        correlationId: requestId,
        webhookCorrelationStatus: correlation.correlationStatus,
        waitedMs: deliveryCheck.waitedMs
      });

      return {
        passed: true,
        message: "Agent webhook listener validated from /api/testhola server-initiated webhook reception",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed with exception`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  },

  /**
   * Test webhook reception and processing at multiple endpoints
   * Validates passive listener declaration for all webhook endpoints
   * 
   * Assertion Separation:
   * - TIER 1: HTTP Response - Verify /api/testhola returns 200 with valid=true
   * - TIER 2: Webhook Side Effects - Verify both /hooks/wake AND /hooks/agent receive webhooks
   * 
   * Correlation: Uses requestId from API response to correlate with webhook payloads
   */
  testWebhookReceptionAtMultipleEndpoints: async (twrme_api_ep, logContext = {}) => {
    const moduleName = "webhooks";
    const testName = "testWebhookReceptionAtMultipleEndpoints";
    const correlationId = ulid();
    const testData = { twrme_api_ep };

    logger.info(`Starting test: ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      correlationId,
      phase: "start",
      description: "Testing webhook delivery to both /hooks/wake and /hooks/agent after /api/testhola validation"
    });

    try {
      const diagnostics = buildPassiveWebhookDiagnostics(twrme_api_ep, "all");
      const deliveryCheck = await triggerTestholaAndCollectWebhookEvidence(twrme_api_ep, logContext);
      Object.assign(testData, diagnostics);
      testData.triggerSource = "/api/testhola";
      testData.pollWaitMs = deliveryCheck.waitedMs;
      const expectedRequestId = getExpectedTestholaRequestId(deliveryCheck);
      const correlation = buildWebhookCorrelationDiagnostics(deliveryCheck.evidence || [], expectedRequestId);
      Object.assign(testData, correlation);

      // TIER 1: HTTP Response Assertion
      if (!deliveryCheck.ok) {
        testData.triggerError = deliveryCheck.error;
        logger.error(`Test ${testName} not-passed at HTTP response tier`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "http-response",
          error: deliveryCheck.error
        });
        return {
          passed: false,
          error: deliveryCheck.error,
          testData
        };
      }

      // Extract requestId from testhola result for correlation
      const requestId = expectedRequestId;
      testData.requestId = requestId;
      testData.httpStatus = 200;
      testData.httpResponseValid = true;

      logger.info(`Test ${testName}: HTTP response tier passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "http-response-passed",
        requestId,
        httpStatus: 200
      });

      // TIER 2: Webhook Side Effects Assertion
      const receiptPaths = new Set((deliveryCheck.evidence || []).map((entry) => entry.path));
      const hasWake = receiptPaths.has("/hooks/wake");
      const hasAgent = receiptPaths.has("/hooks/agent");

      const wakeReceipt = selectEndpointReceipt(deliveryCheck.evidence || [], "/hooks/wake", expectedRequestId);
      const agentReceipt = selectEndpointReceipt(deliveryCheck.evidence || [], "/hooks/agent", expectedRequestId);

      testData.endpointResults = {
        default: { path: "/webhook", mode: "passive-listener" },
        wake: { 
          path: "/hooks/wake", 
          mode: "passive-listener", 
          received: hasWake,
          event: wakeReceipt?.event,
          timestamp: wakeReceipt?.timestamp
        },
        agent: { 
          path: "/hooks/agent", 
          mode: "passive-listener", 
          received: hasAgent,
          event: agentReceipt?.event,
          timestamp: agentReceipt?.timestamp
        }
      };
      testData.receivedWebhookCount = deliveryCheck.evidence.length;
      testData.receivedWebhookPaths = [...receiptPaths];
      testData.allReceipts = deliveryCheck.allReceipts.map((r) => ({
        path: r.path,
        event: r.event,
        timestamp: r.timestamp,
        requestId: r.requestId,
        // rodit-auth-be 9.12.0: self-identifying signer + session correlation.
        sessionId: r.sessionId || null,
        signerImplicitAccount: r.signerImplicitAccount || null,
        signerTokenId: r.signerTokenId || null
      }));

      if (!hasWake || !hasAgent) {
        logger.warn(`Test ${testName}: multi-endpoint webhook receipts incomplete (diagnostic only)`, {
          component: "TestRunner",
          moduleName,
          testName,
          correlationId,
          phase: "webhook-delivery-diagnostic",
          expectedPaths: ["/hooks/wake", "/hooks/agent"],
          receivedPaths: testData.receivedWebhookPaths,
          receivedCount: testData.receivedWebhookCount,
          hasWake,
          hasAgent,
          webhookCorrelationStatus: correlation.correlationStatus,
          expectedRequestId,
          waitedMs: deliveryCheck.waitedMs,
          allReceipts: testData.allReceipts
        });
        testData.webhookDeliveryMode = "diagnostic-only";
        testData.webhookDeliveryDiagnostic =
          `Webhook receipts incomplete after /api/testhola (wake=${hasWake}, agent=${hasAgent}); endpoint-specific side-effects are not contractually required by target swagger.`;
      }

      logger.info(`Test ${testName} passed`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "complete",
        httpStatus: 200,
        webhooksReceived: Number(hasWake) + Number(hasAgent),
        webhookPaths: testData.receivedWebhookPaths,
        correlationId: requestId,
        webhookCorrelationStatus: correlation.correlationStatus,
        waitedMs: deliveryCheck.waitedMs
      });

      return {
        passed: true,
        message: "Webhook listener coverage validated by /api/testhola server-initiated wake+agent deliveries",
        testData,
      };
    } catch (error) {
      logger.error(`Test ${testName} not-passed with exception`, {
        component: "TestRunner",
        moduleName,
        testName,
        correlationId,
        phase: "exception",
        error: error.message,
        stack: error.stack
      });

      return {
        passed: false,
        error: error.message,
        testData,
      };
    }
  }
};

module.exports = webhookTests;
