/**
 * Tests for resolve_peer_rodit_for_login (fetch priority: roditid, then accountid).
 */
const { test, afterEach } = require("node:test");
const assert = require("node:assert");
const sinon = require("sinon");
const path = require("path");

afterEach(() => {
  sinon.restore();
});

function clearAuthCache() {
  delete require.cache[path.resolve(__dirname, "../lib/auth/authentication.js")];
}

const hex64 = "a".repeat(64);

test("resolve_peer_rodit_for_login uses tokensfromaccountid when only accountid", async () => {
  clearAuthCache();
  const bc = require("../lib/blockchain/blockchainservice");
  const empty = new bc.RODiT();
  const fromId = sinon.stub(bc, "nearorg_rpc_tokenfromroditid").resolves(empty);
  const fromAcc = sinon
    .stub(bc, "nearorg_rpc_tokensfromaccountid")
    .resolves(null);

  const authentication = require("../lib/auth/authentication");
  await authentication.resolve_peer_rodit_for_login("", hex64);
  assert.strictEqual(fromId.called, false);
  assert.strictEqual(fromAcc.called, true);
  assert.strictEqual(fromAcc.firstCall.args[0], hex64);
});

test("resolve_peer_rodit_for_login does not call tokensfromaccountid for short id with no account", async () => {
  clearAuthCache();
  const bc = require("../lib/blockchain/blockchainservice");
  const empty = new bc.RODiT();
  sinon.stub(bc, "nearorg_rpc_tokenfromroditid").resolves(empty);
  const fromAcc = sinon
    .stub(bc, "nearorg_rpc_tokensfromaccountid")
    .resolves(null);

  const authentication = require("../lib/auth/authentication");
  await authentication.resolve_peer_rodit_for_login("short-token-id", "");
  assert.strictEqual(fromAcc.called, false);
});

test("resolve_peer_rodit_for_login returns null without RPC when both identifiers non-empty", async () => {
  clearAuthCache();
  const bc = require("../lib/blockchain/blockchainservice");
  const fromId = sinon.stub(bc, "nearorg_rpc_tokenfromroditid");
  const fromAcc = sinon.stub(bc, "nearorg_rpc_tokensfromaccountid");

  const authentication = require("../lib/auth/authentication");
  const pr = await authentication.resolve_peer_rodit_for_login("x", hex64);
  assert.strictEqual(pr, null);
  assert.strictEqual(fromId.called, false);
  assert.strictEqual(fromAcc.called, false);
});
