/**
 * Wall-clock container lifetime + restart-budget guards.
 * Caps getblock / NEAR RPC spend from long-lived or crash-looping test containers.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_MAX_LIFETIME_SECONDS = 7200;
const DEFAULT_MARKER_PATH = "/app/data/runtime-budget-exhausted.json";
const PROCESS_START_MS = Date.now();

class RuntimeBudgetExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RuntimeBudgetExceededError";
    this.reasonCode = details.reasonCode || "MAX_CONTAINER_LIFETIME_REACHED";
    this.details = details;
  }
}

let armedTimer = null;
let exitInProgress = false;

function getProcessStartMs() {
  return PROCESS_START_MS;
}

function resolveConfigGet(config) {
  if (!config) return null;
  if (typeof config.get === "function") {
    return (key) => config.get(key);
  }
  return (key) => {
    const parts = String(key).split(".");
    let cur = config;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[part];
    }
    return cur;
  };
}

function getMaxLifetimeSeconds(config) {
  const get = resolveConfigGet(config);
  const raw = get
    ? get("API_DEFAULT_OPTIONS.MAX_CONTAINER_LIFETIME_SECONDS")
    : process.env.API_DEFAULT_OPTIONS_MAX_CONTAINER_LIFETIME_SECONDS;
  const parsed = Number.parseInt(String(raw ?? DEFAULT_MAX_LIFETIME_SECONDS), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_LIFETIME_SECONDS;
  }
  return parsed;
}

function getMarkerPath(config) {
  const get = resolveConfigGet(config);
  const raw = get
    ? get("API_DEFAULT_OPTIONS.RUNTIME_BUDGET_MARKER_PATH")
    : process.env.API_DEFAULT_OPTIONS_RUNTIME_BUDGET_MARKER_PATH;
  const markerPath = String(raw || DEFAULT_MARKER_PATH).trim();
  return markerPath || DEFAULT_MARKER_PATH;
}

function getMaxRestartAttempts(config) {
  const get = resolveConfigGet(config);
  const raw = get
    ? get("API_DEFAULT_OPTIONS.MAX_CONTAINER_RESTART_ATTEMPTS")
    : process.env.API_DEFAULT_OPTIONS_MAX_CONTAINER_RESTART_ATTEMPTS;
  const parsed = Number.parseInt(String(raw ?? "3"), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
}

function getDeployId() {
  return (
    process.env.DEPLOY_SHA ||
    process.env.GITHUB_SHA ||
    process.env.IMAGE_TAG ||
    null
  );
}

function getDeadlineMs(config) {
  return getProcessStartMs() + getMaxLifetimeSeconds(config) * 1000;
}

function remainingMs(config) {
  return getDeadlineMs(config) - Date.now();
}

function isExpired(config) {
  return remainingMs(config) <= 0;
}

function uptimeMs() {
  return Date.now() - getProcessStartMs();
}

function budgetLogFields(config, extra = {}) {
  return {
    component: "RuntimeBudget",
    uptimeMs: uptimeMs(),
    maxLifetimeSeconds: getMaxLifetimeSeconds(config),
    maxRestartAttempts: getMaxRestartAttempts(config),
    markerPath: getMarkerPath(config),
    deployId: getDeployId(),
    remainingMs: remainingMs(config),
    ...extra,
  };
}

function assertWithinBudget(config, reasonContext = {}) {
  if (!isExpired(config)) return;
  throw new RuntimeBudgetExceededError(
    "Container max lifetime reached; aborting remaining work to protect RPC budget",
    {
      reasonCode: "MAX_CONTAINER_LIFETIME_REACHED",
      ...budgetLogFields(config, reasonContext),
    },
  );
}

function readExhaustionMarker(config) {
  const markerPath = getMarkerPath(config);
  try {
    if (!fs.existsSync(markerPath)) return null;
    const raw = fs.readFileSync(markerPath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { raw };
  } catch (error) {
    return {
      readError: error.message,
      markerPath,
    };
  }
}

function writeExhaustionMarker(config, payload = {}) {
  const markerPath = getMarkerPath(config);
  const dir = path.dirname(markerPath);
  fs.mkdirSync(dir, { recursive: true });
  const body = {
    reasonCode: payload.reasonCode || "RUNTIME_BUDGET_EXHAUSTED",
    at: new Date().toISOString(),
    uptimeMs: uptimeMs(),
    maxLifetimeSeconds: getMaxLifetimeSeconds(config),
    maxRestartAttempts: getMaxRestartAttempts(config),
    containerStartedAt: new Date(getProcessStartMs()).toISOString(),
    deployId: getDeployId(),
    ...payload,
  };
  fs.writeFileSync(markerPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return { markerPath, body };
}

function gracefulExit(logger, config, server, reasonCode, extra = {}) {
  if (exitInProgress) return;
  exitInProgress = true;

  const fields = budgetLogFields(config, { reasonCode, ...extra });
  try {
    writeExhaustionMarker(config, { reasonCode, ...extra });
  } catch (error) {
    if (logger && typeof logger.error === "function") {
      logger.error("Failed to write runtime budget marker", {
        ...fields,
        error: error.message,
      });
    }
  }

  if (logger && typeof logger.info === "function") {
    logger.info("Runtime budget guard exiting process", fields);
  } else if (logger && typeof logger.infoWithContext === "function") {
    logger.infoWithContext("Runtime budget guard exiting process", fields);
  }

  const finish = () => {
    process.exit(0);
  };

  if (server && typeof server.close === "function") {
    try {
      server.close(() => finish());
      // Hard cap close wait so exit always happens.
      setTimeout(finish, 5000).unref?.();
      return;
    } catch (_) {
      // fall through
    }
  }
  finish();
}

/**
 * Arm a single wall-clock timer that exits 0 when MAX_CONTAINER_LIFETIME_SECONDS elapses.
 * @returns {{ deadlineMs: number, maxLifetimeSeconds: number, timer: NodeJS.Timeout|null }}
 */
function armLifetimeExit(logger, config, server, options = {}) {
  if (armedTimer) {
    return {
      deadlineMs: getDeadlineMs(config),
      maxLifetimeSeconds: getMaxLifetimeSeconds(config),
      timer: armedTimer,
      alreadyArmed: true,
    };
  }

  const maxLifetimeSeconds = getMaxLifetimeSeconds(config);
  const deadlineMs = getDeadlineMs(config);
  const delayMs = Math.max(0, deadlineMs - Date.now());
  const reasonCode = options.reasonCode || "MAX_CONTAINER_LIFETIME_REACHED";

  if (logger && typeof logger.info === "function") {
    logger.info(
      "Armed container lifetime exit timer",
      budgetLogFields(config, {
        reasonCode,
        delayMs,
        deadlineIso: new Date(deadlineMs).toISOString(),
      }),
    );
  }

  armedTimer = setTimeout(() => {
    gracefulExit(logger, config, server, reasonCode, {
      trigger: "lifetime-timer",
    });
  }, delayMs);
  if (typeof armedTimer.unref === "function") {
    // Keep process alive for the timer — do NOT unref; lifetime must fire.
  }

  return {
    deadlineMs,
    maxLifetimeSeconds,
    timer: armedTimer,
    alreadyArmed: false,
  };
}

function clearLifetimeExit() {
  if (armedTimer) {
    clearTimeout(armedTimer);
    armedTimer = null;
  }
}

module.exports = {
  RuntimeBudgetExceededError,
  getProcessStartMs,
  getMaxLifetimeSeconds,
  getMaxRestartAttempts,
  getMarkerPath,
  getDeployId,
  getDeadlineMs,
  remainingMs,
  isExpired,
  uptimeMs,
  budgetLogFields,
  assertWithinBudget,
  readExhaustionMarker,
  writeExhaustionMarker,
  armLifetimeExit,
  clearLifetimeExit,
  gracefulExit,
};
