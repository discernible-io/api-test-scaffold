/**
 * Contract tests for login_client (POST /api/login body shape).
 */
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const sinon = require("sinon");
const path = require("path");

const configsdk = require("../services/configsdk");
const stateManager = require("../lib/blockchain/statemanager");

afterEach(() => {
  sinon.restore();
});

function clearModuleCachesForLoginMw() {
  for (const rel of [
    "../lib/middleware/authenticationmw.js",
    "../lib/auth/authentication.js",
  ]) {
    delete require.cache[path.resolve(__dirname, rel)];
  }
}

function loadLoginClientWithStubs({
  verifyResult,
  jwtToken = "mock-jwt-token",
  configOwnRodit,
}) {
  clearModuleCachesForLoginMw();
  const authentication = require("../lib/auth/authentication");
  const tokenservice = require("../lib/auth/tokenservice");
  sinon
    .stub(authentication, "resolve_peer_rodit_for_login")
    .resolves(verifyResult.peer_rodit);
  const verifyStub = sinon
    .stub(authentication, "verify_peer_rodit")
    .resolves(verifyResult);
  sinon.stub(tokenservice, "generate_jwt_token").resolves(jwtToken);
  sinon.stub(configsdk, "get").returns(false);
  sinon.stub(stateManager, "getConfigOwnRodit").resolves(
    configOwnRodit || {
      own_rodit: {
        token_id: "own",
        metadata: { serviceprovider_id: "bc=n;sc=c;id=own" },
      },
      own_rodit_bytes_private_key: new Uint8Array(64),
    }
  );
  const { login_client } = require("../lib/middleware/authenticationmw");
  return { login_client, verifyStub };
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
}

function baseReq(overrides = {}) {
  return {
    body: {},
    ip: "127.0.0.1",
    headers: {},
    ...overrides,
  };
}

test("login_client rejects deprecated body keys with LOGIN_PAYLOAD_DEPRECATED", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        roditid: "01K4G3D95QF6NR0RSJK9WEK6KA",
        timestamp: 1,
        base64url_signature: "abc",
        roditid_base64url_signature: "old",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "LOGIN_PAYLOAD_DEPRECATED");
});

test("login_client returns MISSING_LOGIN_IDENTIFIER", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({ body: { timestamp: 1, base64url_signature: "x" } }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "MISSING_LOGIN_IDENTIFIER");
});

test("login_client returns MISSING_BASE64URL_SIGNATURE", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({
      body: { roditid: "01K4G3D95QF6NR0RSJK9WEK6KA", timestamp: 1 },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "MISSING_BASE64URL_SIGNATURE");
});

test("login_client accepts login_server wire: roditid_base64url_signature only", async () => {
  const { login_client, verifyStub } = loadLoginClientWithStubs({
    verifyResult: {
      goodrodit: true,
      peer_rodit: {
        token_id: "01K4G3D95QF6NR0RSJK9WEK6KA",
        owner_id: "ab".repeat(32),
        metadata: { serviceprovider_id: "bc=n;sc=c;id=test" },
      },
    },
  });

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        roditid: "01K4G3D95QF6NR0RSJK9WEK6KA",
        timestamp: 100,
        roditid_base64url_signature: "dGVzdA",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(verifyStub.called, true);
});

test("login_client succeeds with roditid and returns jwt_token", async () => {
  const { login_client } = loadLoginClientWithStubs({
    verifyResult: {
      goodrodit: true,
      peer_rodit: {
        token_id: "01K4G3D95QF6NR0RSJK9WEK6KA",
        owner_id: "ab".repeat(32),
        metadata: { serviceprovider_id: "bc=n;sc=c;id=test" },
      },
    },
  });

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        roditid: "01K4G3D95QF6NR0RSJK9WEK6KA",
        timestamp: 100,
        base64url_signature: "dGVzdA",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.jwt_token, "mock-jwt-token");
  assert.ok(res.body.requestId);
});

test("login_client rejects LOGIN_IDENTIFIER_AMBIGUOUS when both roditid and accountid are non-empty", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        roditid: "01K4G3D95QF6NR0RSJK9WEK6KA",
        accountid: "a".repeat(64),
        timestamp: 100,
        base64url_signature: "dGVzdA",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "LOGIN_IDENTIFIER_AMBIGUOUS");
});

test("login_client rejects account_id (snake_case) as deprecated", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        accountid: "a".repeat(64),
        timestamp: 1,
        base64url_signature: "x",
        account_id: "should-not-be-here",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "LOGIN_PAYLOAD_DEPRECATED");
});

test("login_client rejects legacy signature field", async () => {
  clearModuleCachesForLoginMw();
  sinon.stub(configsdk, "get").returns(false);
  const { login_client } = require("../lib/middleware/authenticationmw");

  const res = mockRes();
  await login_client(
    baseReq({
      body: {
        roditid: "01K4G3D95QF6NR0RSJK9WEK6KA",
        timestamp: 1,
        base64url_signature: "ok",
        signature: "nope",
      },
    }),
    res
  );
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.error, "LOGIN_PAYLOAD_DEPRECATED");
});
