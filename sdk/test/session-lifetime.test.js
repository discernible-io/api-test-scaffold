#!/usr/bin/env node
/**
 * Session vs JWT credential lifetime — unit tests
 *
 * Two clocks:
 * - session_exp / SessionManager.expiresAt — how long the login is authorized
 * - exp / iat / jti — short-lived credential, renewed until session ends
 *
 * Run: node sdk/test/session-lifetime.test.js
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

"use strict";

const assert = require("assert");
const nacl = require("tweetnacl");

// Isolate config before loading auth modules
process.env.NODE_CONFIG_ENV = process.env.NODE_CONFIG_ENV || "development";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SESSION_VALIDATION_CACHE_TTL = "0";

const config = require("../services/configsdk");
const {
  parseRoditJwtDurationSeconds,
  resolveSessionExpirationUnix,
  resolveCredentialExpirationUnix,
  generate_jwt_token,
} = require("../lib/auth/tokenservice");
const {
  sessionManager,
  InMemorySessionStorage,
  setStorage,
} = require("../lib/auth/sessionmanager");

/** Fixed epoch for resolve* math (no storage wall-clock interaction). */
const LOGIN_NOW = 1_000_000;
const originalGetSessionTtlSeconds = config.getSessionTtlSeconds.bind(config);

function wallNow() {
  return Math.floor(Date.now() / 1000);
}

let passed = 0;
let failed = 0;

function decodeJwtPayload(token) {
  const parts = token.split(".");
  assert.strictEqual(parts.length, 3, "expected JWT compact form");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

function withSessionTtlSeconds(ttlSeconds, fn) {
  config.getSessionTtlSeconds = () => {
    if (ttlSeconds === null || ttlSeconds === undefined) {
      return originalGetSessionTtlSeconds();
    }
    if (ttlSeconds <= 0) {
      return null;
    }
    return Math.floor(ttlSeconds);
  };
  return fn().finally(() => {
    config.getSessionTtlSeconds = originalGetSessionTtlSeconds;
  });
}

function mockRodit({ jwtDuration, notAfter = "1970-01-01", tokenId = "rodit.test" }) {
  return {
    token_id: tokenId,
    owner_id: `${tokenId}.owner`,
    metadata: {
      jwt_duration: jwtDuration,
      not_after: notAfter,
      not_before: "1970-01-01",
      subjectuniqueidentifier_url: "https://example.test/api",
      serviceprovider_id: "sp.test",
      max_requests: "100",
      maxrq_window: "60",
      permissioned_routes: "",
      webhook_cidr: "",
      allowed_cidr: "",
      allowed_iso3166list: "",
      webhook_url: "",
    },
  };
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

async function main() {
  console.log("[session-lifetime] Starting tests");

  await run("parseRoditJwtDurationSeconds uses valid metadata", async () => {
    assert.strictEqual(parseRoditJwtDurationSeconds({ jwt_duration: "7200" }), 7200);
  });

  await run("parseRoditJwtDurationSeconds falls back when invalid", async () => {
    const fallback = config.getDefaultJwtDurationSeconds();
    assert.strictEqual(parseRoditJwtDurationSeconds({ jwt_duration: "nope" }), fallback);
    assert.strictEqual(parseRoditJwtDurationSeconds({}), fallback);
    assert.strictEqual(parseRoditJwtDurationSeconds({ jwt_duration: "0" }), fallback);
  });

  await run("resolveSessionExpirationUnix uses SESSION_TTL_SECONDS when configured", async () => {
    await withSessionTtlSeconds(5200, async () => {
      const peer = mockRodit({ jwtDuration: 7200, tokenId: "peer.ttl" });
      const own = mockRodit({ jwtDuration: 3600, tokenId: "own.ttl" });
      const sessionExp = await resolveSessionExpirationUnix(peer, own, LOGIN_NOW);
      assert.strictEqual(sessionExp, LOGIN_NOW + 5200);
    });
  });

  await run("resolveSessionExpirationUnix uses max(peer, own) jwt_duration when TTL disabled", async () => {
    await withSessionTtlSeconds(0, async () => {
      const peer = mockRodit({ jwtDuration: 7200, tokenId: "peer.passport" });
      const own = mockRodit({ jwtDuration: 3600, tokenId: "own.passport" });
      const sessionExp = await resolveSessionExpirationUnix(peer, own, LOGIN_NOW);
      assert.strictEqual(sessionExp, LOGIN_NOW + 7200);
    });
  });

  await run("resolveSessionExpirationUnix applies not_after caps", async () => {
    await withSessionTtlSeconds(0, async () => {
      const capUnix = LOGIN_NOW + 1800;
      const capDate = new Date(capUnix * 1000).toISOString().slice(0, 10);
      const peer = mockRodit({ jwtDuration: 7200, notAfter: capDate, tokenId: "peer.cap" });
      const own = mockRodit({ jwtDuration: 3600, tokenId: "own.cap" });
      const sessionExp = await resolveSessionExpirationUnix(peer, own, LOGIN_NOW);
      assert.ok(sessionExp <= capUnix, `sessionExp ${sessionExp} should be <= cap ${capUnix}`);
    });
  });

  await run("resolveCredentialExpirationUnix caps exp at session end", async () => {
    const sessionExp = LOGIN_NOW + 1800;
    const own = mockRodit({ jwtDuration: 7200 });
    const credExp = resolveCredentialExpirationUnix(LOGIN_NOW, sessionExp, own);
    assert.strictEqual(credExp, sessionExp);
    assert.ok(credExp <= sessionExp);
  });

  await run("resolveCredentialExpirationUnix uses own jwt_duration when shorter than session", async () => {
    const sessionExp = LOGIN_NOW + 7200;
    const own = mockRodit({ jwtDuration: 3600 });
    const credExp = resolveCredentialExpirationUnix(LOGIN_NOW, sessionExp, own);
    assert.strictEqual(credExp, LOGIN_NOW + 3600);
    assert.ok(credExp <= sessionExp);
  });

  await run("isTokenInvalidated false for active session", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: "rodit.active",
      ownerId: "owner.active",
      createdAt: now,
      expiresAt: now + 3600,
      metadata: {},
    });
    const token = buildUnsignedJwtPayloadToken({
      session_id: session.id,
      session_exp: session.expiresAt,
      exp: now + 600,
    });
    const invalidated = await sessionManager.isTokenInvalidated(token);
    assert.strictEqual(invalidated, false);
  });

  await run("isTokenInvalidated true when session missing", async () => {
    await resetSessionStorage();
    const token = buildUnsignedJwtPayloadToken({
      session_id: "missing-session-id",
      session_exp: LOGIN_NOW + 3600,
      exp: LOGIN_NOW + 600,
    });
    assert.strictEqual(await sessionManager.isTokenInvalidated(token), true);
    const info = await sessionManager.getTokenInvalidationInfo(token);
    assert.strictEqual(info.reason, "session_not_found");
  });

  await run("isTokenInvalidated true when session closed", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: "rodit.closed",
      ownerId: "owner.closed",
      createdAt: now,
      expiresAt: now + 3600,
      metadata: {},
    });
    await sessionManager.closeSession(session.id, "test");
    const token = buildUnsignedJwtPayloadToken({
      session_id: session.id,
      session_exp: session.expiresAt,
      exp: now + 600,
    });
    assert.strictEqual(await sessionManager.isTokenInvalidated(token), true);
    const info = await sessionManager.getTokenInvalidationInfo(token);
    assert.ok(info.reason.startsWith("session_status_"));
  });

  await run("isTokenInvalidated true when session expiresAt passed", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const past = now - 60;
    const sessionId = "sess_expired_stub";
    const expiredSession = {
      id: sessionId,
      roditId: "rodit.expired",
      ownerId: "owner.expired",
      createdAt: past - 3600,
      expiresAt: past,
      lastAccessedAt: past,
      status: "active",
      metadata: {},
    };
    // InMemorySessionStorage purges expired rows on get(); stub storage to assert session_expired reason.
    setStorage({
      get: async (id) => (id === sessionId ? expiredSession : null),
      set: async () => true,
      delete: async () => true,
      keys: async () => [sessionId],
      size: async () => 1,
      clear: async () => true,
    });
    sessionManager._validationCache.clear();

    const token = buildUnsignedJwtPayloadToken({
      session_id: sessionId,
      session_exp: past,
      exp: now + 3600,
    });
    assert.strictEqual(await sessionManager.isTokenInvalidated(token), true);
    const info = await sessionManager.getTokenInvalidationInfo(token);
    assert.strictEqual(info.reason, "session_expired");
  });

  await run("isTokenInvalidated true for malformed JWT", async () => {
    await resetSessionStorage();
    assert.strictEqual(await sessionManager.isTokenInvalidated("not-a-jwt"), true);
    const info = await sessionManager.getTokenInvalidationInfo("not-a-jwt");
    assert.strictEqual(info.reason, "invalid_jwt_format");
  });

  await run("isTokenInvalidated true when session_id missing in payload", async () => {
    await resetSessionStorage();
    const token = buildUnsignedJwtPayloadToken({
      session_exp: LOGIN_NOW + 3600,
      exp: LOGIN_NOW + 600,
    });
    assert.strictEqual(await sessionManager.isTokenInvalidated(token), true);
    const info = await sessionManager.getTokenInvalidationInfo(token);
    assert.strictEqual(info.reason, "no_session_id_in_token");
  });

  await run("generate_jwt_token aligns session_exp, storage expiresAt, and caps exp", async () => {
    await resetSessionStorage();
    await withSessionTtlSeconds(3600, async () => {
      const now = wallNow();
      const keyPair = nacl.sign.keyPair();
      const peer = mockRodit({ jwtDuration: 7200, tokenId: "peer.login" });
      const own = mockRodit({ jwtDuration: 7200, tokenId: "own.login" });

      const jwt = await generate_jwt_token(
        peer,
        now,
        own,
        keyPair.secretKey,
        "new",
      );

      const payload = decodeJwtPayload(jwt);
      const stored = await sessionManager.getSession(payload.session_id);

      assert.ok(stored, "session should exist in storage");
      assert.strictEqual(payload.session_iat, now);
      assert.strictEqual(payload.session_exp, now + 3600);
      assert.strictEqual(stored.expiresAt, payload.session_exp);
      assert.ok(payload.exp <= payload.session_exp, "credential must not outlive session");
      assert.strictEqual(payload.exp, payload.session_exp);
    });
  });

  await run("generate_jwt_token keeps short credential when session is longer", async () => {
    await resetSessionStorage();
    await withSessionTtlSeconds(7200, async () => {
      const now = wallNow();
      const keyPair = nacl.sign.keyPair();
      const peer = mockRodit({ jwtDuration: 7200, tokenId: "peer.long" });
      const own = mockRodit({ jwtDuration: 1800, tokenId: "own.short" });

      const jwt = await generate_jwt_token(peer, now, own, keyPair.secretKey, "new");
      const payload = decodeJwtPayload(jwt);

      assert.strictEqual(payload.session_exp, now + 7200);
      assert.strictEqual(payload.exp, now + 1800);
      assert.ok(payload.exp < payload.session_exp);
    });
  });

  console.log(`[session-lifetime] ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

/**
 * Minimal JWT-shaped string for SessionManager decode paths (signature not verified here).
 */
function buildUnsignedJwtPayloadToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

main().catch((err) => {
  console.error("[session-lifetime] Fatal error", err);
  process.exit(1);
});
