#!/usr/bin/env node
/**
 * Native API login probe for contest / C4 transfer reports.
 *
 * Usage:
 *   NEAR_CREDENTIALS_FILE_PATH=/path/to/account.json \
 *   API_ENDPOINT=https://api.identyclaw.com \
 *   node examples/native-login.js
 *
 * Prints status, tokenId, and JWT header `jti`/`iat` only — never the JWT or private key.
 */
'use strict';

const fs = require('fs');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');

const credPath = process.env.NEAR_CREDENTIALS_FILE_PATH;
const api = (process.env.API_ENDPOINT || 'https://api.identyclaw.com').replace(/\/$/, '');

if (!credPath) {
  console.error('NEAR_CREDENTIALS_FILE_PATH is required');
  process.exit(2);
}

function decodeNearSecretKey(privateKey) {
  const raw = String(privateKey || '').replace(/^ed25519:/, '');
  const bytes = bs58.decode(raw);
  if (bytes.length === 64) return bytes;
  if (bytes.length === 32) return nacl.sign.keyPair.fromSeed(bytes).secretKey;
  throw new Error(`Unexpected private key length ${bytes.length}`);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function jwtMeta(jwt) {
  try {
    const mid = jwt.split('.')[1];
    const json = Buffer.from(mid + '='.repeat((4 - (mid.length % 4)) % 4), 'base64url').toString();
    const p = JSON.parse(json);
    return {
      jti: p.jti || p.sid || null,
      iat: p.iat || null,
      exp: p.exp || null,
      sub_prefix: typeof p.sub === 'string' ? `${p.sub.slice(0, 8)}…` : null,
    };
  } catch {
    return null;
  }
}

(async () => {
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const accountId = String(cred.implicit_account_id || cred.account_id || '').toLowerCase();
  const secretKey = decodeNearSecretKey(cred.private_key);
  const started = new Date().toISOString();

  const tsRes = await fetch(`${api}/api/login/timestamp`, { headers: { Accept: 'application/json' } });
  const tsBody = await tsRes.json().catch(() => ({}));
  if (!tsRes.ok) {
    console.log(JSON.stringify({
      ok: false,
      step: 'timestamp',
      utc: started,
      api,
      account_prefix: `${accountId.slice(0, 8)}…${accountId.slice(-8)}`,
      http_status: tsRes.status,
      error: tsBody.error || tsBody,
    }, null, 2));
    process.exit(1);
  }

  const message = Buffer.from(`${accountId}${tsBody.timestamp_iso}`, 'utf8');
  const signature = nacl.sign.detached(message, secretKey);
  const loginRes = await fetch(`${api}/api/login`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountid: accountId,
      timestamp: tsBody.timestamp,
      base64url_signature: b64url(signature),
    }),
  });
  const loginBody = await loginRes.json().catch(() => ({}));
  const jwt = loginBody.jwt_token || loginRes.headers.get('New-Token') || loginRes.headers.get('new-token');

  if (!loginRes.ok || !jwt) {
    console.log(JSON.stringify({
      ok: false,
      step: 'login',
      utc: started,
      api,
      account_prefix: `${accountId.slice(0, 8)}…${accountId.slice(-8)}`,
      http_status: loginRes.status,
      error_code: loginBody?.error?.code || null,
      error_message: loginBody?.error?.message || null,
    }, null, 2));
    process.exit(1);
  }

  const meRes = await fetch(`${api}/api/me/identity`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${jwt}` },
  });
  const meBody = await meRes.json().catch(() => ({}));
  const meta = jwtMeta(jwt);

  console.log(JSON.stringify({
    ok: meRes.ok,
    step: 'login+me',
    utc: started,
    api,
    account_prefix: `${accountId.slice(0, 8)}…${accountId.slice(-8)}`,
    http_status_login: loginRes.status,
    http_status_me: meRes.status,
    tokenId: meBody.tokenId || null,
    displayName: meBody?.dn?.displayName || null,
    jwt_jti: meta?.jti || null,
    jwt_iat: meta?.iat || null,
  }, null, 2));
  process.exit(meRes.ok ? 0 : 1);
})().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
  process.exit(1);
});
