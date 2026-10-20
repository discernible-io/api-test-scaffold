#!/usr/bin/env node
/**
 * Unit tests for Sept 2026 harness-relevant helpers (no live API).
 * - formatOutboundWebhookTargetUrl (9.16.2 path join)
 * - login-nonce normalize / signing payload (9.16.2 optional login nonce)
 * Run: node sdk/test/sept-2026-helpers.test.js
 */

"use strict";

const assert = require("assert");
const path = require("path");

const {
  formatOutboundWebhookTargetUrl,
} = require(path.join(__dirname, "../lib/middleware/webhookhandlermw"));
const {
  normalizeOptionalLoginNonce,
  buildLoginSigningMessageBytes,
  generateLoginNonce,
  clearLoginNonceReplayCacheForTests,
  tryConsumeLoginNonce,
} = require(path.join(__dirname, "../lib/auth/login-nonce"));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`not-passed ${name}: ${err.message}`);
  }
}

test("host-only webhook_url appends /hooks/wake", () => {
  assert.strictEqual(
    formatOutboundWebhookTargetUrl("peer.example.com:7443", "/hooks/wake"),
    "https://peer.example.com:7443/hooks/wake",
  );
});

test("pathful webhook_url is not doubled", () => {
  assert.strictEqual(
    formatOutboundWebhookTargetUrl(
      "peer.example.com:7443/hooks/agent",
      "/hooks/wake",
    ),
    "https://peer.example.com:7443/hooks/agent",
  );
});

test("scheme is stripped then re-applied as https", () => {
  assert.strictEqual(
    formatOutboundWebhookTargetUrl("https://peer.example.com", "/hooks/wake"),
    "https://peer.example.com/hooks/wake",
  );
});

test("normalizeOptionalLoginNonce treats missing as legacy null", () => {
  assert.deepStrictEqual(normalizeOptionalLoginNonce(undefined), { nonce: null });
  assert.deepStrictEqual(normalizeOptionalLoginNonce(""), { nonce: null });
});

test("normalizeOptionalLoginNonce rejects malformed", () => {
  const bad = normalizeOptionalLoginNonce("bad!!");
  assert.strictEqual(bad.errorCode, "INVALID_LOGIN_NONCE");
  assert.strictEqual(bad.nonce, null);
});

test("normalizeOptionalLoginNonce accepts base64url", () => {
  const nonce = generateLoginNonce();
  const ok = normalizeOptionalLoginNonce(nonce);
  assert.strictEqual(ok.nonce, nonce);
  assert.strictEqual(ok.errorCode, undefined);
});

test("buildLoginSigningMessageBytes binds nonce when present", () => {
  const legacy = Buffer.from(
    buildLoginSigningMessageBytes("tokenid", "2026-09-19T12:00:00.000Z", null),
  ).toString("utf8");
  const withNonce = Buffer.from(
    buildLoginSigningMessageBytes(
      "tokenid",
      "2026-09-19T12:00:00.000Z",
      "abc12345",
    ),
  ).toString("utf8");
  assert.strictEqual(legacy, "tokenid2026-09-19T12:00:00.000Z");
  assert.strictEqual(withNonce, "tokenid2026-09-19T12:00:00.000Zabc12345");
});

test("tryConsumeLoginNonce is single-use", () => {
  clearLoginNonceReplayCacheForTests();
  const nonce = generateLoginNonce();
  assert.strictEqual(tryConsumeLoginNonce("id", nonce), true);
  assert.strictEqual(tryConsumeLoginNonce("id", nonce), false);
  clearLoginNonceReplayCacheForTests();
});

console.log(`\nsept-2026-helpers.test.js: ${passed} passed, ${failed} not-passed`);
process.exit(failed > 0 ? 1 : 0);
