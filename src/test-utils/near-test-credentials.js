/**
 * NEAR credentials for integration tests.
 * - Primary (agent): NEAR_CREDENTIALS_JSON_B64 via SDK config (secrets.env)
 * - Peer (P2P / subagent): NEAR_TEST_PEER_CREDENTIALS_JSON_B64 from secrets/testing.env only
 */

const nacl = require("tweetnacl");
const bs58 = require("bs58");
const config = require("../../sdk/services/configsdk");

const PRIMARY_ENV_VAR = "NEAR_CREDENTIALS_JSON_B64";
const PEER_ENV_VAR = "NEAR_TEST_PEER_CREDENTIALS_JSON_B64";

function parseNearCredentialsJsonB64(rawValue) {
  if (rawValue == null || (typeof rawValue === "string" && rawValue.trim() === "")) {
    return null;
  }

  let parsed;
  if (typeof rawValue === "string") {
    try {
      const decoded = Buffer.from(rawValue, "base64").toString("utf8");
      parsed = JSON.parse(decoded);
    } catch (_) {
      parsed = JSON.parse(rawValue);
    }
  } else {
    parsed = rawValue;
  }

  if (!parsed || typeof parsed !== "object" || !parsed.private_key) {
    throw new Error("NEAR credentials JSON must include private_key");
  }

  return parsed;
}

function loadPrimaryNearCredentials() {
  const raw =
    config.get(PRIMARY_ENV_VAR, process.env[PRIMARY_ENV_VAR] || null);
  const credentials = parseNearCredentialsJsonB64(raw);
  if (!credentials) {
    throw new Error(
      `${PRIMARY_ENV_VAR} is not set (configure via host secrets/secrets.env)`
    );
  }
  return credentials;
}

/** Peer credentials are test-only; never read through SDK config. */
function loadPeerNearCredentials() {
  const raw = process.env[PEER_ENV_VAR];
  const credentials = parseNearCredentialsJsonB64(raw);
  if (!credentials) {
    throw new Error(
      `${PEER_ENV_VAR} is not set (configure via host secrets/testing.env)`
    );
  }
  return credentials;
}

function secretKeyBytesFromNearCredentials(credentials) {
  const privateKeyBase58 = credentials.private_key.replace(/^ed25519:/, "");
  return new Uint8Array(bs58.decode(privateKeyBase58));
}

function loadKeyPairFromNearCredentials(credentials, keyType = "unknown") {
  const secretKeyBytes = secretKeyBytesFromNearCredentials(credentials);
  return nacl.sign.keyPair.fromSecretKey(secretKeyBytes);
}

function loadPrimaryKeyPair() {
  return loadKeyPairFromNearCredentials(loadPrimaryNearCredentials(), "primary");
}

function loadPeerKeyPair() {
  return loadKeyPairFromNearCredentials(loadPeerNearCredentials(), "peer");
}

function primaryCredentialsAvailable() {
  try {
    loadPrimaryNearCredentials();
    return true;
  } catch (_) {
    return false;
  }
}

function peerCredentialsAvailable() {
  try {
    loadPeerNearCredentials();
    return true;
  } catch (_) {
    return false;
  }
}

function signMessageBytesWithSecretKey(messageBytes, secretKeyBytes) {
  return nacl.sign.detached(messageBytes, secretKeyBytes);
}

function signUtf8MessageWithSecretKey(message, secretKeyBytes) {
  const messageBytes = nacl.util.decodeUTF8(message);
  return signMessageBytesWithSecretKey(messageBytes, secretKeyBytes);
}

/**
 * @param {string} message
 * @param {'primary'|'peer'} [role]
 */
function getSecretKeyBytesForRole(role = "primary") {
  const credentials =
    role === "peer" ? loadPeerNearCredentials() : loadPrimaryNearCredentials();
  return secretKeyBytesFromNearCredentials(credentials);
}

module.exports = {
  PRIMARY_ENV_VAR,
  PEER_ENV_VAR,
  parseNearCredentialsJsonB64,
  loadPrimaryNearCredentials,
  loadPeerNearCredentials,
  loadKeyPairFromNearCredentials,
  loadPrimaryKeyPair,
  loadPeerKeyPair,
  primaryCredentialsAvailable,
  peerCredentialsAvailable,
  secretKeyBytesFromNearCredentials,
  signMessageBytesWithSecretKey,
  signUtf8MessageWithSecretKey,
  getSecretKeyBytesForRole,
};
