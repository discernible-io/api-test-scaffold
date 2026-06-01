#!/usr/bin/env node
/**
 * authenticate_apicall HTTP integration — 401 invalidated vs 403 invalid token, New-Token header.
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

"use strict";

const assert = require("assert");
const http = require("http");
const express = require("express");

process.env.NODE_CONFIG_ENV = process.env.NODE_CONFIG_ENV || "development";
process.env.NODE_ENV = process.env.NODE_ENV || "development";
process.env.SESSION_VALIDATION_CACHE_TTL = "0";
process.env.SECURITY_OPTIONS_THRESHOLD_VALIDATION_TYPE = "0";
process.env.SECURITY_OPTIONS_SESSION_SECRET =
  process.env.SECURITY_OPTIONS_SESSION_SECRET || "session-lifetime-http-test-secret";

const {
  sessionManager,
  InMemorySessionStorage,
  setStorage,
} = require("../lib/auth/sessionmanager");
const { installAuthMocks, decodeJwtPayload } = require("./helpers/session-auth-harness");

const harness = installAuthMocks();
const { authMw } = harness.reloadSdk();
const { authenticate_apicall } = authMw;
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

function createTestServer() {
  const app = express();
  app.get("/protected", authenticate_apicall, (req, res) => {
    res.status(200).json({
      ok: true,
      sub: req.user?.sub,
      sessionId: req.user?.session_id,
    });
  });
  return http.createServer(app);
}

function errorCode(body) {
  return body?.error?.code ?? body?.code;
}

function errorMessage(body) {
  return body?.error?.message ?? body?.message;
}

function httpGet(server, path, headers = {}) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(body);
          } catch (_e) {
            json = { raw: body };
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: json,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function withServer(fn) {
  const server = createTestServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(server);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

async function main() {
  console.log("[session-lifetime-http] Starting tests");

  await run("authenticate_apicall 401 MISSING_TOKEN without Authorization", async () => {
    await withServer(async (server) => {
      const res = await httpGet(server, "/protected");
      assert.strictEqual(res.status, 401);
      assert.strictEqual(errorCode(res.body), "MISSING_TOKEN");
    });
  });

  await run("authenticate_apicall 401 INVALIDATED_TOKEN when session revoked", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: peerRodit.token_id,
      ownerId: peerRodit.owner_id,
      createdAt: now,
      expiresAt: now + 7200,
      metadata: {},
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt,
      iat: now,
      exp: now + 1800,
    });
    await sessionManager.closeSession(session.id, "test");

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(errorCode(res.body), "INVALIDATED_TOKEN");
      const details = res.body.error?.details ?? res.body.details;
      assert.ok(details?.reason?.startsWith("session_status_"));
    });
  });

  await run("authenticate_apicall 401 INVALIDATED_TOKEN session_not_found", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const token = await signJwt({
      session_id: "sess_http_missing",
      session_iat: now,
      session_exp: now + 7200,
      iat: now,
      exp: now + 1800,
    });

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(errorCode(res.body), "INVALIDATED_TOKEN");
      const details = res.body.error?.details ?? res.body.details;
      assert.strictEqual(details?.reason, "session_not_found");
    });
  });

  await run("authenticate_apicall 401 INVALIDATED_TOKEN when session expired but exp valid", async () => {
    const now = wallNow();
    const past = now - 120;
    const sessionId = "sess_http_expired";
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
      exp: now + 1800,
    });

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(errorCode(res.body), "INVALIDATED_TOKEN");
      const details = res.body.error?.details ?? res.body.details;
      assert.strictEqual(details?.reason, "session_expired");
    });

    await resetSessionStorage();
  });

  await run("authenticate_apicall 403 INVALID_TOKEN on session_exp mismatch (014)", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: peerRodit.token_id,
      ownerId: peerRodit.owner_id,
      createdAt: now,
      expiresAt: now + 7200,
      metadata: {},
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt + 50,
      iat: now,
      exp: now + 1800,
    });

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(errorCode(res.body), "INVALID_TOKEN");
      assert.ok(String(errorMessage(res.body) || "").includes("Error 014"));
    });
  });

  await run("authenticate_apicall 200 with valid token", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: peerRodit.token_id,
      ownerId: peerRodit.owner_id,
      createdAt: now,
      expiresAt: now + 7200,
      metadata: {},
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now,
      session_exp: session.expiresAt,
      iat: now,
      exp: now + 1800,
    });

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.ok, true);
    });
  });

  await run("authenticate_apicall 200 sets New-Token when credential expired", async () => {
    await resetSessionStorage();
    const now = wallNow();
    const session = await sessionManager.createSession({
      roditId: peerRodit.token_id,
      ownerId: peerRodit.owner_id,
      createdAt: now - 200,
      expiresAt: now + 7200,
      metadata: {},
    });
    const token = await signJwt({
      session_id: session.id,
      session_iat: now - 200,
      session_exp: session.expiresAt,
      iat: now - 3600,
      nbf: now - 3600,
      exp: now - 5,
    });

    await withServer(async (server) => {
      const res = await httpGet(server, "/protected", {
        Authorization: `Bearer ${token}`,
      });
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers["new-token"], "expected New-Token response header");
      const renewed = decodeJwtPayload(res.headers["new-token"]);
      const original = decodeJwtPayload(token);
      assert.strictEqual(renewed.session_exp, original.session_exp);
      assert.ok(renewed.exp > now);
    });
  });

  console.log(`[session-lifetime-http] ${passed} passed, ${failed} failed`);
  harness.restore();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[session-lifetime-http] Fatal error", err);
  harness.restore();
  process.exit(1);
});
