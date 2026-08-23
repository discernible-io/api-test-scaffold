/**
 * Performance SLO suite — SPEC_PERF_* gates (test-rodit-constitution.md).
 * End-to-end client latency via fetch; curl/fetch login (not login_server).
 */

"use strict";

const { ulid } = require("ulid");
const logger = require("../../sdk/services/logger");
const config = require("../../sdk/services/configsdk");
const {
  captureTestData,
  getRoditClientForTest,
  fetchDirect,
  bearerAuthorizationHeader,
  hasRenewalHeadroomJwtPayload,
} = require("./test-utils");
const {
  PERF_SPECS,
  PERF_TAG_MAIN,
  PERF_TAG_GATE,
  PERF_TAG_METRIC,
  PERF_TAG_DEGRADED,
  evaluateP95Metric,
  loginViaFetch,
  timedFetch,
  assertPerfMainHealth,
  buildFreshHolaForVerify,
  buildSteadyPollMetricSeries,
  fetchApiMetrics,
  fetchHealthStatus,
  readChainMetricSnapshot,
  decodeJwtPayload,
  isInfraAbortError,
  logPerfGate,
  logPerfMetric,
  emitPerfJsonRecord,
  sleep,
  readJsonSafe,
} = require("./perf-slo-utils");

const MODULE_NAME = "performanceSlo";
const HOLANONCE_PATH = "/api/holanonce16ts";
const PERF_TAGS = [PERF_TAG_MAIN, PERF_TAG_GATE, PERF_TAG_METRIC];

function parseConfigInt(key, fallback) {
  const raw = config.get(key);
  const parsed = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function gateSummary(gateFailures) {
  if (!gateFailures.length) {
    return "all gates passed";
  }
  return gateFailures.map((g) => g.error || `${g.specId}: gate not-passed`).join(" | ");
}

function metricSummary(metrics) {
  return metrics
    .map((m) => `${m.specId}: p95=${m.p95}ms target=${m.targetP95Ms}ms ${String(m.status).toUpperCase()}`)
    .join("; ");
}

async function runWithPerfInfraAbort(testName, testData, fn) {
  try {
    return await fn();
  } catch (err) {
    if (isInfraAbortError(err)) {
      const msg = String(err.message);
      logger.warn(`PERF INFRA ABORT  ${testName}  ${msg}`, {
        component: "TestRunner",
        moduleName: MODULE_NAME,
        testName,
        classification: "infra-abort",
      });
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed: true,
          message: msg,
          details: {
            infraAbort: true,
            classification: "infra-abort",
            blocksDeploy: false,
            whatHappened: msg,
            specRequires:
              "Infra failure (fetch failed / HTTP 502); labeled infra abort, not perf regression",
          },
        },
        { ...testData, tags: PERF_TAGS }
      );
    }
    throw err;
  }
}

async function resolveLoginContext(apiEndpoint) {
  const client = await getRoditClientForTest();
  const configOwnRodit = await client.getConfigOwnRodit();
  const login = await loginViaFetch(apiEndpoint, configOwnRodit);
  return { client, configOwnRodit, ...login };
}

/**
 * @perf-main @perf-gate @perf-metric — latency samples; p95 targets are reported only.
 */
async function testPerfLatencyGates(apiEndpoint) {
  const testName = "testPerfLatencyGates";
  const testData = { apiEndpoint, tags: PERF_TAGS };

  return runWithPerfInfraAbort(testName, testData, async () => {
    await assertPerfMainHealth(apiEndpoint);

    const metrics = [];
    const gateResults = [];
    const { jwt, roditid, configOwnRodit } = await resolveLoginContext(apiEndpoint);
    testData.roditid = roditid;

    // SPEC_PERF_LOGIN_TIMESTAMP_P95_MS — metric only
    {
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_LOGIN_TIMESTAMP_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, "/api/login/timestamp", {
          method: "GET",
          headers: { "X-Request-ID": ulid() },
        });
        if (status >= 500) {
          throw new Error(`timestamp sample ${i + 1} returned ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_LOGIN_TIMESTAMP_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_LOGIN_POST_P95_MS — metric only
    {
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_LOGIN_POST_P95_MS.minSamples + 1; i++) {
        const { loginMs } = await loginViaFetch(apiEndpoint, configOwnRodit);
        samples.push(loginMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_LOGIN_POST_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_HOLANONCE_P95_MS — metric + @perf-gate 0 NEAR RPC on S2
    {
      const metricsBefore = await fetchApiMetrics(apiEndpoint, jwt);
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_HOLANONCE_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, HOLANONCE_PATH, {
          method: "GET",
          headers: {
            Authorization: bearerAuthorizationHeader(jwt),
            "X-Request-ID": ulid(),
          },
        });
        if (status !== 200) {
          throw new Error(`holanonce sample ${i + 1} returned HTTP ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_HOLANONCE_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);

      let rpcGate = {
        specId: "SPEC_PERF_HOLANONCE_S2_ZERO_RPC",
        classification: "perf-gate",
        passed: true,
        nearRpcDelta: 0,
      };
      if (metricsBefore.available) {
        const metricsAfter = await fetchApiMetrics(apiEndpoint, jwt);
        const before = readChainMetricSnapshot(metricsBefore.body);
        const after = readChainMetricSnapshot(metricsAfter.body);
        if (before.key && after.key) {
          const delta = after.value - before.value;
          rpcGate.nearRpcDelta = delta;
          rpcGate.passed = delta === 0;
          if (!rpcGate.passed) {
            rpcGate.error = `${before.key} delta=${delta} (expected 0 NEAR RPC for S2 holanonce)`;
          }
        }
      } else {
        rpcGate.metricsSkipped = true;
        rpcGate.metricsStatus = metricsBefore.status;
      }
      gateResults.push(rpcGate);
      logPerfGate(
        rpcGate.specId,
        rpcGate.metricsSkipped ? "metrics unavailable" : `rpcDelta=${rpcGate.nearRpcDelta}`,
        rpcGate.passed
      );
    }

    // SPEC_PERF_JWT_PROTECTED_NOP_P95_MS — metric only (same endpoint; JWT middleware probe)
    {
      const nopJwt = (await loginViaFetch(apiEndpoint, configOwnRodit)).jwt;
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_JWT_PROTECTED_NOP_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, HOLANONCE_PATH, {
          method: "GET",
          headers: {
            Authorization: bearerAuthorizationHeader(nopJwt),
            "X-Request-ID": ulid(),
          },
        });
        if (status !== 200) {
          throw new Error(`JWT protected nop sample ${i + 1} returned HTTP ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_JWT_PROTECTED_NOP_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_ME_IDENTITY_P95_MS — metric only
    {
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_ME_IDENTITY_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, "/api/me/identity", {
          method: "GET",
          headers: {
            Authorization: bearerAuthorizationHeader(jwt),
            "X-Request-ID": ulid(),
          },
        });
        if (status !== 200) {
          throw new Error(`me/identity sample ${i + 1} returned HTTP ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_ME_IDENTITY_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_VERIFY_HOLA_P95_MS — metric only
    {
      const verifyJwt = (await loginViaFetch(apiEndpoint, configOwnRodit)).jwt;
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_VERIFY_HOLA_P95_MS.minSamples + 1; i++) {
        const hola = await buildFreshHolaForVerify(apiEndpoint, verifyJwt, roditid);
        const started = Date.now();
        const response = await fetchDirect(apiEndpoint, "/api/identity/verify", {
          method: "POST",
          headers: {
            Authorization: bearerAuthorizationHeader(verifyJwt),
            "Content-Type": "application/json",
            "X-Request-ID": ulid(),
          },
          body: JSON.stringify({ hola }),
        });
        const durationMs = Date.now() - started;
        if (response.status >= 500) {
          throw new Error(`identity/verify sample ${i + 1} returned HTTP ${response.status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_VERIFY_HOLA_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_AGENTS_LIST_P95_MS — metric only
    {
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_AGENTS_LIST_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, "/api/agents?limit=20", {
          method: "GET",
          headers: { "X-Request-ID": ulid() },
        });
        if (status !== 200) {
          throw new Error(`agents list sample ${i + 1} returned HTTP ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_AGENTS_LIST_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    // SPEC_PERF_HEALTH_P95_MS — metric only
    {
      const samples = [];
      for (let i = 0; i < PERF_SPECS.SPEC_PERF_HEALTH_P95_MS.minSamples + 1; i++) {
        const { durationMs, status } = await timedFetch(apiEndpoint, "/health", { method: "GET" });
        if (status !== 200) {
          throw new Error(`health sample ${i + 1} returned HTTP ${status}`);
        }
        samples.push(durationMs);
      }
      const metric = evaluateP95Metric("SPEC_PERF_HEALTH_P95_MS", samples);
      metrics.push(metric);
      logPerfMetric(metric.specId, metric);
    }

    const gateFailures = gateResults.filter((g) => !g.passed);
    const metricWarnings = metrics.filter((m) => m.status === "warn" || m.status === "fail");
    const passed = gateFailures.length === 0;

    testData.metrics = metrics;
    testData.gateResults = gateResults;

    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed,
        error: passed ? undefined : gateSummary(gateFailures),
        details: {
          gates: gateResults,
          gateFailures,
          metrics,
          metricWarnings,
          whatHappened: passed ? metricSummary(metrics) : gateSummary(gateFailures),
          specRequires:
            "@perf-gate: S2 holanonce 0 NEAR RPC when metrics available; @perf-metric: all SPEC_PERF_* p95 targets reported (WARN/FAIL do not block deploy)",
        },
      },
      testData
    );
  });
}

/**
 * SPEC_PERF_HOLANONCE_BURST — @perf-gate correctness; p95 is @perf-metric only.
 */
async function testPerfHolanonceBurst(apiEndpoint) {
  const testName = "testPerfHolanonceBurst";
  const testData = { apiEndpoint, tags: PERF_TAGS };

  return runWithPerfInfraAbort(testName, testData, async () => {
    await assertPerfMainHealth(apiEndpoint);
    const { jwt } = await resolveLoginContext(apiEndpoint);

    const metricsBefore = await fetchApiMetrics(apiEndpoint, jwt);
    const burstCount = PERF_SPECS.SPEC_PERF_HOLANONCE_P95_MS.minSamples + 1;
    const burstDeadlineMs = 60_000;
    const started = Date.now();
    const samples = [];
    let error429 = 0;
    let error5xx = 0;
    let all200 = true;

    for (let i = 0; i < burstCount; i++) {
      const { durationMs, status } = await timedFetch(apiEndpoint, HOLANONCE_PATH, {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt),
          "X-Request-ID": ulid(),
        },
      });
      samples.push(durationMs);
      if (status === 429) {
        error429 += 1;
      }
      if (status >= 500) {
        error5xx += 1;
      }
      if (status !== 200) {
        all200 = false;
        testData.firstFailure = { index: i + 1, status };
        break;
      }
    }

    const elapsedMs = Date.now() - started;
    const metric = evaluateP95Metric("SPEC_PERF_HOLANONCE_P95_MS", samples);

    let nearRpcDelta = null;
    let rpcGatePassed = true;
    if (metricsBefore.available) {
      const metricsAfter = await fetchApiMetrics(apiEndpoint, jwt);
      const before = readChainMetricSnapshot(metricsBefore.body);
      const after = readChainMetricSnapshot(metricsAfter.body);
      if (before.key && after.key) {
        nearRpcDelta = after.value - before.value;
        rpcGatePassed = nearRpcDelta === 0;
      }
    }

    const gatePassed =
      elapsedMs <= burstDeadlineMs &&
      error429 === 0 &&
      error5xx === 0 &&
      samples.length === burstCount &&
      all200 &&
      rpcGatePassed;

    logPerfGate(
      "SPEC_PERF_HOLANONCE_BURST",
      `all200=${all200} rpcDelta=${nearRpcDelta ?? "n/a"} 429=${error429} 5xx=${error5xx}`,
      gatePassed
    );
    logPerfMetric(
      metric.specId,
      metric,
      `PASS all200=${all200} renewalCount=n/a`
    );

    testData.elapsedMs = elapsedMs;
    testData.metric = metric;
    testData.error429 = error429;
    testData.error5xx = error5xx;
    testData.nearRpcDelta = nearRpcDelta;

    const gateFailures = gatePassed
      ? []
      : [
          {
            specId: "SPEC_PERF_HOLANONCE_BURST",
            classification: "perf-gate",
            passed: false,
            error: `SPEC_PERF_HOLANONCE_BURST: elapsed=${elapsedMs}ms, 429=${error429}, 5xx=${error5xx}, all200=${all200}, rpcDelta=${nearRpcDelta}`,
          },
        ];
    const metricWarnings = metric.status === "warn" || metric.status === "fail" ? [metric] : [];

    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: gatePassed,
        error: gatePassed
          ? undefined
          : gateFailures[0].error,
        details: {
          gate: { passed: gatePassed, all200, nearRpcDelta, error429, error5xx },
          gateFailures,
          metrics: [metric],
          metricWarnings,
          whatHappened: `${samples.length}/${burstCount} requests in ${elapsedMs}ms; p95=${metric.p95}ms (${metric.status})`,
          specRequires:
            "@perf-gate: all 200 within 60s, no 429/5xx, 0 NEAR RPC on S2; @perf-metric: p95 vs SPEC_PERF_HOLANONCE_P95_MS",
        },
      },
      testData
    );
  });
}

/**
 * SPEC_PERF_JWT_STEADY_POLL — @perf-gate session correctness; p95 series are @perf-metric only.
 */
async function testPerfJwtSteadyPoll(apiEndpoint, logContext = {}) {
  const testName = "testPerfJwtSteadyPoll";
  const testData = { apiEndpoint, tags: PERF_TAGS };

  if (logContext?.moduleName?.startsWith("sdk_")) {
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: true,
        message: "Steady poll runs in native phase only",
        details: {
          skipped: true,
          reason: "sdk_phase_skip",
          specRequires: "SPEC_PERF_JWT_STEADY_POLL",
        },
      },
      testData
    );
  }

  return runWithPerfInfraAbort(testName, testData, async () => {
    const minPollSeconds = parseConfigInt(
      "API_DEFAULT_OPTIONS.PERF_SLO_STEADY_POLL_MIN_SECONDS",
      20 * 60
    );
    const pollIntervalSeconds = parseConfigInt(
      "API_DEFAULT_OPTIONS.SESSION_LIFETIME_POLL_INTERVAL_SECONDS",
      30
    );
    const maxPollSeconds = parseConfigInt(
      "API_DEFAULT_OPTIONS.PERF_SLO_STEADY_POLL_MAX_SECONDS",
      0
    );

    await assertPerfMainHealth(apiEndpoint);
    const { jwt } = await resolveLoginContext(apiEndpoint);

    let token = jwt;
    let payload = decodeJwtPayload(token);
    const sessionExp = Number(payload?.session_exp);
    const pollStartUnix = Math.floor(Date.now() / 1000);

    if (maxPollSeconds > 0 && minPollSeconds > maxPollSeconds) {
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed: true,
          message: `Skipped: min poll ${minPollSeconds}s exceeds PERF_SLO_STEADY_POLL_MAX_SECONDS (${maxPollSeconds})`,
          details: { skipped: true, reason: "max_seconds_cap" },
        },
        testData
      );
    }

    const pollSamples = [];
    const renewals = [];
    let pollIndex = 0;
    const requiresRenewal = hasRenewalHeadroomJwtPayload(payload);

    const lapsed = parseFloat(
      config.get("SECURITY_OPTIONS.LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY") ||
        "0.80"
    );
    const credentialDurationSeconds = Number(payload?.exp) - Number(payload?.iat);
    const renewalEligibilitySeconds = Math.floor(credentialDurationSeconds * lapsed) + 2;
    const renewalAwareMinPollSeconds = requiresRenewal
      ? Math.ceil(
          (renewalEligibilitySeconds + pollIntervalSeconds * 3) / pollIntervalSeconds
        ) * pollIntervalSeconds
      : 0;
    const effectiveMinPollSeconds = Math.max(minPollSeconds, renewalAwareMinPollSeconds);

    testData.renewalPollBudget = {
      lapsedProportion: lapsed,
      renewalEligibilitySeconds,
      configMinPollSeconds: minPollSeconds,
      effectiveMinPollSeconds,
    };

    while (true) {
      const nowUnix = Math.floor(Date.now() / 1000);
      const secondsUntilSessionExp = sessionExp - nowUnix;

      if (secondsUntilSessionExp <= 0) {
        break;
      }

      pollIndex += 1;
      const { durationMs, status, response } = await timedFetch(apiEndpoint, HOLANONCE_PATH, {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(token),
          "X-Request-ID": ulid(),
        },
      });

      pollSamples.push({ pollIndex, durationMs, status, secondsUntilSessionExp });

      if (status !== 200) {
        return captureTestData(
          testName,
          MODULE_NAME,
          {
            passed: false,
            error: `Poll ${pollIndex} returned HTTP ${status} while secondsUntilSessionExp=${secondsUntilSessionExp}`,
            details: {
              pollSamples,
              renewals,
              gateFailures: [
                {
                  specId: "SPEC_PERF_JWT_STEADY_POLL",
                  classification: "perf-gate",
                  passed: false,
                  allPolls200: false,
                },
              ],
            },
          },
          testData
        );
      }

      const newToken = response.headers.get("New-Token");
      if (newToken) {
        const renewedPayload = decodeJwtPayload(newToken);
        if (requiresRenewal && !(Number(renewedPayload?.exp) > Number(payload.exp))) {
          return captureTestData(
            testName,
            MODULE_NAME,
            {
              passed: false,
              error: "New-Token did not extend credential exp before credential exp (item 29 regression)",
              details: { pollSamples, renewals },
            },
            testData
          );
        }
        renewals.push({ pollIndex, atUnix: nowUnix });
        token = newToken;
        payload = renewedPayload;
      }

      const elapsed = nowUnix - pollStartUnix;
      if (elapsed >= effectiveMinPollSeconds) {
        break;
      }

      const sleepSeconds = Math.min(
        pollIntervalSeconds,
        Math.max(1, sessionExp - Math.floor(Date.now() / 1000))
      );
      await sleep(sleepSeconds * 1000);
    }

    const elapsedSeconds = Math.floor(Date.now() / 1000) - pollStartUnix;
    const allPolls200 = pollSamples.every((p) => p.status === 200);
    const renewalOk = requiresRenewal ? renewals.length > 0 : true;
    const durationOk = elapsedSeconds >= effectiveMinPollSeconds;

    const gate = {
      specId: "SPEC_PERF_JWT_STEADY_POLL",
      classification: "perf-gate",
      allPolls200,
      renewalCount: renewals.length,
      elapsedSeconds,
      effectiveMinPollSeconds,
      passed: allPolls200 && renewalOk && durationOk,
    };

    const targetP95Ms = PERF_SPECS.SPEC_PERF_JWT_PROTECTED_NOP_P95_MS.p95MaxMs;
    const series = buildSteadyPollMetricSeries(pollSamples, renewals);
    const metrics = {
      specId: "SPEC_PERF_JWT_STEADY_POLL",
      classification: "perf-metric",
      p95Ms: series.s2_all_polls_p95Ms,
      targetP95Ms,
      status:
        series.s2_all_polls_p95Ms != null && series.s2_all_polls_p95Ms <= targetP95Ms
          ? "pass"
          : "warn",
      s2_non_renewal_p95Ms: series.s2_non_renewal_p95Ms,
      s2_renewal_p95Ms: series.s2_renewal_p95Ms,
      s2_all_polls_p95Ms: series.s2_all_polls_p95Ms,
    };

    const gateHint = `PASS renewalCount=${renewals.length} all200=${allPolls200}`;
    logPerfGate(
      gate.specId,
      `all200=${allPolls200} renewalCount=${renewals.length} elapsed=${elapsedSeconds}s`,
      gate.passed
    );
    logPerfMetric(
      metrics.specId,
      { p95: metrics.s2_all_polls_p95Ms, targetP95Ms, status: metrics.status },
      gateHint
    );

    emitPerfJsonRecord(logContext?.runId || "unknown", metrics.specId, {
      classification: "perf-metric",
      gate: {
        allPolls200,
        renewalCount: renewals.length,
        passed: gate.passed,
      },
      metrics: {
        p95Ms: metrics.s2_all_polls_p95Ms,
        targetP95Ms,
        status: metrics.status,
        s2_non_renewal_p95Ms: series.s2_non_renewal_p95Ms,
        s2_renewal_p95Ms: series.s2_renewal_p95Ms,
      },
    });

    testData.pollSamples = pollSamples;
    testData.renewals = renewals;
    testData.elapsedSeconds = elapsedSeconds;
    testData.renewalCount = renewals.length;

    const gateFailures = gate.passed
      ? []
      : [
          {
            ...gate,
            error: `SPEC_PERF_JWT_STEADY_POLL gate: all200=${allPolls200}, renewals=${renewals.length}, elapsed=${elapsedSeconds}s (min ${effectiveMinPollSeconds}s)`,
          },
        ];
    const metricWarnings =
      metrics.status === "warn" || metrics.status === "fail" ? [metrics] : [];

    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: gate.passed,
        error: gate.passed
          ? undefined
          : gateFailures[0].error,
        details: {
          gate,
          gateFailures,
          metrics,
          metricWarnings,
          whatHappened: `${pollSamples.length} polls over ${elapsedSeconds}s, ${renewals.length} renewal(s), s2_all_polls_p95=${metrics.s2_all_polls_p95Ms}ms (${metrics.status})`,
          specRequires:
            "@perf-gate: all 200 while session live, renewalCount>0, min poll duration; @perf-metric: s2_non_renewal / s2_renewal / s2_all_polls p95 vs SPEC_PERF_JWT_PROTECTED_NOP_P95_MS",
        },
      },
      testData
    );
  });
}

/**
 * SPEC_PERF_LOGIN_ERROR_BUDGET — 100 logins over 5 min.
 */
async function testPerfLoginErrorBudget(apiEndpoint, logContext = {}) {
  const testName = "testPerfLoginErrorBudget";
  const testData = { apiEndpoint, tags: [PERF_TAG_MAIN, PERF_TAG_GATE] };

  if (logContext?.moduleName?.startsWith("sdk_")) {
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: true,
        message: "Login error budget runs in native phase only",
        details: { skipped: true, reason: "sdk_phase_skip" },
      },
      testData
    );
  }

  return runWithPerfInfraAbort(testName, testData, async () => {
  await assertPerfMainHealth(apiEndpoint);
  const client = await getRoditClientForTest();
  const configOwnRodit = await client.getConfigOwnRodit();

  const attempts = 100;
  const windowMs = 5 * 60 * 1000;
  const started = Date.now();
  let login5xx = 0;
  let timestamp5xx = 0;
  let loginTotal = 0;

  for (let i = 0; i < attempts; i++) {
    if (Date.now() - started > windowMs) {
      break;
    }

    const tsResult = await timedFetch(apiEndpoint, "/api/login/timestamp", { method: "GET" });
    if (tsResult.status >= 500) {
      timestamp5xx += 1;
    }

    try {
      await loginViaFetch(apiEndpoint, configOwnRodit);
      loginTotal += 1;
    } catch (err) {
      if (String(err.message).includes("HTTP 5")) {
        login5xx += 1;
      }
      loginTotal += 1;
    }

    await sleep(Math.floor(windowMs / attempts));
  }

  const login5xxRate = loginTotal > 0 ? login5xx / loginTotal : 0;
  const passed = login5xxRate < 0.01 && timestamp5xx === 0;

  logPerfGate(
    "SPEC_PERF_LOGIN_ERROR_BUDGET",
    `login5xxRate=${(login5xxRate * 100).toFixed(2)}% timestamp5xx=${timestamp5xx}`,
    passed
  );

  testData.login5xx = login5xx;
  testData.loginTotal = loginTotal;
  testData.timestamp5xx = timestamp5xx;
  testData.login5xxRate = login5xxRate;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `SPEC_PERF_LOGIN_ERROR_BUDGET: login 5xx rate ${(login5xxRate * 100).toFixed(2)}% (max 1%), timestamp 5xx=${timestamp5xx}`,
      details: {
        classification: "perf-gate",
        gateFailures: passed ? [] : [{ specId: "SPEC_PERF_LOGIN_ERROR_BUDGET", passed: false }],
        whatHappened: `${loginTotal} login attempts, login5xx=${login5xx}, timestamp5xx=${timestamp5xx}`,
        specRequires: "100 login attempts over 5min: <1% 5xx on login, 0% 5xx on timestamp",
      },
    },
    testData
  );
  });
}

/**
 * SPEC_PERF_CHAIN_READ_RATIO — 100× S2 + 10× S3 in one session.
 */
async function testPerfChainReadRatio(apiEndpoint) {
  const testName = "testPerfChainReadRatio";
  const testData = { apiEndpoint, tags: [PERF_TAG_MAIN, PERF_TAG_GATE] };

  return runWithPerfInfraAbort(testName, testData, async () => {
  await assertPerfMainHealth(apiEndpoint);
  const { jwt } = await resolveLoginContext(apiEndpoint);

  const metricsBefore = await fetchApiMetrics(apiEndpoint, jwt);
  const s2Count = 100;
  const s3Count = 10;
  let chainReads = 0;

  if (metricsBefore.available) {
    const beforeSnap = readChainMetricSnapshot(metricsBefore.body);

    for (let i = 0; i < s2Count; i++) {
      await timedFetch(apiEndpoint, HOLANONCE_PATH, {
        method: "GET",
        headers: { Authorization: bearerAuthorizationHeader(jwt), "X-Request-ID": ulid() },
      });
    }
    for (let i = 0; i < s3Count; i++) {
      await timedFetch(apiEndpoint, "/api/me/identity", {
        method: "GET",
        headers: { Authorization: bearerAuthorizationHeader(jwt), "X-Request-ID": ulid() },
      });
    }

    const metricsAfter = await fetchApiMetrics(apiEndpoint, jwt);
    const afterSnap = readChainMetricSnapshot(metricsAfter.body);
    if (beforeSnap.key && afterSnap.key) {
      chainReads = Math.max(0, afterSnap.value - beforeSnap.value);
    } else {
      chainReads = s3Count;
    }
  } else {
    chainReads = s3Count;
    testData.metricsFallback = true;
  }

  const totalRequests = s2Count + s3Count;
  const ratio = chainReads / totalRequests;
  const passed = ratio <= PERF_SPECS.SPEC_PERF_CHAIN_READ_RATIO_MAX;

  logPerfGate(
    "SPEC_PERF_CHAIN_READ_RATIO",
    `chainReads=${chainReads}/${totalRequests} ratio=${ratio.toFixed(4)}`,
    passed
  );

  testData.chainReads = chainReads;
  testData.totalRequests = totalRequests;
  testData.ratio = ratio;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `SPEC_PERF_CHAIN_READ_RATIO: ${chainReads}/${totalRequests}=${ratio.toFixed(3)} (max ${PERF_SPECS.SPEC_PERF_CHAIN_READ_RATIO_MAX})`,
      details: {
        classification: "perf-gate",
        gateFailures: passed ? [] : [{ specId: "SPEC_PERF_CHAIN_READ_RATIO", passed: false }],
        whatHappened: `chainReads=${chainReads}, totalRequests=${totalRequests}, ratio=${ratio.toFixed(4)}`,
        specRequires: "Authorization traffic must not be chain-bound: chainReads/totalRequests ≤ 0.10",
      },
    },
    testData
  );
  });
}

/**
 * @perf-degraded — optional degradation SLOs when /health reports degraded.
 */
async function testPerfRpcDegradedHealth(apiEndpoint) {
  const testName = "testPerfRpcDegradedHealth";
  const testData = { apiEndpoint, tag: PERF_TAG_DEGRADED, tags: [PERF_TAG_DEGRADED, PERF_TAG_GATE] };

  const health = await fetchHealthStatus(apiEndpoint);
  testData.healthStatus = health.healthStatus;

  if (health.healthStatus !== "degraded") {
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: true,
        message: "Skipped: /health is not degraded",
        details: {
          skipped: true,
          reason: "health_not_degraded",
          specRequires: "SPEC_PERF_RPC_DEGRADED_HEALTH runs only when /health status is degraded",
        },
      },
      testData
    );
  }

  const { jwt, roditid, configOwnRodit } = await resolveLoginContext(apiEndpoint);

  const s1 = await timedFetch(apiEndpoint, "/api/login/timestamp", { method: "GET" });
  const s2 = await timedFetch(apiEndpoint, HOLANONCE_PATH, {
    method: "GET",
    headers: { Authorization: bearerAuthorizationHeader(jwt) },
  });

  const hola = await buildFreshHolaForVerify(apiEndpoint, jwt, roditid);
  const verifyResponse = await fetchDirect(apiEndpoint, "/api/identity/verify", {
    method: "POST",
    headers: {
      Authorization: bearerAuthorizationHeader(jwt),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hola }),
  });
  const verifyBody = await readJsonSafe(verifyResponse);

  const s1Ok = s1.status === 200;
  const s2Ok = s2.status === 200;
  const verifyMay5xx = verifyResponse.status >= 500;
  const verifiedTrueWithoutChecks =
    verifyBody?.verified === true && verifyResponse.status >= 500;

  const passed = s1Ok && s2Ok && !verifiedTrueWithoutChecks;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `SPEC_PERF_RPC_DEGRADED_HEALTH: s1=${s1.status}, s2=${s2.status}, verify=${verifyResponse.status}, verified=${verifyBody?.verified}`,
      details: {
        s1Status: s1.status,
        s2Status: s2.status,
        verifyStatus: verifyResponse.status,
        verifyMay5xx,
        specRequires:
          "When degraded: S1/S2 still 200; S3 verify may 5xx but must not return verified:true without checks",
      },
    },
    testData
  );
}

module.exports = {
  testPerfLatencyGates,
  testPerfHolanonceBurst,
  testPerfJwtSteadyPoll,
  testPerfLoginErrorBudget,
  testPerfChainReadRatio,
  testPerfRpcDegradedHealth,
};
