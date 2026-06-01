#!/usr/bin/env node
/**
 * validate_jwt_token_be session registration (010–014) and credential renewal.
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

"use strict";

const assert = require("assert");

process.env.NODE_CONFIG_ENV = process.env.NODE_CONFIG_ENV || "development";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SESSION_VALIDATION_CACHE_TTL = "0";
process.env.SECURITY_OPTIONS_THRESHOLD_VALIDATION_TYPE = "0";

const {
  sessionManager,
  InMemorySessionStorage,
  setStorage,
} = require("../lib/auth/sessionmanager");
const {
  installAuthMocks,
  decodeJwtPayload,
  expectValidationError,
} = require("./helpers/session-auth-harness");

const harness = installAuthMocks();
const { tokenservice } = harness.reloadSdk();
const { validate_jwt_token_be, checkandrenew_jwt_token } = tokenservice;
const { ownRodit, peerRodit, signJwt } = harness;

let passed = 0;
let failed = 0;

function wallNow() {
  return Math.floor(Date.now() / 1000);
}

async function run(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err.stack || err);
  }
}

async function resetSessionStorage() {
  const storage = new InMemorySessionStorage();
  await storage.clear();
  setStorage(storage);
  sessionManager._validationCache.clear();
  sessionManager._validationCacheTTL = 0;
}

async function seedActiveSession({ roditId, ownerId, createdAt, expiresAt }) {
  return sessionManager.createSession({
    roditId: roditId || peerRodit.token_id,
    ownerId: ownerId || peerRodit.owner_id,
    createdAt,
    expiresAt,
    metadata: {},
  });
}

async function main() {
  console.log("[session-lifetime-validation] Starting tests");

  await run("validate_jwt_token_be passes for active registered session", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now,
      expiresAt: now + 7200,
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt,
      iat: now,
      exp: now + 1800,
    });
    const result = await validate_jwt_token_be(token, ownRodit);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.payload.session_id, session.id);
  });

  await run("validate_jwt_token_be Error 010 missing session_id", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const token = await signJwt({
      iat: now,
      exp: now + 1800,
      session_exp: now + 7200,
    });
    assert.strictEqual(decodeJwtPayload(token).session_id, undefined);
    await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 010");
  });

  await run("validate_jwt_token_be Error 011 unknown session_id", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const token = await signJwt({
      session_id: "sess_unknown_011",
      session_iat: now,
      session_exp: now + 7200,
      iat: now,
      exp: now + 1800,
    });
    await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 011");
  });

  await run("validate_jwt_token_be Error 012 session not active", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now,
      expiresAt: now + 7200,
    });
    await sessionManager.closeSession(session.id, "test");
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt,
      iat: now,
      exp: now + 1800,
    });
    await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 012");
  });

  await run("validate_jwt_token_be Error 013 session expired in storage", async () => {
    const now = wallNow();
    const past = now - 120;
    const sessionId = "sess_validate_013";
    setStorage({
      get: async (id) =>
        id === sessionId
          ? {
              id: sessionId,
              roditId: peerRodit.token_id,
              ownerId: peerRodit.owner_id,
              createdAt: past - 3600,
              expiresAt: past,
              lastAccessedAt: past,
              status: "active",
              metadata: {},
            }
          : null,
      set: async () => true,
      delete: async () => true,
      keys: async () => [sessionId],
      size: async () => 1,
      clear: async () => true,
    });
    sessionManager._validationCache.clear();

    const token = await signJwt({
      session_id: sessionId,
      session_iat: past - 3600,
      session_exp: past,
      iat: now - 60,
      exp: now + 3600,
    });
    await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 013");
    await resetSessionStorage();
  });

  await run("validate_jwt_token_be Error 014 session_exp mismatch", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now,
      expiresAt: now + 7200,
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt + 99,
      iat: now,
      exp: now + 1800,
    });
    await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 014");
  });

  await run("validate_jwt_token_be renews expired credential, preserves session_exp", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now - 100,
      expiresAt: now + 7200,
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now - 100,
      session_exp: session.expiresAt,
      iat: now - 3600,
      nbf: now - 3600,
      exp: now - 10,
    });
    const result = await validate_jwt_token_be(token, ownRodit);
    assert.strictEqual(result.valid, true);
    assert.ok(result.newToken, "expected New-Token from renewal");
    const renewed = decodeJwtPayload(result.newToken);
    const original = decodeJwtPayload(token);
    assert.strictEqual(renewed.session_exp, original.session_exp);
    assert.strictEqual(renewed.session_iat, original.session_iat);
    assert.ok(renewed.exp > now);
    assert.ok(renewed.exp <= renewed.session_exp);
    assert.notStrictEqual(renewed.jti, original.jti);
  });

  await run("checkandrenew_jwt_token proactive renewal below eligibility threshold", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now - 800,
      expiresAt: now + 7200,
    });
    const iat = now - 800;
    const exp = now + 100;
    const payload = {
      ...(await decodeJwtPayload(
        await signJwt({
          session_id: session.id,
          session_iat: iat,
          session_exp: session.expiresAt,
          iat,
          exp,
        }),
      )),
    };
    const renewal = await checkandrenew_jwt_token(payload, now, "test-renewal", false);
    assert.ok(renewal.newToken, "expected proactive renewal");
    const renewed = decodeJwtPayload(renewal.newToken);
    assert.strictEqual(renewed.session_exp, payload.session_exp);
    assert.ok(renewed.exp > now);
  });

  await run("validate_jwt_token_be Error 007 when renewal fails", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await seedActiveSession({
      createdAt: now - 100,
      expiresAt: now + 7200,
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now - 100,
      session_exp: session.expiresAt,
      iat: now - 3600,
      nbf: now - 3600,
      exp: now - 5,
    });

    const configSdk = require("../services/configsdk");
    const origGet = configSdk.get.bind(configSdk);
    configSdk.get = (key, defaultValue) => {
      if (key === "SECURITY_OPTIONS.THRESHOLD_VALIDATION_TYPE") {
        return "1.0";
      }
      return origGet(key, defaultValue);
    };

    const authentication = require("../lib/auth/authentication");
    const savedMatch = authentication.verify_rodit_isamatch;
    authentication.verify_rodit_isamatch = async () => ({
      isMatch: false,
      verificationType: "unit_test",
      failureReason: "forced_renewal_failure",
      failureMessage: "forced for Error 007 test",
    });

    try {
      await expectValidationError(validate_jwt_token_be, token, ownRodit, "Error 007");
    } finally {
      authentication.verify_rodit_isamatch = savedMatch;
      configSdk.get = origGet;
    }
  });

  console.log(`[session-lifetime-validation] ${passed} passed, ${failed} failed`);
  harness.restore();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[session-lifetime-validation] Fatal error", err);
  harness.restore();
  process.exit(1);
});
