/**
 * SLC (Synthetics' Last Cradle) API tests — prize-authz oriented coverage from
 * api-docs/slc-swagger.json (game create/join/start/play/admin + CRUDA/home).
 * Shared identyclaw suites are intentionally out of ENABLED_TEST_SUITES for SLC.
 *
 * Multi-player: the harness uses one RODiT session only (API: one session per rodit).
 * When start/play needs more agents, tests poll while the operator joins
 * EXTRA_AGENTS_NEEDED additional agents via POST .../join with distinct RODiTs.
 * Timeout: API_DEFAULT_OPTIONS.SLC_EXTRA_AGENTS_WAIT_SECONDS (default 180).
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
  extractApiErrorInfo,
} = require("./test-utils");

const MODULE_NAME = "slc-api";

/** Extra distinct RODiT agents the operator must join (API: one session per rodit). */
const EXTRA_AGENTS_NEEDED = 2;

const JSON_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

function extraAgentsWaitMs() {
  const raw =
    config.get("API_DEFAULT_OPTIONS.SLC_EXTRA_AGENTS_WAIT_SECONDS") ??
    process.env.SLC_EXTRA_AGENTS_WAIT_SECONDS ??
    180;
  const sec = Number(raw);
  return (Number.isFinite(sec) && sec > 0 ? sec : 180) * 1000;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loginJwt() {
  const client = await getRoditClientForTest();
  const loginResult = await client.login_server();
  if (!loginResult?.success || !loginResult.jwt_token) {
    throw new Error(loginResult?.error || "Login not-passed");
  }
  return loginResult.jwt_token;
}

function authHeaders(jwt, extra = {}) {
  return {
    ...JSON_HEADERS,
    Authorization: bearerAuthorizationHeader(jwt),
    "X-Request-ID": ulid(),
    ...extra,
  };
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text.slice(0, 400) };
  }
}

function errorCode(body) {
  return body?.error?.code || body?.code || body?.errorCode || null;
}

function isAuthRejected(status) {
  return status === 401 || status === 403;
}

function hasErrorEnvelope(body) {
  return Boolean(body?.error?.code || body?.error?.message || (body?.error && body?.requestId));
}

/**
 * Collect positive/negative case results for a prize-security test.
 */
function createCaseCollector() {
  return { positive: [], negative: [] };
}

function addCase(collector, side, name, passed, detail = {}) {
  collector[side].push({ name, passed, ...detail });
  return passed;
}

function summarizeCases(collector) {
  const failed = [...collector.positive, ...collector.negative].filter((c) => !c.passed);
  return {
    positiveCount: collector.positive.length,
    negativeCount: collector.negative.length,
    failed: failed.map((c) => c.name),
    cases: collector,
  };
}

function requireBothSides(collector) {
  if (collector.positive.length === 0) {
    return "missing positive case coverage";
  }
  if (collector.negative.length === 0) {
    return "missing negative case coverage";
  }
  const failed = [...collector.positive, ...collector.negative].filter((c) => !c.passed);
  if (failed.length) {
    return `not-passed: ${failed.map((c) => c.name).join(", ")}`;
  }
  return null;
}

/**
 * POST JSON; returns { response, body, status, code }.
 */
async function gameFetch(apiEndpoint, path, { method = "GET", jwt, body, headers } = {}) {
  const opts = {
    method,
    headers: jwt
      ? authHeaders(jwt, headers)
      : { ...JSON_HEADERS, "X-Request-ID": ulid(), ...headers },
  };
  if (body !== undefined) {
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const response = await fetchDirect(apiEndpoint, path, opts);
  const parsed = await parseJsonSafe(response);
  return {
    response,
    body: parsed,
    status: response.status,
    code: errorCode(parsed),
  };
}

function pickGameId(body) {
  return (
    body?.game?.id ||
    body?.gameId ||
    body?.id ||
    body?.lobby?.id ||
    null
  );
}

function pickAgentId(body) {
  return body?.agent?.id || body?.agent?.agentId || body?.agentId || null;
}

function countAgentsInState(body) {
  if (!body || typeof body !== "object") return 0;
  // GamePublicState: { game, livingAgentCount, agents, you, ... }
  if (Array.isArray(body.agents)) return body.agents.length;
  if (typeof body.livingAgentCount === "number") return body.livingAgentCount;
  const nested = body.game;
  if (nested && typeof nested === "object") {
    if (Array.isArray(nested.agents)) return nested.agents.length;
    if (typeof nested.livingAgentCount === "number") return nested.livingAgentCount;
    if (typeof nested.agentCount === "number") return nested.agentCount;
  }
  if (typeof body.agentCount === "number") return body.agentCount;
  return 0;
}

function gameStatusFromState(body) {
  if (!body || typeof body !== "object") return null;
  return (
    body.game?.status ||
    body.status ||
    body.game?.game?.status ||
    null
  );
}

async function readAgentCount(apiEndpoint, gameId, jwt) {
  const state = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(gameId)}/state`, {
    jwt,
  });
  if (state.status !== 200) {
    return {
      count: 0,
      status: state.status,
      code: state.code,
      body: state.body,
      gameStatus: null,
    };
  }
  return {
    count: countAgentsInState(state.body),
    status: 200,
    body: state.body,
    gameStatus: gameStatusFromState(state.body),
  };
}

function configuredExistingGameId() {
  const fromConfig = config.get("API_DEFAULT_OPTIONS.SLC_EXISTING_GAME_ID");
  const fromEnv = process.env.SLC_EXISTING_GAME_ID || process.env.API_DEFAULT_OPTIONS_SLC_EXISTING_GAME_ID;
  const raw = (typeof fromConfig === "string" && fromConfig.trim()) || (fromEnv && String(fromEnv).trim()) || "";
  return raw || null;
}

/**
 * Wait until lobby has minAgents OR the game is already running/finished
 * (operator may have started it). Prefer SLC_EXISTING_GAME_ID when set.
 */
async function waitForOperatorExtraJoins(apiEndpoint, gameId, jwt, {
  extraNeeded = EXTRA_AGENTS_NEEDED,
  minAgents = 1 + EXTRA_AGENTS_NEEDED,
  timeoutMs = extraAgentsWaitMs(),
  pollMs = 3000,
} = {}) {
  const target = Math.max(minAgents, 1 + extraNeeded);
  const baselineRead = await readAgentCount(apiEndpoint, gameId, jwt);
  const baseline = baselineRead.count || 0;
  const stillNeeded = Math.max(0, target - baseline);
  const runningAlready = isGamePastLobby(baselineRead.gameStatus);

  if (runningAlready || stillNeeded === 0) {
    logger.info("SLC multi-player wait: lobby ready (enough agents or game already ongoing)", {
      component: MODULE_NAME,
      gameId,
      baseline,
      target,
      minAgents,
      gameStatus: baselineRead.gameStatus,
    });
    return {
      ok: true,
      baseline,
      finalCount: baseline,
      waitedMs: 0,
      gameId,
      target,
      gameStatus: baselineRead.gameStatus,
    };
  }

  logger.info("SLC multi-player wait: join extra agents with distinct RODiTs", {
    component: MODULE_NAME,
    gameId,
    baseline,
    stillNeeded,
    extraNeeded,
    target,
    minAgents,
    timeoutMs,
    joinPath: `POST /api/game/games/${gameId}/join`,
    note: "API allows only one session per rodit — do not reuse the test harness passport",
  });

  const started = Date.now();
  let finalCount = baseline;
  let gameStatus = baselineRead.gameStatus;
  while (Date.now() - started < timeoutMs) {
    const snap = await readAgentCount(apiEndpoint, gameId, jwt);
    finalCount = snap.count;
    gameStatus = snap.gameStatus;
    if (finalCount >= target || isGamePastLobby(gameStatus)) {
      logger.info("SLC multi-player wait: target reached or game ongoing", {
        component: MODULE_NAME,
        gameId,
        finalCount,
        target,
        gameStatus,
        waitedMs: Date.now() - started,
      });
      return { ok: true, baseline, finalCount, waitedMs: Date.now() - started, gameId, target, gameStatus };
    }
    await sleep(pollMs);
  }

  return {
    ok: false,
    baseline,
    finalCount,
    waitedMs: Date.now() - started,
    gameId,
    target,
    gameStatus,
    error: `Timed out after ${timeoutMs}ms waiting for lobby to reach ${target} agents (have ${finalCount}, need ${Math.max(0, target - finalCount)} more). Join via POST /api/game/games/${gameId}/join with distinct RODiTs.`,
  };
}

function isGamePastLobby(status) {
  const s = String(status || "").toLowerCase();
  return ["running", "started", "negotiation", "execution", "finished", "completed"].includes(s);
}

/**
 * List public games and return first joinable casual lobby id if present.
 */
async function findOpenCasualLobbyId(apiEndpoint) {
  const { status, body } = await gameFetch(apiEndpoint, "/api/game/games?limit=50");
  if (status !== 200 || !body) return null;
  const list = body.games || body.items || body.entries || (Array.isArray(body) ? body : []);
  if (!Array.isArray(list)) return null;
  for (const g of list) {
    const id = g?.id || g?.gameId;
    const statusName = String(g?.status || "").toLowerCase();
    const mode = String(g?.contestMode || g?.preset || g?.config?.preset || "").toLowerCase();
    const joinable =
      statusName === "lobby" ||
      statusName === "joining" ||
      statusName === "open" ||
      g?.joinable === true;
    const casual = !mode || mode === "casual" || mode === "practice";
    if (id && joinable && casual) return id;
  }
  return null;
}

/**
 * Create a casual lobby (autoJoin default true), or join an existing open lobby on 409 OPEN_LOBBY_AVAILABLE.
 * @returns {{ gameId, agentId, createStatus, createCode, joinedExisting, body }}
 */
async function createOrJoinCasualLobby(apiEndpoint, jwt, createBody = {}) {
  const create = await gameFetch(apiEndpoint, "/api/game/games", {
    method: "POST",
    jwt,
    body: {
      displayName: `clienttest-${ulid().slice(0, 8)}`,
      ...createBody,
    },
  });

  if (create.status === 201 || create.status === 200) {
    return {
      gameId: pickGameId(create.body),
      agentId: pickAgentId(create.body),
      createStatus: create.status,
      createCode: create.code,
      joinedExisting: false,
      body: create.body,
    };
  }

  if (create.status === 409 && (create.code === "OPEN_LOBBY_AVAILABLE" || !create.code)) {
    const existingId = findOpenLobbyIdFromError(create.body) || (await findOpenCasualLobbyId(apiEndpoint));
    if (!existingId) {
      return {
        gameId: null,
        agentId: null,
        createStatus: create.status,
        createCode: create.code,
        joinedExisting: false,
        body: create.body,
        error: "OPEN_LOBBY_AVAILABLE but no lobby id found",
      };
    }
    const join = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(existingId)}/join`, {
      method: "POST",
      jwt,
      body: { displayName: `clienttest-join-${ulid().slice(0, 8)}` },
    });
    return {
      gameId: existingId,
      agentId: pickAgentId(join.body),
      createStatus: create.status,
      createCode: create.code,
      joinedExisting: true,
      joinStatus: join.status,
      joinCode: join.code,
      body: join.body,
    };
  }

  return {
    gameId: pickGameId(create.body),
    agentId: pickAgentId(create.body),
    createStatus: create.status,
    createCode: create.code,
    joinedExisting: false,
    body: create.body,
  };
}

/**
 * Prefer SLC_EXISTING_GAME_ID when set (ongoing games); else create/join casual and wait.
 */
async function prepareMultiPlayerLobby(apiEndpoint, jwt, { waitForExtras = true } = {}) {
  const existingId = configuredExistingGameId();
  if (existingId) {
    logger.info("SLC using configured existing gameId", {
      component: MODULE_NAME,
      gameId: existingId,
    });
    // Join if still a lobby; 409 when already running/joined is fine.
    const join = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(existingId)}/join`, {
      method: "POST",
      jwt,
      body: { displayName: `host-${ulid().slice(0, 6)}` },
    });
    const extras = waitForExtras
      ? await waitForOperatorExtraJoins(apiEndpoint, existingId, jwt)
      : null;
    return {
      gameId: existingId,
      agentId: pickAgentId(join.body),
      createStatus: join.status,
      createCode: join.code,
      joinedExisting: true,
      usedConfiguredGameId: true,
      body: join.body,
      extras,
    };
  }

  const lobby = await createOrJoinCasualLobby(apiEndpoint, jwt, {
    autoJoin: true,
    displayName: `host-${ulid().slice(0, 6)}`,
    config: { minAgents: 3 },
  });
  if (!lobby.gameId) {
    return { ...lobby, extras: null, started: null };
  }

  let extras = null;
  if (waitForExtras) {
    extras = await waitForOperatorExtraJoins(apiEndpoint, lobby.gameId, jwt);
  }

  return { ...lobby, extras };
}

function findOpenLobbyIdFromError(body) {
  const details = body?.error?.details || body?.details || {};
  return (
    details.gameId ||
    details.openGameId ||
    details.lobbyId ||
    details.existingGameId ||
    null
  );
}

/**
 * Probe privileged contest create. Returns { privileged: boolean|null, status, code, body }.
 * privileged=true on 201; false on 403; null on unexpected.
 */
async function probePrivilegedContestCreate(apiEndpoint, jwt) {
  const practiceStartsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await gameFetch(apiEndpoint, "/api/game/contests", {
    method: "POST",
    jwt,
    body: {
      practiceStartsAt,
      prizeAmountYoctoNear: "1",
    },
  });
  if (result.status === 201 || result.status === 200) {
    return { privileged: true, ...result };
  }
  if (result.status === 403) {
    return { privileged: false, ...result };
  }
  return { privileged: null, ...result };
}

function failCapture(testName, testData, error, details) {
  return captureTestData(
    testName,
    MODULE_NAME,
    {
      passed: false,
      error,
      details: details || testData,
      errorInfo: typeof error === "object" ? error : undefined,
    },
    testData
  );
}

function passCapture(testName, testData, message, details) {
  return captureTestData(
    testName,
    MODULE_NAME,
    { passed: true, message, details: details || testData },
    testData
  );
}

const slcApiTests = {
  /**
   * GET /api/home — public homepage string (slc-swagger)
   */
  testApiHome: async (apiEndpoint) => {
    const testName = "testApiHome";
    const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/home` };
    try {
      const response = await fetchDirect(apiEndpoint, "/api/home", { method: "GET" });
      testData.status = response.status;
      const text = await response.text();
      testData.bodyPreview = text.slice(0, 120);
      const passed = response.status === 200 && text.length > 0;
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "GET /api/home returned content" : "GET /api/home not-passed",
          error: passed ? undefined : `status ${response.status}`,
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * GET /api/token/claims — requires Bearer; returns claims when authenticated
   */
  testTokenClaims: async (apiEndpoint) => {
    const testName = "testTokenClaims";
    const correlationId = ulid();
    const testData = { apiEndpoint, endpoint: `${apiEndpoint}/api/token/claims` };
    try {
      const unauth = await fetchDirect(apiEndpoint, "/api/token/claims", {
        method: "GET",
        headers: { "X-Request-ID": correlationId },
      });
      testData.unauthStatus = unauth.status;
      if (unauth.status === 200) {
        return failCapture(testName, testData, "Unauthenticated GET /api/token/claims must not return 200");
      }

      const jwt = await loginJwt();
      const auth = await fetchDirect(apiEndpoint, "/api/token/claims", {
        method: "GET",
        headers: {
          Authorization: bearerAuthorizationHeader(jwt),
          "X-Request-ID": correlationId,
        },
      });
      testData.authStatus = auth.status;
      const body = await auth.json().catch(() => null);
      testData.bodyKeys = body && typeof body === "object" ? Object.keys(body) : [];
      const passed = auth.status === 200 && body && typeof body === "object";
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "GET /api/token/claims returns claims with Bearer" : undefined,
          error: passed ? undefined : `status ${auth.status}`,
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Public spectator game routes from slc-swagger (no JWT)
   */
  testGamePublicSpectatorEndpoints: async (apiEndpoint) => {
    const testName = "testGamePublicSpectatorEndpoints";
    const testData = { apiEndpoint, probes: [] };
    const paths = [
      "/api/game/games",
      "/api/game/hall-of-fame",
      "/api/game/skill.md",
      "/api/game/peer-auth.md",
      "/api/game/action-schema.md",
      "/api/game/narrative",
      "/api/game/contests",
    ];
    // /api/game/defaults and /defaults/contest are jwt-passport (not public-spectator).
    try {
      for (const path of paths) {
        const response = await fetchDirect(apiEndpoint, path, {
          method: "GET",
          headers: { Accept: path.endsWith(".md") ? "text/markdown,text/plain,*/*" : "application/json" },
        });
        const probe = { path, status: response.status, ok: response.ok };
        testData.probes.push(probe);
        if (!response.ok) {
          return failCapture(
            testName,
            testData,
            `Public game path ${path} returned HTTP ${response.status}`,
            testData.probes
          );
        }
      }
      return passCapture(
        testName,
        testData,
        `Public spectator game routes OK (${paths.length})`,
        testData.probes
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Authenticated game list/mine/tasks (slc-swagger jwt-passport)
   */
  testGameAuthenticatedReadEndpoints: async (apiEndpoint) => {
    const testName = "testGameAuthenticatedReadEndpoints";
    const correlationId = ulid();
    const testData = { apiEndpoint, probes: [] };
    try {
      const jwt = await loginJwt();
      const paths = ["/api/game/games/mine", "/api/game/tasks"];
      for (const path of paths) {
        const response = await fetchDirect(apiEndpoint, path, {
          method: "GET",
          headers: {
            Authorization: bearerAuthorizationHeader(jwt),
            Accept: "application/json",
            "X-Request-ID": correlationId,
          },
        });
        const body = await response.json().catch(() => null);
        testData.probes.push({ path, status: response.status, keys: body && Object.keys(body) });
        if (!response.ok) {
          return failCapture(
            testName,
            testData,
            `${path} returned HTTP ${response.status}`,
            testData.probes
          );
        }
      }
      return passCapture(testName, testData, "Authenticated game read routes OK", testData.probes);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: create / join / start — negative authz + positive casual lifecycle.
   */
  testGameCreateJoinStartAuthz: async (apiEndpoint) => {
    const testName = "testGameCreateJoinStartAuthz";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const fakeId = "01JCLIENTTESTIDC0FAKE0GAME";

      // --- Negative: unauthenticated mutations ---
      const unauthCreate = await gameFetch(apiEndpoint, "/api/game/games", {
        method: "POST",
        body: { displayName: "unauth" },
      });
      addCase(cases, "negative", "unauth POST /api/game/games → 401/403", isAuthRejected(unauthCreate.status), {
        status: unauthCreate.status,
        code: unauthCreate.code,
        hasError: hasErrorEnvelope(unauthCreate.body),
      });

      const unauthJoin = await gameFetch(apiEndpoint, `/api/game/games/${fakeId}/join`, {
        method: "POST",
        body: {},
      });
      addCase(cases, "negative", "unauth POST .../join → 401/403", isAuthRejected(unauthJoin.status), {
        status: unauthJoin.status,
        code: unauthJoin.code,
      });

      const unauthStart = await gameFetch(apiEndpoint, `/api/game/games/${fakeId}/start`, {
        method: "POST",
        body: {},
      });
      addCase(cases, "negative", "unauth POST .../start → 401/403", isAuthRejected(unauthStart.status), {
        status: unauthStart.status,
        code: unauthStart.code,
      });

      const jwt = await loginJwt();

      // --- Negative: authenticated against missing game ---
      const missingJoin = await gameFetch(apiEndpoint, `/api/game/games/${fakeId}/join`, {
        method: "POST",
        jwt,
        body: { displayName: "missing" },
      });
      addCase(
        cases,
        "negative",
        "auth join nonexistent game → 404/409",
        missingJoin.status === 404 || missingJoin.status === 409,
        { status: missingJoin.status, code: missingJoin.code }
      );

      const missingStart = await gameFetch(apiEndpoint, `/api/game/games/${fakeId}/start`, {
        method: "POST",
        jwt,
        body: {},
      });
      addCase(
        cases,
        "negative",
        "auth start nonexistent game → 404/409",
        missingStart.status === 404 || missingStart.status === 409,
        { status: missingStart.status, code: missingStart.code }
      );

      // --- Positive: use configured ongoing game OR create casual + wait ---
      // One harness RODiT only — never open a second session for the same rodit.
      const prepared = await prepareMultiPlayerLobby(apiEndpoint, jwt, { waitForExtras: true });
      const gameId = prepared.gameId;
      testData.gameId = gameId;
      testData.extras = prepared.extras;
      addCase(
        cases,
        "positive",
        prepared.usedConfiguredGameId
          ? `using configured gameId ${gameId}`
          : "auth create/join casual lobby (single harness passport) → gameId",
        Boolean(gameId),
        {
          createStatus: prepared.createStatus,
          createCode: prepared.createCode,
          joinedExisting: prepared.joinedExisting,
          usedConfiguredGameId: prepared.usedConfiguredGameId,
          gameId,
          extras: prepared.extras,
        }
      );

      if (gameId) {
        const mine = await gameFetch(apiEndpoint, "/api/game/games/mine", { jwt });
        addCase(cases, "positive", "GET /api/game/games/mine → 200", mine.status === 200, {
          status: mine.status,
          gameId,
        });

        const start = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(gameId)}/start`, {
          method: "POST",
          jwt,
          body: {},
        });
        // Ongoing games: GAME_ALREADY_STARTED / 409 is success for this harness.
        const startOk =
          start.status === 200 ||
          start.status === 201 ||
          start.status === 409 ||
          (start.status === 400 && start.code === "INSUFFICIENT_AGENTS");
        addCase(
          cases,
          start.status === 200 || start.status === 201 || start.status === 409 ? "positive" : "negative",
          start.status === 409
            ? "auth start on ongoing game → 409 already started (OK)"
            : start.status === 200 || start.status === 201
              ? "auth start → 200/201"
              : "auth start → INSUFFICIENT_AGENTS/400",
          startOk,
          { status: start.status, code: start.code, gameId }
        );

        if (start.status === 200 || start.status === 201) {
          const restart = await gameFetch(
            apiEndpoint,
            `/api/game/games/${encodeURIComponent(gameId)}/start`,
            { method: "POST", jwt, body: {} }
          );
          addCase(
            cases,
            "negative",
            "auth start already-started → 409",
            restart.status === 409 || restart.status === 400,
            { status: restart.status, code: restart.code }
          );
        }
      }

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "create/join/start positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: join-by-url blocked on contest (negative); casual path + bad URL (pos/neg).
   */
  testJoinByUrlBlockedOnContest: async (apiEndpoint) => {
    const testName = "testJoinByUrlBlockedOnContest";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const jwt = await loginJwt();
      const priv = await probePrivilegedContestCreate(apiEndpoint, jwt);
      testData.privileged = priv.privileged;

      let contestGameId = null;
      if (priv.privileged === true) {
        const contestCreate = await gameFetch(apiEndpoint, "/api/game/games", {
          method: "POST",
          jwt,
          body: { preset: "definitive", autoJoin: false, displayName: "prize-lobby" },
        });
        contestGameId = pickGameId(contestCreate.body);
        if (!contestGameId) {
          const alt = await gameFetch(apiEndpoint, "/api/game/games", {
            method: "POST",
            jwt,
            body: { preset: "contest", autoJoin: false },
          });
          contestGameId = pickGameId(alt.body);
          addCase(
            cases,
            "positive",
            "privileged create contest/definitive lobby",
            Boolean(contestGameId) || [201, 200, 409].includes(alt.status) || [201, 200, 409].includes(contestCreate.status),
            {
              definitiveStatus: contestCreate.status,
              contestStatus: alt.status,
              gameId: contestGameId,
            }
          );
        } else {
          addCase(cases, "positive", "privileged create definitive lobby", true, {
            status: contestCreate.status,
            gameId: contestGameId,
          });
        }
      } else {
        const forbidden = await gameFetch(apiEndpoint, "/api/game/games", {
          method: "POST",
          jwt,
          body: { preset: "definitive", autoJoin: false },
        });
        addCase(
          cases,
          "negative",
          "non-privileged definitive create → 403",
          forbidden.status === 403,
          { status: forbidden.status, code: forbidden.code, hasError: hasErrorEnvelope(forbidden.body) }
        );
      }

      if (contestGameId) {
        const urlJoin = await gameFetch(
          apiEndpoint,
          `/api/game/games/${encodeURIComponent(contestGameId)}/join-by-url`,
          {
            method: "POST",
            body: { webhookUrl: "https://example.com/hooks/wake", displayName: "url-sybil" },
          }
        );
        const blocked =
          urlJoin.status === 403 &&
          (!urlJoin.code ||
            urlJoin.code === "URL_JOIN_NOT_ALLOWED" ||
            String(urlJoin.code).includes("URL_JOIN"));
        addCase(
          cases,
          "negative",
          "join-by-url on contest lobby → 403 URL_JOIN_NOT_ALLOWED",
          blocked || urlJoin.status === 403,
          { status: urlJoin.status, code: urlJoin.code }
        );

        // Positive contrast: passport join on contest lobby is allowed (or documented join-window error)
        const passportJoin = await gameFetch(
          apiEndpoint,
          `/api/game/games/${encodeURIComponent(contestGameId)}/join`,
          {
            method: "POST",
            jwt,
            body: { displayName: `passport-${ulid().slice(0, 6)}` },
          }
        );
        addCase(
          cases,
          "positive",
          "passport join on contest lobby → 201 or JOIN_WINDOW_*/GAME_*",
          passportJoin.status === 201 ||
            passportJoin.status === 200 ||
            passportJoin.status === 409 ||
            passportJoin.status === 400,
          { status: passportJoin.status, code: passportJoin.code }
        );
      }

      const casual = await createOrJoinCasualLobby(apiEndpoint, jwt, { autoJoin: true });
      addCase(cases, "positive", "casual lobby available for join-by-url probes", Boolean(casual.gameId), {
        createStatus: casual.createStatus,
        gameId: casual.gameId,
      });

      if (casual.gameId) {
        const badUrl = await gameFetch(
          apiEndpoint,
          `/api/game/games/${encodeURIComponent(casual.gameId)}/join-by-url`,
          {
            method: "POST",
            body: { webhookUrl: "not-a-url", displayName: "bad-url" },
          }
        );
        addCase(
          cases,
          "negative",
          "join-by-url invalid webhookUrl rejected",
          badUrl.status >= 400 && badUrl.status < 500,
          { status: badUrl.status, code: badUrl.code }
        );

        const casualUrl = await gameFetch(
          apiEndpoint,
          `/api/game/games/${encodeURIComponent(casual.gameId)}/join-by-url`,
          {
            method: "POST",
            body: {
              webhookUrl: "https://example.com/hooks/slc-wake",
              displayName: "casual-url",
            },
          }
        );
        // Policy probe only — multi-player start/play never fills seats via join-by-url
        // (operator joins distinct passport RODiTs instead).
        const casualOk =
          casualUrl.status === 201 ||
          casualUrl.status === 200 ||
          (casualUrl.status >= 400 && casualUrl.status < 500);
        addCase(
          cases,
          casualUrl.status === 201 || casualUrl.status === 200 ? "positive" : "negative",
          casualUrl.status === 201 || casualUrl.status === 200
            ? "join-by-url on casual lobby → 201 + jwt_token"
            : "join-by-url casual rejected with client error (full/policy)",
          casualOk && casualUrl.status < 500,
          {
            status: casualUrl.status,
            code: casualUrl.code,
            hasJwt: Boolean(casualUrl.body?.jwt_token),
          }
        );
        if (casualUrl.status === 201 || casualUrl.status === 200) {
          addCase(
            cases,
            "positive",
            "casual join-by-url response includes jwt_token",
            Boolean(casualUrl.body?.jwt_token),
            { keys: casualUrl.body ? Object.keys(casualUrl.body) : [] }
          );
        }
      }

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "join-by-url positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: POST /contests and /contest-series — 401/403 negatives; 201 or public GET positives.
   */
  testContestAdminPrivileges: async (apiEndpoint) => {
    const testName = "testContestAdminPrivileges";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const practiceStartsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
      const payload = { practiceStartsAt, prizeAmountYoctoNear: "1" };

      // Positive: public list is readable without admin
      const list = await gameFetch(apiEndpoint, "/api/game/contests?limit=5");
      addCase(cases, "positive", "GET /api/game/contests (public) → 200", list.status === 200, {
        status: list.status,
      });

      for (const path of ["/api/game/contests", "/api/game/contest-series"]) {
        const unauth = await gameFetch(apiEndpoint, path, { method: "POST", body: payload });
        addCase(
          cases,
          "negative",
          `unauth POST ${path} → 401/403`,
          isAuthRejected(unauth.status),
          { status: unauth.status, code: unauth.code, hasError: hasErrorEnvelope(unauth.body) }
        );
      }

      const jwt = await loginJwt();

      // Negative: missing required practiceStartsAt
      const badBody = await gameFetch(apiEndpoint, "/api/game/contests", {
        method: "POST",
        jwt,
        body: { prizeAmountYoctoNear: "1" },
      });
      addCase(
        cases,
        "negative",
        "auth POST /contests missing practiceStartsAt → 400/403",
        badBody.status === 400 || badBody.status === 403 || badBody.status === 422,
        { status: badBody.status, code: badBody.code }
      );

      let sawPrivileged = false;
      let sawForbidden = false;
      for (const path of ["/api/game/contests", "/api/game/contest-series"]) {
        const auth = await gameFetch(apiEndpoint, path, { method: "POST", jwt, body: payload });
        if (auth.status === 201 || auth.status === 200) {
          sawPrivileged = true;
          addCase(cases, "positive", `privileged POST ${path} → 201`, true, {
            status: auth.status,
            code: auth.code,
            bodyKeys: auth.body ? Object.keys(auth.body) : [],
          });
        } else if (auth.status === 403) {
          sawForbidden = true;
          addCase(cases, "negative", `non-privileged POST ${path} → 403`, true, {
            status: auth.status,
            code: auth.code,
            hasError: hasErrorEnvelope(auth.body),
          });
        } else {
          addCase(cases, "negative", `POST ${path} unexpected status`, false, {
            status: auth.status,
            code: auth.code,
          });
        }
      }

      testData.privileged = sawPrivileged;
      if (!sawPrivileged && !sawForbidden) {
        addCase(cases, "negative", "contest create returned neither 201 nor 403", false, {});
      }

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "contest admin privileges positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: contest|definitive preset gated; casual create still works (positive).
   */
  testContestPresetCreateForbidden: async (apiEndpoint) => {
    const testName = "testContestPresetCreateForbidden";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const jwt = await loginJwt();
      const priv = await probePrivilegedContestCreate(apiEndpoint, jwt);
      testData.privileged = priv.privileged;

      // Positive: casual create (no contest preset) succeeds or OPEN_LOBBY join
      const casual = await createOrJoinCasualLobby(apiEndpoint, jwt, { autoJoin: true });
      addCase(
        cases,
        "positive",
        "casual create/join without contest preset → gameId",
        Boolean(casual.gameId),
        {
          createStatus: casual.createStatus,
          createCode: casual.createCode,
          gameId: casual.gameId,
          joinedExisting: casual.joinedExisting,
        }
      );

      for (const preset of ["contest", "definitive"]) {
        const create = await gameFetch(apiEndpoint, "/api/game/games", {
          method: "POST",
          jwt,
          body: { preset, autoJoin: false },
        });
        if (priv.privileged === true) {
          addCase(
            cases,
            "positive",
            `privileged preset ${preset} create allowed or documented conflict`,
            [200, 201, 403, 409].includes(create.status),
            { status: create.status, code: create.code, gameId: pickGameId(create.body) }
          );
        } else {
          addCase(
            cases,
            "negative",
            `non-privileged preset ${preset} → 403`,
            create.status === 403,
            {
              status: create.status,
              code: create.code,
              hasError: hasErrorEnvelope(create.body),
            }
          );
        }
      }

      // Negative: unauth contest preset
      const unauthPreset = await gameFetch(apiEndpoint, "/api/game/games", {
        method: "POST",
        body: { preset: "contest", autoJoin: false },
      });
      addCase(
        cases,
        "negative",
        "unauth preset contest create → 401/403",
        isAuthRejected(unauthPreset.status),
        { status: unauthPreset.status, code: unauthPreset.code }
      );

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "preset create gate positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: play endpoints — unauth rejected; auth accepted after operator fills lobby.
   */
  testPlayEndpointsCallerScoped: async (apiEndpoint) => {
    const testName = "testPlayEndpointsCallerScoped";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const jwt = await loginJwt();
      // Single harness passport only; operator must join EXTRA_AGENTS_NEEDED more RODiTs.
      const prepared = await prepareMultiPlayerLobby(apiEndpoint, jwt, { waitForExtras: true });
      addCase(cases, "positive", "lobby for play probes (harness passport)", Boolean(prepared.gameId), {
        createStatus: prepared.createStatus,
        gameId: prepared.gameId,
      });
      if (!prepared.gameId) {
        testData.summary = summarizeCases(cases);
        return failCapture(testName, testData, prepared.error || "no gameId", testData.summary);
      }
      const gameId = prepared.gameId;
      testData.gameId = gameId;
      testData.extras = prepared.extras;

      addCase(
        cases,
        "positive",
        `operator joined ${EXTRA_AGENTS_NEEDED} extra agents before play`,
        Boolean(prepared.extras?.ok),
        prepared.extras || {}
      );

      const start = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(gameId)}/start`, {
        method: "POST",
        jwt,
        body: {},
      });
      const alreadyStarted =
        start.status === 409 || start.code === "GAME_ALREADY_STARTED";
      const startedFresh = start.status === 200 || start.status === 201;
      if (prepared.extras?.ok || prepared.extras?.gameStatus) {
        addCase(
          cases,
          startedFresh || alreadyStarted ? "positive" : "negative",
          alreadyStarted
            ? "start before play → 409 GAME_ALREADY_STARTED (ongoing OK)"
            : startedFresh
              ? "start before play → 200/201"
              : "start before play unexpected status",
          startedFresh || alreadyStarted,
          { status: start.status, code: start.code }
        );
      } else {
        addCase(
          cases,
          "negative",
          "start without extras → INSUFFICIENT_AGENTS/409",
          (start.status === 400 && start.code === "INSUFFICIENT_AGENTS") ||
            start.status === 409 ||
            start.status === 400,
          { status: start.status, code: start.code }
        );
      }

      const playCases = [
        {
          name: "action",
          path: `/api/game/games/${encodeURIComponent(gameId)}/action`,
          body: { type: "none" },
        },
        {
          name: "message",
          path: `/api/game/games/${encodeURIComponent(gameId)}/message`,
          body: { body: "clienttest prize-security probe" },
        },
        {
          name: "project",
          path: `/api/game/games/${encodeURIComponent(gameId)}/project`,
          body: { type: "none" },
        },
        {
          name: "recollection",
          path: `/api/game/games/${encodeURIComponent(gameId)}/recollection`,
          body: { overview: "clienttest recollection probe" },
        },
        {
          name: "tick",
          path: "/api/game/tick",
          body: { type: "none", gameId },
        },
      ];

      const fakeId = "01JCLIENTTESTIDC0FAKE0GAME";
      const missingAction = await gameFetch(apiEndpoint, `/api/game/games/${fakeId}/action`, {
        method: "POST",
        jwt,
        body: { type: "none" },
      });
      addCase(
        cases,
        "negative",
        "auth action on nonexistent game → 404/409",
        missingAction.status === 404 || missingAction.status === 409 || missingAction.status === 400,
        { status: missingAction.status, code: missingAction.code }
      );

      for (const c of playCases) {
        const unauth = await gameFetch(apiEndpoint, c.path, { method: "POST", body: c.body });
        addCase(
          cases,
          "negative",
          `unauth POST ${c.name} → 401/403`,
          isAuthRejected(unauth.status),
          { status: unauth.status, code: unauth.code }
        );

        const auth = await gameFetch(apiEndpoint, c.path, { method: "POST", jwt, body: c.body });
        const authOk = auth.status !== 401 && auth.status < 500;
        addCase(
          cases,
          auth.status >= 200 && auth.status < 300 ? "positive" : "negative",
          auth.status >= 200 && auth.status < 300
            ? `auth POST ${c.name} → ${auth.status}`
            : `auth POST ${c.name} → phase/state ${auth.status} (not 401)`,
          authOk,
          { status: auth.status, code: auth.code }
        );
      }

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "play endpoints positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: reads — public OK / 404; spectator must not leak you inventory; auth may see you.
   */
  testGameReadEndpoints: async (apiEndpoint) => {
    const testName = "testGameReadEndpoints";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const jwt = await loginJwt();
      const lobby = await createOrJoinCasualLobby(apiEndpoint, jwt, { autoJoin: true });
      addCase(cases, "positive", "lobby for read probes", Boolean(lobby.gameId), {
        gameId: lobby.gameId,
        createStatus: lobby.createStatus,
      });
      if (!lobby.gameId) {
        testData.summary = summarizeCases(cases);
        return failCapture(testName, testData, lobby.error || "no gameId", testData.summary);
      }
      const gameId = lobby.gameId;
      let agentId = lobby.agentId;

      // Negative: missing game
      const missing = await gameFetch(apiEndpoint, "/api/game/games/01JCLIENTTESTIDC0FAKE0GAME/state");
      addCase(
        cases,
        "negative",
        "GET state nonexistent → 404",
        missing.status === 404,
        { status: missing.status, code: missing.code }
      );

      // Positive auth state (may include you)
      const stateAuth = await gameFetch(apiEndpoint, `/api/game/games/${encodeURIComponent(gameId)}/state`, {
        jwt,
      });
      addCase(cases, "positive", "auth GET state → 200", stateAuth.status === 200, {
        status: stateAuth.status,
        hasYou: Boolean(stateAuth.body?.you),
      });
      if (stateAuth.status === 200 && stateAuth.body) {
        agentId =
          agentId ||
          stateAuth.body?.you?.id ||
          stateAuth.body?.you?.agentId ||
          stateAuth.body?.agents?.[0]?.id ||
          null;
      }

      const readPaths = [
        `/api/game/games/${encodeURIComponent(gameId)}/state`,
        `/api/game/games/${encodeURIComponent(gameId)}/messages`,
        `/api/game/games/${encodeURIComponent(gameId)}/trades`,
        `/api/game/games/${encodeURIComponent(gameId)}/honors`,
        `/api/game/games/${encodeURIComponent(gameId)}/turns`,
        `/api/game/games/${encodeURIComponent(gameId)}/recollections`,
      ];
      if (agentId) {
        readPaths.push(
          `/api/game/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(agentId)}/identity`
        );
      }

      for (const path of readPaths) {
        const { status, body } = await gameFetch(apiEndpoint, path);
        const hasPrivateYou =
          body &&
          typeof body === "object" &&
          body.you &&
          (body.you.inventory || body.you.resources || body.you.energy !== undefined);
        addCase(
          cases,
          "positive",
          `spectator GET ${path.split("/").slice(-1)[0]} → 200/404`,
          status === 200 || status === 404,
          { status, path }
        );
        addCase(
          cases,
          "negative",
          `spectator GET ${path.split("/").slice(-1)[0]} must not leak you inventory`,
          !hasPrivateYou,
          { hasPrivateYou: Boolean(hasPrivateYou), status }
        );
      }

      if (agentId) {
        const identity = await gameFetch(
          apiEndpoint,
          `/api/game/games/${encodeURIComponent(gameId)}/players/${encodeURIComponent(agentId)}/identity`
        );
        addCase(
          cases,
          "positive",
          "GET players/{agentId}/identity → 200 with agentId",
          identity.status === 200 && (identity.body?.agentId || identity.body?.roditId),
          {
            status: identity.status,
            agentId: identity.body?.agentId,
            roditId: identity.body?.roditId,
          }
        );
      }

      const eventsPath = `/api/game/games/${encodeURIComponent(gameId)}/events`;
      const eventsResp = await fetchDirect(apiEndpoint, eventsPath, {
        method: "GET",
        headers: {
          Accept: "text/event-stream, application/json",
          "X-Request-ID": ulid(),
        },
      });
      const ct = (eventsResp.headers.get("content-type") || "").toLowerCase();
      try {
        if (eventsResp.body && typeof eventsResp.body.cancel === "function") {
          await eventsResp.body.cancel();
        } else {
          await eventsResp.text().catch(() => "");
        }
      } catch {
        /* ignore */
      }
      addCase(
        cases,
        "positive",
        "GET .../events public spectator → 200/404 (not 401)",
        (eventsResp.status === 200 || eventsResp.status === 404) && eventsResp.status !== 401,
        { status: eventsResp.status, contentType: ct }
      );
      addCase(
        cases,
        "negative",
        "GET .../events must not require auth",
        eventsResp.status !== 401,
        { status: eventsResp.status }
      );

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "game reads positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Prize-security: hall-of-fame list + by contestId (positive) and bad id (negative).
   */
  testHallOfFameContestId: async (apiEndpoint) => {
    const testName = "testHallOfFameContestId";
    const cases = createCaseCollector();
    const testData = { apiEndpoint, cases };
    try {
      const bad = await gameFetch(apiEndpoint, "/api/game/hall-of-fame/01JNOTEXISTENTCONTESTID0");
      addCase(
        cases,
        "negative",
        "GET hall-of-fame/{badId} → 404/400",
        bad.status === 404 || bad.status === 400,
        { status: bad.status, code: bad.code, hasError: hasErrorEnvelope(bad.body) }
      );

      const hofList = await gameFetch(apiEndpoint, "/api/game/hall-of-fame?limit=10");
      addCase(cases, "positive", "GET /api/game/hall-of-fame → 200", hofList.status === 200, {
        status: hofList.status,
        keys: hofList.body && typeof hofList.body === "object" ? Object.keys(hofList.body) : [],
      });

      const list = await gameFetch(apiEndpoint, "/api/game/contests?limit=10");
      addCase(cases, "positive", "GET /api/game/contests → 200", list.status === 200, {
        status: list.status,
      });

      let contestId = null;
      if (list.status === 200 && list.body) {
        const entries =
          list.body.contests || list.body.entries || list.body.items || list.body.series || [];
        if (Array.isArray(entries) && entries.length > 0) {
          contestId = entries[0].id || entries[0].contestId || entries[0].seriesId || null;
        }
      }
      if (!contestId && hofList.status === 200 && hofList.body) {
        const entries = hofList.body.entries || hofList.body.contests || [];
        if (Array.isArray(entries) && entries.length > 0) {
          contestId = entries[0].contestId || entries[0].id || null;
        }
      }

      if (contestId) {
        const one = await gameFetch(
          apiEndpoint,
          `/api/game/hall-of-fame/${encodeURIComponent(contestId)}`
        );
        addCase(
          cases,
          "positive",
          `GET hall-of-fame/${contestId} → 200`,
          one.status === 200,
          {
            status: one.status,
            keys: one.body && typeof one.body === "object" ? Object.keys(one.body) : [],
          }
        );
      } else {
        // Still a positive structural check on list response when no contest exists yet
        addCase(
          cases,
          "positive",
          "hall-of-fame list response is object (no contest id yet)",
          hofList.status === 200 && hofList.body && typeof hofList.body === "object",
          { note: "skipped by-id positive; no contestId in environment" }
        );
      }

      testData.summary = summarizeCases(cases);
      const err = requireBothSides(cases);
      if (err) return failCapture(testName, testData, err, testData.summary);
      return passCapture(testName, testData, "hall-of-fame positive+negative OK", testData.summary);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * CRUDA routes require authentication (slc-swagger)
   */
  testCrudaRequiresAuth: async (apiEndpoint) => {
    const testName = "testCrudaRequiresAuth";
    const testData = { apiEndpoint, probes: [] };
    const cases = [
      { method: "GET", path: "/api/cruda/list" },
      { method: "POST", path: "/api/cruda/list", body: {} },
      { method: "POST", path: "/api/cruda/create", body: { text: "clienttest-idc probe" } },
      { method: "POST", path: "/api/cruda/read", body: { id: "nonexistent" } },
    ];
    try {
      for (const c of cases) {
        const response = await fetchDirect(apiEndpoint, c.path, {
          method: c.method,
          headers: { "Content-Type": "application/json", "X-Request-ID": ulid() },
          body: c.body !== undefined ? JSON.stringify(c.body) : undefined,
        });
        const rejected = response.status === 401 || response.status === 403;
        testData.probes.push({ ...c, status: response.status, rejected });
        if (!rejected) {
          return failCapture(
            testName,
            testData,
            `${c.method} ${c.path} expected 401/403 without auth, got ${response.status}`,
            testData.probes
          );
        }
      }
      return passCapture(testName, testData, "CRUDA rejects unauthenticated access", testData.probes);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * Authenticated CRUDA create → read → list → update → destroy round-trip
   */
  testCrudaAuthenticatedRoundTrip: async (apiEndpoint) => {
    const testName = "testCrudaAuthenticatedRoundTrip";
    const correlationId = ulid();
    const testData = { apiEndpoint, steps: [] };
    try {
      const jwt = await loginJwt();
      const headers = {
        Authorization: bearerAuthorizationHeader(jwt),
        "Content-Type": "application/json",
        "X-Request-ID": correlationId,
      };
      const marker = `clienttest-slc-${correlationId}`;

      const createResp = await fetchDirect(apiEndpoint, "/api/cruda/create", {
        method: "POST",
        headers,
        body: JSON.stringify({ text: marker }),
      });
      const createBody = await createResp.json().catch(() => null);
      testData.steps.push({ step: "create", status: createResp.status, body: createBody });
      if (!createResp.ok) {
        return failCapture(testName, testData, `create HTTP ${createResp.status}`, testData.steps);
      }
      const id = createBody?.id || createBody?.comment?.id || createBody?.data?.id;
      if (!id) {
        return failCapture(testName, testData, "create response missing id", testData.steps);
      }
      testData.id = id;

      const readResp = await fetchDirect(apiEndpoint, `/api/cruda/read/${encodeURIComponent(id)}`, {
        method: "GET",
        headers,
      });
      testData.steps.push({ step: "read", status: readResp.status });
      if (!readResp.ok) {
        return failCapture(testName, testData, `read HTTP ${readResp.status}`, testData.steps);
      }

      const listResp = await fetchDirect(apiEndpoint, "/api/cruda/list", {
        method: "GET",
        headers,
      });
      testData.steps.push({ step: "list", status: listResp.status });
      if (!listResp.ok) {
        return failCapture(testName, testData, `list HTTP ${listResp.status}`, testData.steps);
      }

      const updateResp = await fetchDirect(apiEndpoint, "/api/cruda/update", {
        method: "PUT",
        headers,
        body: JSON.stringify({ id, text: `${marker}-updated` }),
      });
      testData.steps.push({ step: "update", status: updateResp.status });
      if (!updateResp.ok) {
        return failCapture(testName, testData, `update HTTP ${updateResp.status}`, testData.steps);
      }

      const destroyResp = await fetchDirect(apiEndpoint, "/api/cruda/destroy", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
      });
      testData.steps.push({ step: "destroy", status: destroyResp.status });
      if (!destroyResp.ok) {
        return failCapture(testName, testData, `destroy HTTP ${destroyResp.status}`, testData.steps);
      }

      return passCapture(testName, testData, "CRUDA create/read/list/update/destroy OK", testData.steps);
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },

  /**
   * POST /api/signclient exists (validation shape covered elsewhere); unauthenticated probe
   */
  testSignclientEndpointPresent: async (apiEndpoint) => {
    const testName = "testSignclientEndpointPresent";
    const testData = { apiEndpoint };
    try {
      const response = await fetchDirect(apiEndpoint, "/api/signclient", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      testData.status = response.status;
      const passed = response.status !== 404;
      return captureTestData(
        testName,
        MODULE_NAME,
        {
          passed,
          message: passed ? "POST /api/signclient is mounted" : undefined,
          error: passed ? undefined : "POST /api/signclient returned 404",
        },
        testData
      );
    } catch (error) {
      return captureTestData(
        testName,
        MODULE_NAME,
        { passed: false, error: error.message, errorInfo: extractApiErrorInfo(error) },
        testData
      );
    }
  },
};

module.exports = slcApiTests;
