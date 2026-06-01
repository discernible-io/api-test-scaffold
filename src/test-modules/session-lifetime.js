/**
 * Session vs JWT credential lifetime — live API tests via RoditClient (TEST CONSTITUTION SDK-first).
 * Validates two clocks on real login tokens and session enforcement on protected routes.
 *
 * In-process SDK unit scripts remain under sdk/test/session-lifetime*.test.js for local/CI.
 */

"use strict";

const { ulid } = require("ulid");
const { RoditClient, logger } = require("../../sdk");
const config = require("../../sdk/services/configsdk");
const {
  FALLBACK_DEFAULTS,
  getSessionTtlSeconds,
  getDefaultJwtDurationSeconds,
} = config;
const {
  resolveSessionExpirationUnix,
  resolveCredentialExpirationUnix,
  parseRoditJwtDurationSeconds,
} = require("../../sdk/lib/auth/tokenservice");
const {
  captureTestData,
  getRoditClientForTest,
  fetchDirect,
  bearerAuthorizationHeader,
} = require("./test-utils");

const MODULE_NAME = "sessionLifetime";

/** sdk/services/configsdk.js FALLBACK_DEFAULTS — assumed API server session TTL. */
const ASSUMED_SERVER_SESSION_TTL_SECONDS =
  FALLBACK_DEFAULTS.SECURITY_OPTIONS.SESSION_TTL_SECONDS;

/** sdk/services/configsdk.js — assumed credential fallback when passport jwt_duration is invalid. */
const ASSUMED_SERVER_CREDENTIAL_FALLBACK_SECONDS =
  FALLBACK_DEFAULTS.SECURITY_OPTIONS.FALLBACK_JWT_DURATION;

/** Integer unix JWT claims should match tokenservice math within this bound. */
const JWT_CLOCK_TOLERANCE_SECONDS = 2;

/** Protected route used for liveness polling (supports New-Token credential renewal). */
const SESSION_LIVENESS_PROBE_PATH = "/api/holanonce16ts";

const SPEC_REQUIRES_SESSION_POLL =
  "Token must stay live on protected routes until session_exp; credential may renew via New-Token; after session_exp the API must reject with session expiry (401 INVALIDATED_TOKEN / session_expired) per target-swagger.json";

const SPEC_REQUIRES_SESSION_CLOCKS =
  "Live login JWT session_exp and exp must match tokenservice resolve* using configsdk defaults (SESSION_TTL_SECONDS 5200, FALLBACK_JWT_DURATION 3600) and agent passport metadata caps";

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function errorCodeFromBody(body) {
  return body?.error?.code ?? body?.code ?? null;
}

function errorReasonFromBody(body) {
  return (
    body?.error?.details?.reason ??
    body?.details?.reason ??
    body?.error?.reason ??
    null
  );
}

function wallNowUnix() {
  return Math.floor(Date.now() / 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePollConfigInt(key, fallback) {
  const raw = config.get(key);
  const parsed = parseInt(raw ?? String(fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isSessionExpiryRejection(probe) {
  if (probe.status !== 401 && probe.status !== 403) {
    return false;
  }
  if (probe.errorCode === "INVALIDATED_TOKEN") {
    return true;
  }
  if (probe.errorReason === "session_expired") {
    return true;
  }
  return false;
}

function computePollDelaySeconds(nowUnix, payload, baseIntervalSeconds) {
  const sessionExp = Number(payload.session_exp);
  const credentialExp = Number(payload.exp);
  const untilSession = sessionExp - nowUnix;
  const untilCredential = credentialExp - nowUnix;

  if (untilSession <= 60) {
    return Math.max(1, Math.min(5, untilSession));
  }
  if (untilCredential <= 120) {
    return Math.max(5, Math.min(15, Math.floor(untilCredential / 2) || 5));
  }
  return baseIntervalSeconds;
}

async function probeTokenLiveness(apiEndpoint, token) {
  const response = await fetchDirect(apiEndpoint, SESSION_LIVENESS_PROBE_PATH, {
    method: "GET",
    headers: {
      Authorization: bearerAuthorizationHeader(token),
      "X-Request-ID": ulid(),
    },
  });
  const body = await readJsonSafe(response);
  return {
    ok: response.ok,
    status: response.status,
    newToken: response.headers.get("New-Token"),
    errorCode: errorCodeFromBody(body),
    errorReason: errorReasonFromBody(body),
  };
}

function assertUnixSecondsClose(actual, expected, label) {
  const delta = Math.abs(Number(actual) - Number(expected));
  if (!Number.isFinite(delta) || delta > JWT_CLOCK_TOLERANCE_SECONDS) {
    throw new Error(
      `${label}: expected unix ${expected}, got ${actual} (delta ${delta}s, tolerance ${JWT_CLOCK_TOLERANCE_SECONDS}s)`
    );
  }
}

function createSubtestCollector() {
  const subtests = [];
  return {
    async run(name, fn) {
      try {
        const detail = await fn();
        subtests.push({ name, passed: true, ...(detail ? { detail } : {}) });
      } catch (err) {
        subtests.push({
          name,
          passed: false,
          error: err?.message || String(err),
        });
      }
    },
    buildResult(passedMessage) {
      const failed = subtests.filter((s) => !s.passed);
      const whatHappened =
        failed.length === 0
          ? subtests.map((s) => `${s.name}: ok`).join("; ")
          : failed.map((s) => `${s.name}: ${s.error}`).join("; ");
      return {
        passed: failed.length === 0,
        error:
          failed.length > 0
            ? failed.map((s) => `${s.name}: ${s.error}`).join("; ")
            : null,
        message: failed.length === 0 ? passedMessage : undefined,
        details: {
          subtests,
          whatHappened,
          specRequires:
            "Login JWT must carry session_id/session_exp longer than credential exp; session/credential expirations must match configsdk defaults via tokenservice; protected routes must reject missing, invalid, logged-out, and revoked sessions per target-swagger.json",
        },
      };
    },
  };
}

/**
 * Live login JWT: session clock vs credential clock (replaces in-process unit runner).
 */
async function testSessionLifetimeUnit(apiEndpoint) {
  const testName = "testSessionLifetimeUnit";
  const correlationId = ulid();
  const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/login` };
  const collector = createSubtestCollector();

  logger.info("Starting session lifetime JWT clock test (live API)", {
    component: "TestRunner",
    moduleName: MODULE_NAME,
    testName,
    correlationId,
  });

  await collector.run("login issues JWT with session and credential claims", async () => {
    const client = await getRoditClientForTest();
    const loginResult = await client.login_server();
    testData.loginSuccess = !!(loginResult?.jwt_token || loginResult?.success);

    const token = loginResult?.jwt_token;
    if (!token) {
      throw new Error("No jwt_token from login_server");
    }

    const payload = decodeJwtPayload(token);
    testData.jwtClaims = {
      session_id: payload?.session_id,
      session_exp: payload?.session_exp,
      session_iat: payload?.session_iat,
      exp: payload?.exp,
      iat: payload?.iat,
    };

    if (!payload?.session_id) {
      throw new Error("JWT missing session_id claim");
    }
    if (payload.session_exp == null) {
      throw new Error("JWT missing session_exp claim");
    }
    if (payload.exp == null || payload.iat == null) {
      throw new Error("JWT missing exp or iat claim");
    }

    const sessionExp = Number(payload.session_exp);
    const credentialExp = Number(payload.exp);
    if (!Number.isFinite(sessionExp) || !Number.isFinite(credentialExp)) {
      throw new Error("session_exp or exp is not numeric");
    }
    if (sessionExp < credentialExp) {
      throw new Error(
        `session_exp (${sessionExp}) must be >= credential exp (${credentialExp})`
      );
    }

    testData._durationProbe = { token, payload, client };
    return { sessionExp, credentialExp, sessionId: payload.session_id };
  });

  await collector.run(
    "session and credential expirations match configsdk defaults (tokenservice)",
    async () => {
      const probe = testData._durationProbe;
      if (!probe?.token || !probe?.client) {
        throw new Error("Missing login probe from prior subtest");
      }

      const { payload, client } = probe;
      const configOwn = await client.getConfigOwnRodit();
      const ownRodit = configOwn?.own_rodit;
      if (!ownRodit?.metadata) {
        throw new Error("Could not load own_rodit metadata for duration expectations");
      }
      const peerRodit = configOwn?.peer_rodit ?? ownRodit;

      const sessionIat = Number(payload.session_iat ?? payload.iat);
      const sessionExp = Number(payload.session_exp);
      const credentialExp = Number(payload.exp);
      const credentialIat = Number(payload.iat);

      const configuredTtl = getSessionTtlSeconds();
      testData.assumedServerSessionTtlSeconds = ASSUMED_SERVER_SESSION_TTL_SECONDS;
      testData.localConfigSessionTtlSeconds = configuredTtl;
      testData.assumedCredentialFallbackSeconds = ASSUMED_SERVER_CREDENTIAL_FALLBACK_SECONDS;
      testData.localConfigCredentialFallbackSeconds = getDefaultJwtDurationSeconds();
      testData.passportJwtDurationSeconds = parseRoditJwtDurationSeconds(
        ownRodit.metadata
      );

      const expectedSessionExp = await resolveSessionExpirationUnix(
        peerRodit,
        ownRodit,
        sessionIat
      );
      const expectedCredentialExp = resolveCredentialExpirationUnix(
        sessionIat,
        expectedSessionExp,
        ownRodit
      );

      testData.actualSessionDurationSeconds = sessionExp - sessionIat;
      testData.expectedSessionDurationSeconds = expectedSessionExp - sessionIat;
      testData.actualCredentialDurationSeconds = credentialExp - credentialIat;
      testData.expectedCredentialDurationSeconds =
        expectedCredentialExp - sessionIat;

      assertUnixSecondsClose(sessionExp, expectedSessionExp, "session_exp");
      assertUnixSecondsClose(credentialExp, expectedCredentialExp, "exp");

      const sessionCappedBelowDefault =
        testData.expectedSessionDurationSeconds <
        ASSUMED_SERVER_SESSION_TTL_SECONDS - JWT_CLOCK_TOLERANCE_SECONDS;

      testData.sessionCappedByPassport = sessionCappedBelowDefault;

      if (!sessionCappedBelowDefault) {
        if (configuredTtl !== ASSUMED_SERVER_SESSION_TTL_SECONDS) {
          throw new Error(
            `Test runner config SESSION_TTL_SECONDS is ${configuredTtl}, expected ${ASSUMED_SERVER_SESSION_TTL_SECONDS} for default assumption`
          );
        }
        assertUnixSecondsClose(
          testData.actualSessionDurationSeconds,
          ASSUMED_SERVER_SESSION_TTL_SECONDS,
          "session duration (uncapped)"
        );
      }

      return {
        sessionDurationSeconds: testData.actualSessionDurationSeconds,
        credentialDurationSeconds: testData.actualCredentialDurationSeconds,
        sessionCappedByPassport: sessionCappedBelowDefault,
        specNote: SPEC_REQUIRES_SESSION_CLOCKS,
      };
    }
  );

  const result = collector.buildResult(
    "Login JWT session/credential clocks match configsdk defaults"
  );
  return captureTestData(testName, MODULE_NAME, result, testData);
}

/**
 * Auth rejection on protected route: missing/invalid token (live middleware).
 */
async function testSessionLifetimeValidation(apiEndpoint) {
  const testName = "testSessionLifetimeValidation";
  const correlationId = ulid();
  const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/me/identity` };
  const collector = createSubtestCollector();

  logger.info("Starting session lifetime validation test (live API)", {
    component: "TestRunner",
    moduleName: MODULE_NAME,
    testName,
    correlationId,
  });

  await collector.run("GET /api/me/identity without Authorization returns 401 MISSING_TOKEN", async () => {
    const response = await fetchDirect(apiEndpoint, "/api/me/identity", {
      method: "GET",
      headers: { "X-Request-ID": ulid() },
    });
    testData.missingTokenStatus = response.status;
    const body = await readJsonSafe(response);
    testData.missingTokenCode = errorCodeFromBody(body);

    if (response.status !== 401) {
      throw new Error(`Expected HTTP 401, got ${response.status}`);
    }
    if (testData.missingTokenCode !== "MISSING_TOKEN") {
      throw new Error(
        `Expected error code MISSING_TOKEN, got ${testData.missingTokenCode || "none"}`
      );
    }
  });

  await collector.run("GET /api/me/identity with invalid Bearer returns 401 or 403", async () => {
    const response = await fetchDirect(apiEndpoint, "/api/me/identity", {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader("not-a-valid-jwt"),
        "X-Request-ID": ulid(),
      },
    });
    testData.invalidTokenStatus = response.status;
    if (response.status !== 401 && response.status !== 403) {
      throw new Error(`Expected HTTP 401 or 403, got ${response.status}`);
    }
  });

  await collector.run("revoked session token returns 401 INVALIDATED_TOKEN", async () => {
    const userClient = await RoditClient.createTestInstance({ testMode: true });
    const userLogin = await userClient.login_server();
    const userToken = userLogin?.jwt_token;
    if (!userToken) {
      throw new Error("Could not obtain user JWT for revocation test");
    }

    const payload = decodeJwtPayload(userToken);
    const sessionId = payload?.session_id;
    testData.revokeSessionId = sessionId;
    if (!sessionId) {
      throw new Error("User JWT missing session_id");
    }

    const adminClient = await RoditClient.createTestInstance({ testMode: true });
    const adminLogin = await adminClient.login_server();
    const adminToken = adminLogin?.jwt_token;
    if (!adminToken) {
      throw new Error("Could not obtain admin JWT to revoke session");
    }

    const revokeResponse = await fetchDirect(apiEndpoint, "/api/sessions/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: bearerAuthorizationHeader(adminToken),
        "X-Request-ID": ulid(),
      },
      body: JSON.stringify({ sessionId, reason: "session_lifetime_test" }),
    });
    testData.revokeStatus = revokeResponse.status;

    if (revokeResponse.status === 403 || revokeResponse.status === 401) {
      return {
        skipped: true,
        reason: `Admin revoke not available (HTTP ${revokeResponse.status}); revocation subtest skipped`,
      };
    }
    if (revokeResponse.status !== 200) {
      throw new Error(`Unexpected revoke status: ${revokeResponse.status}`);
    }

    const afterRevoke = await fetchDirect(apiEndpoint, "/api/me/identity", {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader(userToken),
        "X-Request-ID": ulid(),
      },
    });
    testData.afterRevokeStatus = afterRevoke.status;
    const body = await readJsonSafe(afterRevoke);
    testData.afterRevokeCode = errorCodeFromBody(body);

    if (afterRevoke.status !== 401) {
      throw new Error(`Expected HTTP 401 after revoke, got ${afterRevoke.status}`);
    }
    if (testData.afterRevokeCode !== "INVALIDATED_TOKEN") {
      throw new Error(
        `Expected INVALIDATED_TOKEN, got ${testData.afterRevokeCode || "none"}`
      );
    }
  });

  const result = collector.buildResult("Session validation rejections match auth contract");
  return captureTestData(testName, MODULE_NAME, result, testData);
}

/**
 * Authenticated access, logout invalidation, and optional New-Token renewal (live API).
 */
async function testSessionLifetimeHttp(apiEndpoint) {
  const testName = "testSessionLifetimeHttp";
  const correlationId = ulid();
  const testData = { apiEndpoint };
  const collector = createSubtestCollector();

  logger.info("Starting session lifetime HTTP integration test (live API)", {
    component: "TestRunner",
    moduleName: MODULE_NAME,
    testName,
    correlationId,
  });

  await collector.run("RoditClient.request GET /api/me/identity succeeds with valid session", async () => {
    const client = await getRoditClientForTest();
    await client.login_server();
    const data = await client.request("GET", "/api/me/identity");
    testData.meIdentityKeys = data && typeof data === "object" ? Object.keys(data) : [];
    if (!data || typeof data !== "object") {
      throw new Error("Expected JSON object from /api/me/identity");
    }
  });

  await collector.run("POST /api/logout invalidates session for subsequent requests", async () => {
    const client = await RoditClient.createTestInstance({ testMode: true });
    const loginResult = await client.login_server();
    const token = loginResult?.jwt_token;
    if (!token) {
      throw new Error("No jwt_token after login");
    }

    const pre = await fetchDirect(apiEndpoint, "/api/holanonce16ts", {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader(token),
        "X-Request-ID": ulid(),
      },
    });
    testData.preLogoutStatus = pre.status;
    if (!pre.ok) {
      throw new Error(`Token not accepted before logout: HTTP ${pre.status}`);
    }

    const logoutResponse = await fetchDirect(apiEndpoint, "/api/logout", {
      method: "POST",
      headers: {
        Authorization: bearerAuthorizationHeader(token),
        "Content-Type": "application/json",
        "X-Request-ID": ulid(),
      },
    });
    testData.logoutStatus = logoutResponse.status;
    if (!logoutResponse.ok) {
      const text = await logoutResponse.text().catch(() => "");
      throw new Error(`Logout failed: HTTP ${logoutResponse.status} ${text.slice(0, 200)}`);
    }

    const post = await fetchDirect(apiEndpoint, "/api/holanonce16ts", {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader(token),
        "X-Request-ID": ulid(),
      },
    });
    testData.postLogoutStatus = post.status;
    if (post.status !== 401 && post.status !== 403) {
      throw new Error(`Expected 401/403 after logout, got ${post.status}`);
    }
  });

  await collector.run("authenticated request may expose New-Token when credential renews", async () => {
    const client = await RoditClient.createTestInstance({ testMode: true });
    const loginResult = await client.login_server();
    const token = loginResult?.jwt_token;
    if (!token) {
      throw new Error("No jwt_token for renewal probe");
    }

    const response = await fetchDirect(apiEndpoint, "/api/holanonce16ts", {
      method: "GET",
      headers: {
        Authorization: bearerAuthorizationHeader(token),
        "X-Request-ID": ulid(),
      },
    });
    testData.renewalProbeStatus = response.status;
    if (!response.ok) {
      throw new Error(`Renewal probe request failed: HTTP ${response.status}`);
    }

    const newToken = response.headers.get("New-Token");
    testData.hasNewToken = !!newToken;
    if (!newToken) {
      return { renewalObserved: false, note: "No New-Token header on this request (acceptable)" };
    }

    const renewedPayload = decodeJwtPayload(newToken);
    const originalPayload = decodeJwtPayload(token);
    if (renewedPayload?.session_exp !== originalPayload?.session_exp) {
      throw new Error("Renewed token changed session_exp");
    }
    if (!(Number(renewedPayload?.exp) > Number(originalPayload?.exp))) {
      throw new Error("Renewed token exp should be later than original");
    }
    return { renewalObserved: true };
  });

  const result = collector.buildResult("Live HTTP session lifecycle behaviors match spec");
  return captureTestData(testName, MODULE_NAME, result, testData);
}

/**
 * Poll token liveness (following New-Token renewals) until session_exp, then verify rejection.
 * Long-running: waits for the full advertised session duration on the live API.
 * Runs in native phase only (skipped in sdk_* phase to avoid duplicate waits).
 */
async function testSessionLifetimePollUntilExpiry(apiEndpoint, logContext = {}) {
  const testName = "testSessionLifetimePollUntilExpiry";
  const correlationId = ulid();
  const testData = {
    apiEndpoint,
    probePath: SESSION_LIVENESS_PROBE_PATH,
    correlationId,
  };

  if (logContext?.moduleName?.startsWith("sdk_")) {
    logger.info("Skipping poll-until-expiry in SDK phase (runs once in native phase)", {
      component: "TestRunner",
      moduleName: MODULE_NAME,
      testName,
      correlationId,
    });
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: true,
        message: "Poll-until-expiry runs in native phase only",
        details: {
          skipped: true,
          reason: "sdk_phase_skip",
          whatHappened: "Skipped in SDK phase to avoid duplicate long poll",
          specRequires: SPEC_REQUIRES_SESSION_POLL,
        },
      },
      testData
    );
  }

  const pollIntervalSeconds = parsePollConfigInt(
    "API_DEFAULT_OPTIONS.SESSION_LIFETIME_POLL_INTERVAL_SECONDS",
    30
  );
  const postExpiryGraceSeconds = parsePollConfigInt(
    "API_DEFAULT_OPTIONS.SESSION_LIFETIME_POST_EXPIRY_GRACE_SECONDS",
    5
  );
  const maxPollSeconds = parsePollConfigInt(
    "API_DEFAULT_OPTIONS.SESSION_LIFETIME_POLL_MAX_SECONDS",
    0
  );

  testData.pollConfig = {
    pollIntervalSeconds,
    postExpiryGraceSeconds,
    maxPollSeconds,
  };

  logger.info("Starting session lifetime poll-until-expiry test (live API)", {
    component: "TestRunner",
    moduleName: MODULE_NAME,
    testName,
    correlationId,
    pollIntervalSeconds,
    maxPollSeconds: maxPollSeconds || "unlimited",
  });

  const client = await RoditClient.createTestInstance({ testMode: true });
  const loginResult = await client.login_server();
  let token = loginResult?.jwt_token;
  if (!token) {
    throw new Error("No jwt_token from login_server");
  }

  let payload = decodeJwtPayload(token);
  if (!payload?.session_exp || payload.exp == null) {
    throw new Error("Login JWT missing session_exp or exp");
  }

  const sessionExp = Number(payload.session_exp);
  const loginUnix = wallNowUnix();
  const advertisedSessionSeconds = sessionExp - loginUnix;

  testData.advertisedSessionSeconds = advertisedSessionSeconds;
  testData.sessionExp = sessionExp;
  testData.initialCredentialExp = Number(payload.exp);

  if (maxPollSeconds > 0 && advertisedSessionSeconds > maxPollSeconds) {
    const reason = `Advertised session ${advertisedSessionSeconds}s exceeds SESSION_LIFETIME_POLL_MAX_SECONDS (${maxPollSeconds})`;
    logger.warn(reason, {
      component: "TestRunner",
      moduleName: MODULE_NAME,
      testName,
      correlationId,
    });
    return captureTestData(
      testName,
      MODULE_NAME,
      {
        passed: true,
        message: reason,
        details: {
          skipped: true,
          reason,
          whatHappened: reason,
          specRequires: SPEC_REQUIRES_SESSION_POLL,
        },
      },
      testData
    );
  }

  const polls = [];
  const renewals = [];
  let pollIndex = 0;

  while (wallNowUnix() < sessionExp) {
    pollIndex += 1;
    const nowUnix = wallNowUnix();
    const probe = await probeTokenLiveness(apiEndpoint, token);

    if (!probe.ok) {
      if (isSessionExpiryRejection(probe)) {
        throw new Error(
          `Session rejected before session_exp (now=${nowUnix}, session_exp=${sessionExp}): HTTP ${probe.status} ${probe.errorCode}`
        );
      }
      throw new Error(
        `Token not live before session_exp at poll ${pollIndex}: HTTP ${probe.status} code=${probe.errorCode || "none"} reason=${probe.errorReason || "none"}`
      );
    }

    if (probe.newToken) {
      const renewedPayload = decodeJwtPayload(probe.newToken);
      if (renewedPayload?.session_exp !== payload.session_exp) {
        throw new Error("New-Token changed session_exp during poll");
      }
      if (!(Number(renewedPayload?.exp) > Number(payload.exp))) {
        throw new Error("New-Token did not extend credential exp");
      }
      renewals.push({
        pollIndex,
        atUnix: nowUnix,
        oldExp: Number(payload.exp),
        newExp: Number(renewedPayload.exp),
        oldJti: payload.jti,
        newJti: renewedPayload.jti,
      });
      token = probe.newToken;
      payload = renewedPayload;
    }

    const secondsUntilSessionExp = sessionExp - nowUnix;
    polls.push({
      pollIndex,
      atUnix: nowUnix,
      status: probe.status,
      secondsUntilSessionExp,
      credentialExp: Number(payload.exp),
      renewalCount: renewals.length,
    });

    logger.info("Session liveness poll", {
      component: "TestRunner",
      moduleName: MODULE_NAME,
      testName,
      correlationId,
      pollIndex,
      secondsUntilSessionExp,
      renewalCount: renewals.length,
    });

    if (secondsUntilSessionExp <= 0) {
      break;
    }

    const delaySeconds = computePollDelaySeconds(nowUnix, payload, pollIntervalSeconds);
    const sleepMs = Math.min(delaySeconds * 1000, secondsUntilSessionExp * 1000);
    if (sleepMs > 0) {
      await sleep(sleepMs);
    }
  }

  if (postExpiryGraceSeconds > 0) {
    await sleep(postExpiryGraceSeconds * 1000);
  }

  const finalProbe = await probeTokenLiveness(apiEndpoint, token);
  testData.finalProbe = {
    status: finalProbe.status,
    errorCode: finalProbe.errorCode,
    errorReason: finalProbe.errorReason,
  };

  if (!isSessionExpiryRejection(finalProbe)) {
    throw new Error(
      `Expected session expiry rejection after session_exp; got HTTP ${finalProbe.status} code=${finalProbe.errorCode || "none"} reason=${finalProbe.errorReason || "none"}`
    );
  }

  testData.polls = polls;
  testData.renewals = renewals;
  testData.totalPolls = polls.length;
  testData.totalRenewals = renewals.length;
  testData.elapsedSeconds = wallNowUnix() - loginUnix;

  const whatHappened = [
    `${polls.length} liveness poll(s) returned 200 before session_exp`,
    renewals.length > 0
      ? `${renewals.length} New-Token renewal(s) observed`
      : "no credential renewal required during poll window",
    `after session_exp (+${postExpiryGraceSeconds}s grace): HTTP ${finalProbe.status} ${finalProbe.errorCode}${finalProbe.errorReason ? ` (${finalProbe.errorReason})` : ""}`,
  ].join("; ");

  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed: true,
      message: "Session remained live until session_exp, then rejected",
      details: {
        subtests: [
          {
            name: "token stays live until session_exp (with renewals as needed)",
            passed: true,
            detail: { totalPolls: polls.length, totalRenewals: renewals.length },
          },
          {
            name: "token rejected after session_exp",
            passed: true,
            detail: testData.finalProbe,
          },
        ],
        whatHappened,
        specRequires: SPEC_REQUIRES_SESSION_POLL,
      },
    },
    testData
  );
}

module.exports = {
  testSessionLifetimeUnit,
  testSessionLifetimeValidation,
  testSessionLifetimeHttp,
  testSessionLifetimePollUntilExpiry,
};
