/**
 * Deployment runner for sdk/test/session-lifetime*.test.js (in-process SDK; no live API).
 * Wired via ENABLED_TEST_SUITES sessionLifetime in test-system.js.
 */

"use strict";

const { execFileSync } = require("child_process");
const path = require("path");

const SDK_ROOT = path.join(__dirname, "../../sdk");
const SDK_TEST_DIR = path.join(SDK_ROOT, "test");

const SESSION_LIFETIME_SCRIPTS = [
  {
    file: "session-lifetime.test.js",
    testName: "testSessionLifetimeUnit",
  },
  {
    file: "session-lifetime-validation.test.js",
    testName: "testSessionLifetimeValidation",
  },
  {
    file: "session-lifetime-http.test.js",
    testName: "testSessionLifetimeHttp",
  },
];

function sessionLifetimeEnv() {
  return {
    ...process.env,
    NODE_CONFIG_ENV: process.env.NODE_CONFIG_ENV || "development",
    NODE_ENV: process.env.NODE_ENV || "development",
    SESSION_VALIDATION_CACHE_TTL: "0",
    SECURITY_OPTIONS_THRESHOLD_VALIDATION_TYPE:
      process.env.SECURITY_OPTIONS_THRESHOLD_VALIDATION_TYPE || "0",
    SECURITY_OPTIONS_SESSION_SECRET:
      process.env.SECURITY_OPTIONS_SESSION_SECRET ||
      "deployment-session-lifetime-test-secret",
  };
}

function runSessionLifetimeScript(fileName) {
  const testPath = path.join(SDK_TEST_DIR, fileName);
  try {
    const stdout = execFileSync(process.execPath, [testPath], {
      cwd: SDK_ROOT,
      env: sessionLifetimeEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return {
      passed: true,
      message: `${fileName} completed`,
      testData: { fileName, stdout: stdout.slice(-2000) },
    };
  } catch (err) {
    const stderr = err.stderr?.toString?.() || err.stderr || "";
    const stdout = err.stdout?.toString?.() || err.stdout || "";
    return {
      passed: false,
      error: `${fileName} exited with code ${err.status ?? "unknown"}: ${
        stderr || stdout || err.message
      }`,
      testData: {
        fileName,
        exitCode: err.status,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
      },
    };
  }
}

const sessionLifetimeTests = {};

for (const { file, testName } of SESSION_LIFETIME_SCRIPTS) {
  sessionLifetimeTests[testName] = async () => runSessionLifetimeScript(file);
}

module.exports = sessionLifetimeTests;
