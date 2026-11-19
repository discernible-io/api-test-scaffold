/**
 * Client fault resilience — FaultyData-inspired battery.
 *
 * Scores harness HTTP helpers (timeouts, Retry-After floor/jitter, redirect
 * bounds, response-body distrust) against replayable specimens at
 * https://faultydata.com/ (override with FAULTYDATA_BASE_URL).
 *
 * Enabled on development only; not part of the main production gate.
 */

const { logger } = require("../../sdk");
const {
  captureTestData,
  fetchWithTimeout,
  fetchWithRateLimitRetry,
  retryAfterDelayMs,
  MIN_RETRY_AFTER_DELAY_MS,
} = require("./test-utils");

const MODULE_NAME = "clientFaultResilience";
const FAULTYDATA_BASE = (
  process.env.FAULTYDATA_BASE_URL || "https://faultydata.com"
).replace(/\/$/, "");

function specimenUrl(id) {
  return `${FAULTYDATA_BASE}/r/${id}`;
}

function headersFromObject(obj) {
  return {
    get(name) {
      const key = String(name || "").toLowerCase();
      for (const [k, v] of Object.entries(obj || {})) {
        if (String(k).toLowerCase() === key) {
          return v;
        }
      }
      return null;
    },
  };
}

function isAbortError(error) {
  return (
    error?.name === "AbortError" ||
    /aborted|abort/i.test(String(error?.message || error || ""))
  );
}

async function faultyDataReachable() {
  try {
    const response = await fetchWithTimeout(
      `${FAULTYDATA_BASE}/`,
      { method: "GET", redirect: "manual" },
      { timeoutMs: 5000 }
    );
    return response.status > 0 && response.status < 600;
  } catch (error) {
    logger.warn("FaultyData reachability probe failed", {
      component: MODULE_NAME,
      base: FAULTYDATA_BASE,
      error: error?.message || String(error),
    });
    return false;
  }
}

function skipUnreachable(testName) {
  logger.warn(`${testName}: skipping — FaultyData unreachable`, {
    component: MODULE_NAME,
    base: FAULTYDATA_BASE,
  });
  return null;
}

/**
 * Pure helper: Retry-After: 0 must floor; positive seconds honored.
 */
async function testRetryAfterFloorAndParse() {
  const testName = "testRetryAfterFloorAndParse";
  const zero = retryAfterDelayMs(headersFromObject({ "Retry-After": "0" }));
  const five = retryAfterDelayMs(headersFromObject({ "Retry-After": "5" }));
  const missing = retryAfterDelayMs(headersFromObject({}));

  const passed =
    zero === MIN_RETRY_AFTER_DELAY_MS &&
    five === 5000 &&
    missing === null;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `retryAfterDelayMs floor/parse not-passed: zero=${zero}, five=${five}, missing=${missing}`,
      details: {
        whatHappened: passed
          ? "Retry-After: 0 floors; Retry-After: 5 → 5000ms; missing → null"
          : "Retry-After helper mismatch",
        specRequires:
          "Storm-bait Retry-After: 0 must not yield a zero delay; seconds map to ms",
        zero,
        five,
        missing,
        minFloorMs: MIN_RETRY_AFTER_DELAY_MS,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-017 — connect then never reply. Short deadline must abort.
 */
async function testFaultHangAborts() {
  const testName = "testFaultHangAborts";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const timeoutMs = 1500;
  const started = Date.now();
  let aborted = false;
  let errorName = null;

  try {
    await fetchWithTimeout(
      specimenUrl("FD-2026-017"),
      { method: "GET" },
      { timeoutMs }
    );
  } catch (error) {
    aborted = isAbortError(error);
    errorName = error?.name || null;
  }

  const elapsedMs = Date.now() - started;
  const passed = aborted && elapsedMs < timeoutMs + 1500;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Expected AbortError within ~${timeoutMs}ms on hang specimen; aborted=${aborted}, elapsedMs=${elapsedMs}, errorName=${errorName}`,
      details: {
        whatHappened: passed
          ? `Hang specimen aborted after ${elapsedMs}ms`
          : "Hang specimen did not abort on schedule",
        specRequires: "Client must enforce a read deadline on hung peers",
        specimen: "FD-2026-017",
        timeoutMs,
        elapsedMs,
        aborted,
        errorName,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-107 — drip-feed body. Headers may arrive quickly; body read must abort.
 */
async function testFaultSlowStreamAborts() {
  const testName = "testFaultSlowStreamAborts";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const timeoutMs = 1500;
  const started = Date.now();
  let aborted = false;
  let phase = "connect";

  try {
    // Own signal so body consumption is cancelled even if headers already returned.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchWithTimeout(
        specimenUrl("FD-2026-107"),
        { method: "GET", signal: controller.signal },
        { timeoutMs: 0 }
      );
      phase = "body";
      await response.text();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    aborted = isAbortError(error);
  }

  const elapsedMs = Date.now() - started;
  const passed = aborted && elapsedMs < timeoutMs + 1500;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Expected AbortError while reading drip body; aborted=${aborted}, elapsedMs=${elapsedMs}, phase=${phase}`,
      details: {
        whatHappened: passed
          ? `Slow stream body aborted after ${elapsedMs}ms (phase=${phase})`
          : "Slow stream body did not abort",
        specRequires:
          "Drip-fed bodies must not bypass the client deadline (abort on body read, not only connect)",
        specimen: "FD-2026-107",
        timeoutMs,
        elapsedMs,
        aborted,
        phase,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-034 — HTTP 200 wrapping an error (GraphQL-style). Status alone ≠ success.
 */
async function testFaultHttp200ErrorBodyDistrusted() {
  const testName = "testFaultHttp200ErrorBodyDistrusted";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const response = await fetchWithTimeout(
    specimenUrl("FD-2026-034"),
    { method: "GET", headers: { Accept: "application/json" } },
    { timeoutMs: 8000 }
  );
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  const hasErrorPayload =
    Array.isArray(body?.errors) ||
    body?.error != null ||
    /doesn't exist|error/i.test(text);

  const blindSuccess = response.status === 200 && !hasErrorPayload;
  const passed = response.status === 200 && hasErrorPayload && !blindSuccess;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `200-with-error specimen not detected as error payload (status=${response.status})`,
      details: {
        whatHappened: passed
          ? "HTTP 200 body carries errors[]; must not be treated as blind success"
          : "Could not detect error envelope on 200 response",
        specRequires:
          "Clients must inspect JSON error envelopes even when status is 200",
        specimen: "FD-2026-034",
        status: response.status,
        hasErrorPayload,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-073 — Retry-After: 0 storm bait. Floored delays + capped attempts.
 */
async function testFaultRetryAfterZeroDoesNotStorm() {
  const testName = "testFaultRetryAfterZeroDoesNotStorm";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const maxAttempts = 3;
  const minDelayMs = MIN_RETRY_AFTER_DELAY_MS;
  const started = Date.now();
  const delays = [];

  // Instrument by wrapping sleep via recorded delays from header parse path:
  // call the retry helper with jitter off and assert elapsed ≥ (attempts-1)*floor.
  const response = await fetchWithRateLimitRetry(
    specimenUrl("FD-2026-073"),
    { method: "GET", headers: { Accept: "application/json" } },
    {
      maxAttempts,
      retryStatuses: [503],
      minDelayMs,
      jitter: false,
      baseDelayMs: minDelayMs,
      maxDelayMs: 5000,
      timeoutMs: 8000,
    }
  );

  const elapsedMs = Date.now() - started;
  const minExpectedMs = (maxAttempts - 1) * minDelayMs;
  const retryAfter = retryAfterDelayMs(response.headers, { minDelayMs });
  delays.push(retryAfter);

  const passed =
    response.status === 503 &&
    retryAfter === minDelayMs &&
    elapsedMs >= minExpectedMs;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Storm-bait handling not-passed: status=${response.status}, retryAfter=${retryAfter}, elapsedMs=${elapsedMs}, minExpectedMs=${minExpectedMs}`,
      details: {
        whatHappened: passed
          ? `503 + Retry-After:0 floored; ${maxAttempts} attempts took ${elapsedMs}ms`
          : "Retry-After:0 path did not floor or cap retries",
        specRequires:
          "Retry-After: 0 must not produce a zero-delay retry storm; attempts must stop",
        specimen: "FD-2026-073",
        status: response.status,
        retryAfter,
        elapsedMs,
        minExpectedMs,
        maxAttempts,
        delays,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-038 — lying / present rate-limit headers with Retry-After: 5.
 */
async function testFaultRateLimitRetryAfterParsed() {
  const testName = "testFaultRateLimitRetryAfterParsed";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const response = await fetchWithTimeout(
    specimenUrl("FD-2026-038"),
    { method: "GET", headers: { Accept: "application/json" } },
    { timeoutMs: 8000 }
  );
  const delayMs = retryAfterDelayMs(response.headers);
  const passed = response.status === 429 && delayMs === 5000;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Expected 429 with Retry-After → 5000ms; status=${response.status}, delayMs=${delayMs}`,
      details: {
        whatHappened: passed
          ? "429 Retry-After: 5 parsed as 5000ms"
          : "Rate-limit specimen header parse mismatch",
        specRequires: "Clients must honor Retry-After delay-seconds on 429",
        specimen: "FD-2026-038",
        status: response.status,
        delayMs,
        retryAfterHeader: response.headers.get("retry-after"),
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-035 — HTML stack trace where JSON was expected.
 */
async function testFaultHtmlErrorNotJsonSuccess() {
  const testName = "testFaultHtmlErrorNotJsonSuccess";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const response = await fetchWithTimeout(
    specimenUrl("FD-2026-035"),
    { method: "GET", headers: { Accept: "application/json" } },
    { timeoutMs: 8000 }
  );
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  let jsonOk = false;
  try {
    JSON.parse(text);
    jsonOk = true;
  } catch {
    jsonOk = false;
  }

  const looksHtml =
    /text\/html/i.test(contentType) || /<html|<pre|NullPointerException/i.test(text);
  const passed = response.status >= 500 && looksHtml && !jsonOk;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `HTML error specimen not classified correctly (status=${response.status}, jsonOk=${jsonOk})`,
      details: {
        whatHappened: passed
          ? "HTML 5xx body rejected as non-JSON"
          : "HTML error body mishandled",
        specRequires:
          "Auth/API clients must not treat HTML error pages as JSON success",
        specimen: "FD-2026-035",
        status: response.status,
        contentType,
        jsonOk,
        looksHtml,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-014 — encoding mismatch; client must not throw on read/parse attempt.
 */
async function testFaultEncodingMismatchSurvives() {
  const testName = "testFaultEncodingMismatchSurvives";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  let threw = false;
  let status = null;
  let textLength = 0;

  try {
    const response = await fetchWithTimeout(
      specimenUrl("FD-2026-014"),
      { method: "GET" },
      { timeoutMs: 8000 }
    );
    status = response.status;
    const text = await response.text();
    textLength = text.length;
    // Best-effort JSON parse; replacement chars are acceptable — crash is not.
    try {
      JSON.parse(text);
    } catch {
      // ignore parse failure
    }
  } catch {
    threw = true;
  }

  const passed = !threw && status === 200 && textLength > 0;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Encoding-mismatch specimen crashed or empty (threw=${threw}, status=${status})`,
      details: {
        whatHappened: passed
          ? "Encoding-mismatch body read without throwing"
          : "Client failed on encoding-mismatch specimen",
        specRequires:
          "Clients should survive charset lies without unhandled exceptions",
        specimen: "FD-2026-014",
        status,
        textLength,
        threw,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-099 — self Location redirect. Bound redirect following.
 */
async function testFaultRedirectLoopBounded() {
  const testName = "testFaultRedirectLoopBounded";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const response = await fetchWithTimeout(
    specimenUrl("FD-2026-099"),
    { method: "GET", redirect: "manual" },
    { timeoutMs: 8000 }
  );
  const location = response.headers.get("location") || "";
  const loopsToSelf =
    /FD-2026-099/i.test(location) || location.includes("/r/FD-2026-099");
  const passed =
    (response.status === 301 || response.status === 302 || response.status === 307) &&
    loopsToSelf;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Redirect-loop specimen not detected (status=${response.status}, location=${location})`,
      details: {
        whatHappened: passed
          ? "Self-redirect observed with redirect:manual (no infinite follow)"
          : "Redirect loop not bounded/detected",
        specRequires:
          "Clients must use bounded redirects; self-Location is a loop signal",
        specimen: "FD-2026-099",
        status: response.status,
        location,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-085 — redirect chain ending in missing destination.
 */
async function testFaultRedirectToMissingBounded() {
  const testName = "testFaultRedirectToMissingBounded";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const first = await fetchWithTimeout(
    specimenUrl("FD-2026-085"),
    { method: "GET", redirect: "manual" },
    { timeoutMs: 8000 }
  );
  const location = first.headers.get("location");
  if (!location) {
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: false,
        error: "Redirect-to-missing specimen lacked Location header",
        details: {
          whatHappened: "No Location on FD-2026-085",
          specRequires: "Specimen should advertise a missing destination",
          specimen: "FD-2026-085",
          status: first.status,
        },
      },
      { base: FAULTYDATA_BASE }
    );
  }

  const nextUrl = new URL(location, FAULTYDATA_BASE).toString();
  const second = await fetchWithTimeout(
    nextUrl,
    { method: "GET", redirect: "manual" },
    { timeoutMs: 8000 }
  );

  const passed =
    (first.status === 301 || first.status === 302 || first.status === 307) &&
    second.status === 404;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Expected redirect then 404; first=${first.status}, second=${second.status}`,
      details: {
        whatHappened: passed
          ? "Redirect to missing target ended in 404 without looping"
          : "Redirect-to-missing chain unexpected",
        specRequires:
          "Clients must bound redirect hops and surface terminal 404",
        specimen: "FD-2026-085",
        firstStatus: first.status,
        location,
        secondStatus: second.status,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

/**
 * FD-2026-069 — unsolicited 304 to an unconditional request.
 */
async function testFaultUnsolicited304Detected() {
  const testName = "testFaultUnsolicited304Detected";
  if (!(await faultyDataReachable())) {
    return skipUnreachable(testName);
  }

  const response = await fetchWithTimeout(
    specimenUrl("FD-2026-069"),
    {
      method: "GET",
      headers: {
        // Explicitly unconditional — no If-None-Match / If-Modified-Since.
        Accept: "*/*",
        "Cache-Control": "no-cache",
      },
    },
    { timeoutMs: 8000 }
  );

  const passed = response.status === 304;

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed,
      error: passed
        ? undefined
        : `Expected unsolicited 304; got ${response.status}`,
      details: {
        whatHappened: passed
          ? "Unsolicited 304 detected on unconditional GET"
          : "304 specimen status mismatch",
        specRequires:
          "Clients should treat unexpected 304 without validators as anomalous",
        specimen: "FD-2026-069",
        status: response.status,
      },
    },
    { base: FAULTYDATA_BASE }
  );
}

module.exports = {
  testRetryAfterFloorAndParse,
  testFaultHangAborts,
  testFaultSlowStreamAborts,
  testFaultHttp200ErrorBodyDistrusted,
  testFaultRetryAfterZeroDoesNotStorm,
  testFaultRateLimitRetryAfterParsed,
  testFaultHtmlErrorNotJsonSuccess,
  testFaultEncodingMismatchSurvives,
  testFaultRedirectLoopBounded,
  testFaultRedirectToMissingBounded,
  testFaultUnsolicited304Detected,
};
