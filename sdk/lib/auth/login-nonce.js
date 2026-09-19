/**
 * Login challenge nonce helpers (optional additive field for POST /api/login).
 * When a nonce is present it is bound into the signed payload and single-use.
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

const crypto = require("crypto");
const config = require("../../services/configsdk");
const { unixTimeToDateString } = require("../../services/utils");

const LOGIN_NONCE_BYTES = 16;
const LOGIN_NONCE_MIN_LEN = 8;
const LOGIN_NONCE_MAX_LEN = 128;

/** @type {Map<string, { expiresAtMs: number, firstSeenAtMs: number }>} */
const loginNonceReplayCache = new Map();

/**
 * Cryptographic login nonce for challenges (base64url, 128-bit).
 * @returns {string}
 */
function generateLoginNonce() {
  return crypto.randomBytes(LOGIN_NONCE_BYTES).toString("base64url");
}

/**
 * Normalize optional login nonce from a request/challenge body.
 * Missing/empty → null (legacy timestamp-only login). Invalid → { error }.
 *
 * @param {*} rawNonce
 * @returns {{ nonce: string|null, error?: string, errorCode?: string }}
 */
function normalizeOptionalLoginNonce(rawNonce) {
  if (rawNonce === undefined || rawNonce === null) {
    return { nonce: null };
  }
  if (typeof rawNonce !== "string") {
    return {
      nonce: null,
      errorCode: "INVALID_LOGIN_NONCE",
      error: "Login nonce must be a string when provided",
    };
  }
  const trimmed = rawNonce.trim();
  if (trimmed.length === 0) {
    return { nonce: null };
  }
  if (
    trimmed.length < LOGIN_NONCE_MIN_LEN ||
    trimmed.length > LOGIN_NONCE_MAX_LEN
  ) {
    return {
      nonce: null,
      errorCode: "INVALID_LOGIN_NONCE",
      error: `Login nonce length must be between ${LOGIN_NONCE_MIN_LEN} and ${LOGIN_NONCE_MAX_LEN} characters`,
    };
  }
  // Reject whitespace / control characters inside the token.
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return {
      nonce: null,
      errorCode: "INVALID_LOGIN_NONCE",
      error:
        "Login nonce must be base64url or hex (letters, digits, '-', '_' only)",
    };
  }
  return { nonce: trimmed };
}

/**
 * Build UTF-8 bytes for login signature.
 * Legacy: identifier + timestamp_iso
 * With nonce: identifier + timestamp_iso + nonce
 *
 * @param {string} identifier
 * @param {string} timeString - ISO timestamp string
 * @param {string|null|undefined} nonce
 * @returns {Uint8Array}
 */
function buildLoginSigningMessageBytes(identifier, timeString, nonce) {
  const payload =
    nonce && String(nonce).length > 0
      ? String(identifier) + String(timeString) + String(nonce)
      : String(identifier) + String(timeString);
  return new TextEncoder().encode(payload);
}

function getLoginNonceReplayTtlMs() {
  const maxAgeSeconds = Number(
    config.get("API_DEFAULT_OPTIONS.TIMESTAMP_MAX_AGE", 300)
  );
  const seconds =
    Number.isFinite(maxAgeSeconds) && maxAgeSeconds > 0 ? maxAgeSeconds : 300;
  return seconds * 1000;
}

function cleanupExpiredLoginNonceEntries(nowMs = Date.now()) {
  for (const [key, entry] of loginNonceReplayCache.entries()) {
    if (!entry || entry.expiresAtMs <= nowMs) {
      loginNonceReplayCache.delete(key);
    }
  }
}

function buildLoginNonceReplayKey(nonce) {
  return String(nonce);
}

/**
 * Atomically consume a login nonce. Returns false if already used.
 * Call only after the signature that binds the nonce has verified.
 *
 * @param {string} identifier - roditid or accountid (reserved for future scoped caches / logging)
 * @param {string} nonce
 * @returns {boolean} true if consumed (first use), false if replay
 */
function tryConsumeLoginNonce(identifier, nonce) {
  if (!nonce) {
    return true;
  }
  const nowMs = Date.now();
  cleanupExpiredLoginNonceEntries(nowMs);
  const key = buildLoginNonceReplayKey(nonce);
  if (loginNonceReplayCache.has(key)) {
    return false;
  }
  loginNonceReplayCache.set(key, {
    expiresAtMs: nowMs + getLoginNonceReplayTtlMs(),
    firstSeenAtMs: nowMs,
    identifier: identifier ? String(identifier) : undefined,
  });
  return true;
}

/**
 * Host helper for GET /api/login/timestamp — issues timestamp + CSPRNG nonce.
 * Clients that understand nonce will bind it into the signature; older clients ignore it.
 *
 * @returns {Promise<{ timestamp: number, timestamp_iso: string, nonce: string }>}
 */
async function createLoginTimestampChallenge() {
  const timestamp = Math.floor(Date.now() / 1000);
  const timestamp_iso = await unixTimeToDateString(timestamp);
  return {
    timestamp,
    timestamp_iso,
    nonce: generateLoginNonce(),
  };
}

/** Test/support: clear replay cache (does not affect production callers). */
function clearLoginNonceReplayCacheForTests() {
  loginNonceReplayCache.clear();
}

module.exports = {
  generateLoginNonce,
  normalizeOptionalLoginNonce,
  buildLoginSigningMessageBytes,
  tryConsumeLoginNonce,
  createLoginTimestampChallenge,
  clearLoginNonceReplayCacheForTests,
  buildLoginNonceReplayKey,
};
