/**
 * Mocks blockchain / peer verification and provides signed JWT fixtures for session tests.
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

"use strict";

const crypto = require("crypto");
const nacl = require("tweetnacl");

const RESTORES = [];

function saveRestore(obj, key) {
  RESTORES.push({ obj, key, value: obj[key] });
}

function restoreAll() {
  while (RESTORES.length > 0) {
    const { obj, key, value } = RESTORES.pop();
    obj[key] = value;
  }
}

function clearModuleCache(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  Object.keys(require.cache).forEach((id) => {
    if (id.startsWith(resolved.replace(/index\.js$/, "")) || id === resolved) {
      // only drop exact module; dependents re-required explicitly
    }
  });
  delete require.cache[resolved];
}

function dropDependentModules() {
  const targets = [
    "../lib/auth/tokenservice",
    "../lib/middleware/authenticationmw",
    "../lib/auth/authentication",
  ];
  targets.forEach((rel) => {
    try {
      clearModuleCache(require.resolve(rel));
    } catch (_e) {
      /* not loaded */
    }
  });
}

function mockRodit({ jwtDuration = "3600", notAfter = "1970-01-01", tokenId, ownerId }) {
  const token_id = tokenId || `rodit.${Math.random().toString(36).slice(2, 8)}`;
  return {
    token_id,
    owner_id: ownerId || `${token_id}.owner`,
    metadata: {
      jwt_duration: jwtDuration,
      not_after: notAfter,
      not_before: "1970-01-01",
      subjectuniqueidentifier_url: "https://session-test.example/api",
      serviceprovider_id: "sp.session-test",
      max_requests: "1000",
      maxrq_window: "3600",
      permissioned_routes: "",
      webhook_cidr: "",
      allowed_cidr: "",
      allowed_iso3166list: "",
      webhook_url: "",
    },
  };
}

function ed25519PrivateKeyObject(secretKey) {
  const seed = secretKey instanceof Uint8Array ? secretKey.slice(0, 32) : secretKey;
  return crypto.createPrivateKey({
    key: Buffer.concat([
      Buffer.from("302e020100300506032b657004220420", "hex"),
      Buffer.from(seed),
    ]),
    format: "der",
    type: "pkcs8",
  });
}

/**
 * Install mocks and return { keyPair, ownRodit, peerRodit, signJwt, reloadSdk }.
 */
function installAuthMocks() {
  restoreAll();

  const keyPair = nacl.sign.keyPair();
  const ownRodit = mockRodit({ tokenId: "own.session-test", ownerId: "own.session-test.near" });
  const peerRodit = mockRodit({ tokenId: "peer.session-test", ownerId: "peer.session-test.near" });

  const blockchain = require("../../lib/blockchain/blockchainservice");
  saveRestore(blockchain, "nearorg_rpc_tokenfromroditid");
  saveRestore(blockchain, "nearorg_rpc_fetchpublickeybytes");
  saveRestore(blockchain, "nearorg_rpc_tokensfromaccountid");

  blockchain.nearorg_rpc_tokenfromroditid = async (roditId) => ({
    token_id: roditId || ownRodit.token_id,
    owner_id: ownRodit.owner_id,
    metadata: { ...ownRodit.metadata },
  });

  blockchain.nearorg_rpc_fetchpublickeybytes = async () => Buffer.from(keyPair.publicKey);

  blockchain.nearorg_rpc_tokensfromaccountid = async (accountId) => ({
    token_id: peerRodit.token_id,
    owner_id: accountId,
    metadata: { ...peerRodit.metadata, not_after: peerRodit.metadata.not_after },
  });

  const authentication = require("../../lib/auth/authentication");
  saveRestore(authentication, "resolve_peer_rodit_for_login");
  saveRestore(authentication, "verify_peer_rodit");

  authentication.resolve_peer_rodit_for_login = async () => peerRodit;
  authentication.verify_peer_rodit = async () => ({
    peer_rodit: peerRodit,
    goodrodit: true,
    failureReason: null,
    failureMessage: null,
  });

  const stateManager = require("../../lib/blockchain/statemanager");
  saveRestore(stateManager, "getConfigOwnRodit");

  stateManager.getConfigOwnRodit = () => ({
    own_rodit: ownRodit,
    own_rodit_bytes_private_key: keyPair.secretKey,
  });

  dropDependentModules();

  async function signJwt(claims) {
    const { SignJWT } = await import("jose");
    const now = Math.floor(Date.now() / 1000);
    const sub =
      claims.sub ||
      `${peerRodit.metadata.serviceprovider_id};sub=${peerRodit.token_id}`;
    const payload = {
      iss: claims.iss || ownRodit.metadata.subjectuniqueidentifier_url,
      sub,
      aud: claims.aud || ownRodit.owner_id,
      exp: claims.exp ?? now + 3600,
      nbf: claims.nbf ?? now - 10,
      iat: claims.iat ?? now - 10,
      jti: claims.jti || `jti${now}`,
      rodit_id: claims.rodit_id || ownRodit.token_id,
      rodit_owner: claims.rodit_owner || ownRodit.owner_id,
      rodit_idsignature: claims.rodit_idsignature || "test-signature",
      rodit_maxrequests: peerRodit.metadata.max_requests,
      rodit_maxrqwindow: peerRodit.metadata.maxrq_window,
      rodit_permissionedroutes: "",
      rodit_webhookcidr: "",
      rodit_allowedcidr: "",
      rodit_allowediso3166list: "",
      rodit_webhookurl: "",
      session_id: claims.session_id,
      session_iat: claims.session_iat ?? claims.iat ?? now - 10,
      session_exp: claims.session_exp ?? now + 7200,
      session_status: claims.session_status || "new",
      ...claims,
    };

    return new SignJWT(payload)
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .sign(ed25519PrivateKeyObject(keyPair.secretKey));
  }

  function reloadSdk() {
    dropDependentModules();
    return {
      tokenservice: require("../../lib/auth/tokenservice"),
      authMw: require("../../lib/middleware/authenticationmw"),
    };
  }

  return {
    keyPair,
    ownRodit,
    peerRodit,
    signJwt,
    reloadSdk,
    restore: restoreAll,
  };
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("expected JWT compact serialization");
  }
  return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
}

async function expectValidationError(validateFn, token, ownRodit, fragment) {
  let threw = false;
  try {
    await validateFn(token, ownRodit, { enforceSessionRegistration: true });
  } catch (err) {
    threw = true;
    assertMessageIncludes(err.message, fragment);
  }
  if (!threw) {
    throw new Error(`expected validation to throw containing "${fragment}"`);
  }
}

function assertMessageIncludes(message, fragment) {
  if (!message || !String(message).includes(fragment)) {
    throw new Error(`expected message to include "${fragment}", got: ${message}`);
  }
}

module.exports = {
  installAuthMocks,
  restoreAll,
  mockRodit,
  decodeJwtPayload,
  expectValidationError,
  assertMessageIncludes,
  ed25519PrivateKeyObject,
};
