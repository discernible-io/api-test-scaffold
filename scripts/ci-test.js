#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SYNTAX_CHECK_FILES = [
  "src/app.js",
  "src/test-system.js",
  "sdk/index.js",
  "sdk/services/configsdk.js",
];

function syntaxCheck() {
  for (const relativePath of SYNTAX_CHECK_FILES) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Missing file for syntax check: ${relativePath}`);
    }
    execFileSync(process.execPath, ["--check", absolutePath], {
      stdio: "inherit",
    });
  }
  console.log("[ci-test] Syntax check passed");
}

function validateConfigMappings() {
  const mappingPath = path.join(ROOT, "config/custom-environment-variables.json");
  const mappings = JSON.parse(fs.readFileSync(mappingPath, "utf8"));

  const requiredSecurityKeys = [
    "WEBHOOK_TLS_SKIP_VERIFY",
    "BYPASS_WEBHOOK_VERIFICATION",
    "RELAXED_SESSION_VALIDATION",
  ];

  for (const key of requiredSecurityKeys) {
    if (!mappings.SECURITY_OPTIONS?.[key]) {
      throw new Error(`Missing SECURITY_OPTIONS mapping for ${key}`);
    }
  }

  if (mappings.TOKEN_VALIDATION_CACHE_TTL) {
    throw new Error(
      "Use SESSION_VALIDATION_CACHE_TTL in custom-environment-variables.json (TOKEN_VALIDATION_CACHE_TTL is obsolete)",
    );
  }

  if (!mappings.SESSION_VALIDATION_CACHE_TTL) {
    throw new Error("Missing SESSION_VALIDATION_CACHE_TTL mapping");
  }

  if (mappings.PERFORMANCE?.LOAD_THRESHOLDS?.CRITICAL !== "PERFORMANCE_LOAD_THRESHOLDS_CRITICAL") {
    throw new Error("PERFORMANCE.LOAD_THRESHOLDS.CRITICAL must map to PERFORMANCE_LOAD_THRESHOLDS_CRITICAL");
  }

  console.log("[ci-test] Config environment mappings validated");
}

function validateSdkConfig() {
  process.env.NODE_CONFIG_ENV = process.env.NODE_CONFIG_ENV || "development";
  process.env.NODE_ENV = process.env.NODE_ENV || "development";

  const config = require(path.join(ROOT, "sdk/services/configsdk"));
  const logger = {
    warn: () => {},
    warnWithContext: () => {},
    info: () => {},
    infoWithContext: () => {},
    error: () => {},
    errorWithContext: () => {},
    debug: () => {},
    debugWithContext: () => {},
  };

  config.validate(logger);
  console.log("[ci-test] SDK configuration validation passed");
}

function runPerfSloTests() {
  const testPath = path.join(ROOT, "sdk/test/perf-slo.test.js");
  if (!fs.existsSync(testPath)) {
    throw new Error(`Missing perf SLO test: ${testPath}`);
  }
  execFileSync(process.execPath, [testPath], {
    stdio: "inherit",
    cwd: path.join(ROOT, "sdk"),
  });
  console.log("[ci-test] Performance SLO helper tests passed");
}

function runSessionLifetimeTests() {
  const testDir = path.join(ROOT, "sdk/test");
  const testFiles = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith(".test.js"))
    .sort();

  if (testFiles.length === 0) {
    throw new Error(`No session lifetime tests found in ${testDir}`);
  }

  for (const testFile of testFiles) {
    const testPath = path.join(testDir, testFile);
    execFileSync(process.execPath, [testPath], {
      stdio: "inherit",
      cwd: path.join(ROOT, "sdk"),
      env: {
        ...process.env,
        NODE_CONFIG_ENV: process.env.NODE_CONFIG_ENV || "development",
        NODE_ENV: process.env.NODE_ENV || "development",
        SESSION_VALIDATION_CACHE_TTL: "0",
        SECURITY_OPTIONS_THRESHOLD_VALIDATION_TYPE: "0",
      },
    });
    console.log(`[ci-test] ${testFile} passed`);
  }

  console.log("[ci-test] Session lifetime tests passed");
}

function main() {
  syntaxCheck();
  validateConfigMappings();
  validateSdkConfig();
  runPerfSloTests();
  runSessionLifetimeTests();
}

main();
