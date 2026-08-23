/**
 * Performance SLO utilities — end-to-end client latency (fetch), SPEC_PERF_* gates.
 * Uses curl/fetch login (not login_server) per test-rodit-constitution.md § Performance SLOs.
 */

"use strict";

const nacl = require("tweetnacl");
const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const { unixTimeToDateString } = require("../../sdk/services/utils");
const { fetchDirect, bearerAuthorizationHeader } = require("./test-utils");
const {
  getSecretKeyBytesForRole,
  signUtf8MessageWithSecretKey,
  loadPrimaryKeyPair,
} = require("../test-utils/near-test-credentials");

/** Constitution gate IDs — thresholds in milliseconds unless noted. */
const PERF_SPECS = {
  SPEC_PERF_LOGIN_TIMESTAMP_P95_MS: { p95MaxMs: 250, minSamples: 30, class: "S1" },
  SPEC_PERF_LOGIN_POST_P95_MS: { p95MaxMs: 400, minSamples: 20, class: "S1" },
  SPEC_PERF_HOLANONCE_P95_MS: { p95MaxMs: 150, minSamples: 50, class: "S2" },
  SPEC_PERF_JWT_PROTECTED_NOP_P95_MS: { p95MaxMs: 200, minSamples: 30, class: "S2" },
  SPEC_PERF_ME_IDENTITY_P95_MS: { p95MaxMs: 1200, minSamples: 20, class: "S3" },
  SPEC_PERF_VERIFY_HOLA_P95_MS: { p95MaxMs: 1500, minSamples: 15, class: "S3" },
  SPEC_PERF_AGENTS_LIST_P95_MS: { p95MaxMs: 800, minSamples: 15, class: "S4" },
  SPEC_PERF_HEALTH_P95_MS: { p95MaxMs: 200, minSamples: 20, class: null },
  SPEC_PERF_CHAIN_READ_RATIO_MAX: 0.1,
};

/** Performance test tags (test-rodit-constitution.md § Performance SLOs). */
const PERF_TAG_MAIN = "@perf-main";
const PERF_TAG_GATE = "@perf-gate";
const PERF_TAG_METRIC = "@perf-metric";
const PERF_TAG_DEGRADED = "@perf-degraded";

const NEAR_RPC_METRIC_KEYS = [
  "near_identity_get_token",
  "blockchainCalls",
];

const HOLA_CHECKSUM_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(samplesMs, p) {
  if (!samplesMs.length) {
    return null;
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function computeP95(samplesMs) {
  return percentile(samplesMs, 0.95);
}

function computeP50(samplesMs) {
  return percentile(samplesMs, 0.5);
}

function computeMax(samplesMs) {
  if (!samplesMs.length) {
    return null;
  }
  return Math.max(...samplesMs);
}

function discardWarmup(samplesMs) {
  if (samplesMs.length <= 1) {
    return samplesMs;
  }
  return samplesMs.slice(1);
}

function classifyMetricStatus(p95, targetP95Ms, sampleCount = null, minSamples = null) {
  if (sampleCount != null && minSamples != null && sampleCount < minSamples) {
    return "fail";
  }
  if (!Number.isFinite(p95)) {
    return "fail";
  }
  if (p95 <= targetP95Ms) {
    return "pass";
  }
  return "warn";
}

/**
 * @perf-metric — record p50/p95/max vs SPEC_PERF_* target; does not block deploy.
 */
function evaluateP95Metric(specId, samplesMs, extra = {}) {
  const spec = PERF_SPECS[specId];
  if (!spec) {
    throw new Error(`Unknown perf spec: ${specId}`);
  }
  const measured = discardWarmup(samplesMs);
  const p50 = computeP50(measured);
  const p95 = computeP95(measured);
  const max = computeMax(measured);
  const status = classifyMetricStatus(p95, spec.p95MaxMs, measured.length, spec.minSamples);

  return {
    specId,
    classification: "perf-metric",
    p50,
    p95,
    max,
    targetP95Ms: spec.p95MaxMs,
    status,
    sampleCount: measured.length,
    minSamples: spec.minSamples,
    class: spec.class,
    ...extra,
  };
}

/** @deprecated Prefer evaluateP95Metric for latency; evaluateP95Gate kept for unit tests. */
function evaluateP95Gate(specId, samplesMs, extra = {}) {
  const metric = evaluateP95Metric(specId, samplesMs, extra);
  const passed = metric.status === "pass";

  return {
    ...metric,
    passed,
    p95MaxMs: metric.targetP95Ms,
    error: passed
      ? undefined
      : `SPEC_PERF gate ${specId}: p95=${metric.p95}ms (max ${metric.targetP95Ms}ms), samples=${metric.sampleCount} (min ${metric.minSamples})`,
  };
}

function isInfraAbortError(err) {
  const msg = String(err?.message || err || "");
  return (
    err?.perfInfraAbort === true ||
    msg.includes("fetch failed") ||
    msg.includes("HTTP 502") ||
    msg.includes("returned HTTP 502") ||
    msg.includes("INFRA ABORT")
  );
}

function wrapInfraAbort(err) {
  const base = err instanceof Error ? err : new Error(String(err));
  base.perfInfraAbort = true;
  if (!base.message.includes("INFRA ABORT")) {
    base.message = `INFRA ABORT: ${base.message}`;
  }
  return base;
}

function buildSteadyPollMetricSeries(pollSamples, renewals) {
  const renewalIndices = new Set((renewals || []).map((r) => r.pollIndex));
  const allSamples = pollSamples.map((p) => p.durationMs);
  const nonRenewalSamples = pollSamples
    .filter((p) => !renewalIndices.has(p.pollIndex))
    .map((p) => p.durationMs);
  const renewalSamples = pollSamples
    .filter((p) => renewalIndices.has(p.pollIndex))
    .map((p) => p.durationMs);

  return {
    s2_non_renewal_p95Ms: computeP95(discardWarmup(nonRenewalSamples)),
    s2_renewal_p95Ms: renewalSamples.length ? computeP95(renewalSamples) : null,
    s2_all_polls_p95Ms: computeP95(discardWarmup(allSamples)),
  };
}

function logPerfGate(specId, detail, passed) {
  logger.info(`PERF GATE    ${specId}  ${detail}  ${passed ? "PASS" : "FAIL"}`);
}

function logPerfMetric(specId, metric, gateHint) {
  const status = String(metric?.status || "unknown").toUpperCase();
  const p95 = metric?.p95 ?? metric?.p95Ms ?? "?";
  const target = metric?.targetP95Ms ?? "?";
  const gateSuffix = gateHint ? `  (gate: ${gateHint})` : "";
  logger.info(`PERF METRIC  ${specId}  p95=${p95}ms target=${target}ms  ${status}${gateSuffix}`);
}

function emitPerfJsonRecord(runId, specId, record) {
  logger.info("PERF record", {
    runId,
    specId,
    ...record,
  });
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Full bootstrap login via fetch (timestamp + local sign + POST /api/login).
 * @returns {Promise<{ jwt: string, loginMs: number, roditid: string }>}
 */
async function loginViaFetch(apiEndpoint, configOwnRodit) {
  const ownRodit = configOwnRodit?.own_rodit;
  const privateKey = configOwnRodit?.own_rodit_bytes_private_key;
  const roditid = String(ownRodit?.token_id || "").trim();

  if (!roditid || !privateKey) {
    throw new Error("loginViaFetch requires own_rodit.token_id and own_rodit_bytes_private_key");
  }

  const started = Date.now();

  const tsResponse = await fetchDirect(apiEndpoint, "/api/login/timestamp", { method: "GET" });
  const tsBody = await readJsonSafe(tsResponse);
  if (!tsResponse.ok) {
    throw new Error(`GET /api/login/timestamp failed: HTTP ${tsResponse.status}`);
  }

  const timestamp = Number(tsBody?.timestamp);
  if (!Number.isFinite(timestamp)) {
    throw new Error("GET /api/login/timestamp returned invalid timestamp");
  }

  const timeString = await unixTimeToDateString(timestamp);
  const signatureBytes = nacl.sign.detached(
    new TextEncoder().encode(roditid + timeString),
    privateKey
  );

  const loginResponse = await fetchDirect(apiEndpoint, "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roditid,
      timestamp,
      roditid_base64url_signature: Buffer.from(signatureBytes).toString("base64url"),
    }),
  });

  const loginBody = await readJsonSafe(loginResponse);
  if (!loginResponse.ok) {
    throw new Error(
      `POST /api/login failed: HTTP ${loginResponse.status} ${JSON.stringify(loginBody)?.slice(0, 200)}`
    );
  }

  const jwt = loginBody?.jwt_token || loginBody?.token;
  if (!jwt) {
    throw new Error("POST /api/login succeeded but no jwt_token in body");
  }

  return {
    jwt,
    roditid,
    loginMs: Date.now() - started,
    timestamp,
  };
}

async function timedFetch(apiEndpoint, path, init = {}) {
  const started = Date.now();
  const response = await fetchDirect(apiEndpoint, path, init);
  const durationMs = Date.now() - started;
  return { response, durationMs, status: response.status };
}

async function fetchHealthStatus(apiEndpoint) {
  const { response, durationMs } = await timedFetch(apiEndpoint, "/health", { method: "GET" });
  const body = await readJsonSafe(response);
  return {
    ok: response.ok,
    status: response.status,
    durationMs,
    healthStatus: body?.status ?? null,
    body,
  };
}

async function assertPerfMainHealth(apiEndpoint) {
  let health;
  try {
    health = await fetchHealthStatus(apiEndpoint);
  } catch (err) {
    throw wrapInfraAbort(err);
  }
  if (!health.ok) {
    if (health.status === 502) {
      throw wrapInfraAbort(new Error(`@perf-main setup: GET /health returned HTTP ${health.status}`));
    }
    throw new Error(`@perf-main setup: GET /health returned HTTP ${health.status}`);
  }
  if (health.healthStatus === "degraded") {
    throw new Error(
      `@perf-main setup: /health status is degraded — SLO runs require status healthy (use @perf-degraded suite for degraded probes)`
    );
  }
  if (health.healthStatus !== "healthy") {
    throw new Error(
      `@perf-main setup: /health status=${health.healthStatus ?? "unknown"} (expected healthy)`
    );
  }
  return health;
}

function bytesToBase32(bytes) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function computeHolaChecksum(messagePrefix) {
  let sum = 0;
  for (let i = 0; i < messagePrefix.length; i++) {
    sum += messagePrefix.charCodeAt(i);
  }
  return HOLA_CHECKSUM_ALPHABET[sum % 23];
}

function signHolaMessage(messageUpper) {
  const secretKeyBytes = getSecretKeyBytesForRole("primary");
  const signatureBytes = signUtf8MessageWithSecretKey(messageUpper, secretKeyBytes);
  return bytesToBase32(signatureBytes);
}

/**
 * Build a fresh HOLA for POST /api/identity/verify (unique nonce per call).
 */
async function buildFreshHolaForVerify(apiEndpoint, jwt, roditid) {
  const nonceResult = await timedFetch(apiEndpoint, "/api/holanonce16ts", {
    method: "GET",
    headers: {
      Authorization: bearerAuthorizationHeader(jwt),
      "X-Request-ID": ulid(),
    },
  });

  if (!nonceResult.response.ok) {
    throw new Error(`holanonce16ts failed: HTTP ${nonceResult.status}`);
  }

  const nonceBody = await readJsonSafe(nonceResult.response);
  const noncetsHex = String(nonceBody?.noncetsHex || nonceBody?.noncets_hex || "").toUpperCase();
  const timestamp = nonceBody?.timestamp || new Date().toISOString();
  const tokenId = String(roditid).toLowerCase();
  const rawPrefix = `HOLA/MUNDO/${tokenId}/${timestamp}/${noncetsHex}/API.IDENTYCLAW.COM/`;
  const canonical = rawPrefix.toUpperCase();
  const signature = signHolaMessage(canonical);
  const checksum = computeHolaChecksum(`${canonical}${signature}/`);
  return `${canonical}${signature}/${checksum}`;
}

function findMetricValue(metricsBody, metricName) {
  if (!metricsBody || typeof metricsBody !== "object") {
    return null;
  }

  const searchObjects = [
    metricsBody.metrics,
    metricsBody.counters,
    metricsBody.endpointMetrics,
    metricsBody,
  ];

  for (const obj of searchObjects) {
    if (!obj || typeof obj !== "object") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(obj, metricName)) {
      const value = Number(obj[metricName]);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

function readChainMetricSnapshot(metricsBody) {
  for (const key of NEAR_RPC_METRIC_KEYS) {
    const value = findMetricValue(metricsBody, key);
    if (value != null) {
      return { key, value };
    }
  }
  return { key: null, value: null };
}

async function fetchApiMetrics(apiEndpoint, jwt) {
  const { response } = await timedFetch(apiEndpoint, "/api/metrics", {
    method: "GET",
    headers: {
      Authorization: bearerAuthorizationHeader(jwt),
      "X-Request-ID": ulid(),
    },
  });

  if (response.status === 401 || response.status === 403) {
    return { available: false, status: response.status, body: null };
  }

  if (!response.ok) {
    return { available: false, status: response.status, body: await readJsonSafe(response) };
  }

  const body = await readJsonSafe(response);
  return { available: true, status: response.status, body };
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") {
    return null;
  }
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  PERF_SPECS,
  PERF_TAG_MAIN,
  PERF_TAG_GATE,
  PERF_TAG_METRIC,
  PERF_TAG_DEGRADED,
  NEAR_RPC_METRIC_KEYS,
  computeP50,
  computeP95,
  computeMax,
  discardWarmup,
  classifyMetricStatus,
  evaluateP95Metric,
  evaluateP95Gate,
  isInfraAbortError,
  wrapInfraAbort,
  buildSteadyPollMetricSeries,
  logPerfGate,
  logPerfMetric,
  emitPerfJsonRecord,
  loginViaFetch,
  timedFetch,
  fetchHealthStatus,
  assertPerfMainHealth,
  buildFreshHolaForVerify,
  findMetricValue,
  readChainMetricSnapshot,
  fetchApiMetrics,
  decodeJwtPayload,
  sleep,
  readJsonSafe,
  loadPrimaryKeyPair,
};
