# `/api/testhola` Past Run Teaching Snapshot (Non-Replay)

This document is for teaching and forensic walkthrough only.
It captures one historical execution exactly as observed in logs and source, including stale identifiers and timestamps.
Do **not** run this as a live validation scenario.

## Historical run identity

- Suite run id: `8359711d-69ac-48e2-965d-f96519110ff8`
- Environment endpoint: `https://api.identyclaw.com`
- Primary tests in this snapshot:
  - `testTesthola` (invalid HOLA path, expects `400`)
  - `testTestholaEndpoint` (multi-step path; in this run returned `401` for valid/invalid HOLA because noncets fetch failed)

## Exact test logic used at that time

Source: `src/test-modules/identyclaw-api.js`

### 1) `testTesthola` (simple invalid payload)

```js
const invalidHola = "INVALID/HOLA/FORMAT";
await client.request("POST", "/api/testhola", { hello: invalidHola });
// Expected behavior: throws with status 400
```

### 2) `testTestholaEndpoint` (3-step test)

```js
// Test 1: valid HOLA (generated from API noncets/timestamp in real time)
const validHola = await generateValidHola(client, { recipient: "MUNDO" });
await fetch(`${apiEndpoint}/api/testhola`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ hello: validHola }),
});

// Test 2: stale/invalid HOLA sample embedded in source (missing checksum)
const invalidHola =
  "HOLA/MUNDO/aaaaaaaaaaaa/2026-04-04T10:10:00Z/4F9A3C7E2D1B9A4C/API.IDENTYCLAW.COM/n3FZ5kQ8/Lh2BsM1xY";
await fetch(`${apiEndpoint}/api/testhola`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ hello: invalidHola }),
});

// Test 3: content-type check
await fetch(`${apiEndpoint}/api/testhola`, {
  method: "POST",
  headers: { "Content-Type": "text/plain", Authorization: `Bearer ${jwt}` },
  body: validHola,
});
```

## Captured historical values (from logs)

### `testTesthola` observed execution

- `startTime`: `2026-04-28T06:28:50.153Z`
- `testId`: `ac0ed4c1-73b9-46ce-8db0-f66fdf363981`
- `correlationId`: `01KQ9CDCBAAEYAEMMVT1QHBK9K`
- `roditId` in test setup: `bjbvcjzqbdsj`
- peer token lookup id seen during auth checks: `bfsdcdcpsmzt`
- blockchain ownership check timestamp: `1777357730`
- request URL: `https://api.identyclaw.com/api/testhola`
- RoditClient requestId at failure: `01KQ9CDCKTGH74YXS5ADW72W05`
- observed result: `Request failed with status 400`, then test marked passed

### `testTestholaEndpoint` observed execution

- `startTime`: `2026-04-28T06:29:11.215Z`
- `testId`: `a7aaf470-c7b2-4855-9538-9933aa18e20d`
- `correlationId`: `01KQ9CE0XG99FVE7NEDPXQRGHK`
- setup `requestId`: `01KQ9CE0XKN8XV4GRV3KJF403V`
- account id in setup:
  `0192a65a46f1e34b8ff430b419f6f8bbe4544a573e1b28e6fe9ae8b065406287`
- logged warning: `Failed to fetch noncets: 401`
- final test summary fields:
  - `validStatus: 401`
  - `invalidStatus: 401`
  - `got400: false`
  - `got415: true`

## Why this is documentation-only

- The HOLA protocol is freshness-sensitive (timestamp + noncets + signature/checksum path).
- Values shown here are intentionally historical/stale artifacts from a completed run.
- This snapshot is meant to explain **what happened** and **how the execution progressed**, not to be replayed for server-side acceptance.
