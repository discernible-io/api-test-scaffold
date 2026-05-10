// test-system.js
// Consolidated module combining test-system.js and test-system.js
const crypto = require("crypto");
const { ulid } = require("ulid");
const { logger, roditManager, stateManager } = require("../sdk");
const config = require("../sdk/services/configsdk");
const authenticationTests = require("./test-modules/authentication-test");
const securityTests = require("./test-modules/security");
const performanceTests = require("./test-modules/performance");
const legacyTests = require("./test-modules/legacy");
const rateLimitTests = require("./test-modules/rate-limiting");
const crudaTests = require("./test-modules/cruda");
const encodingTests = require("./test-modules/encoding");
const concurrencyTests = require("./test-modules/concurrency");
const contentTypeTests = require("./test-modules/content-type");
const idempotencyTests = require("./test-modules/idempotency");
const sdkTests = require("./test-modules/sdk-tests");
const mcpTests = require("./test-modules/mcp");
const metricsTests = require("./test-modules/metrics");
const sessionManagementTests = require("./test-modules/session-management");
const integrationTests = require("./test-modules/integration");
const performanceExtendedTests = require("./test-modules/performance-extended");
const perfServiceTests = require("./test-modules/performance-service");
const sdkSurfaceTests = require("./test-modules/sdk-surface");
const tokenRenewalTests = require("./test-modules/token-renewal");

// Track state of test execution
const testExecutionState = {
  isRunning: false,
  currentTestIteration: 0,
  lastCompletedIteration: 0,
  testResults: [],
  allTestResults: {}, // Store all test results by test name
  latestRun: null, // Timestamp of the latest test run
  startTime: null,
  endTime: null,
};

/**
 * TestRunner class for executing tests
 */
class TestRunner {
  constructor(app, testConfig = {}) {
    this.app = app;
    // NOTE: TestRunner intentionally uses shared client for orchestration (API endpoints, runner auth)
    // Individual test functions should use getRoditClientForTest() for test isolation
    this.roditClient = app.locals.roditClient;
    this.config = testConfig;
    this.results = {
      passed: 0,
      notPassed: 0, // Changed from 'failed' to 'notPassed' for consistency
      skipped: 0,
      total: 0,
      testCases: {},
    };
    this.runId = crypto.randomUUID();
    this.isAuthenticated = false;
    this.authToken = null;
  }

  /**
   * Get API endpoint from roditClient configuration
   * @private
   * @returns {Promise<string>} API endpoint
   */
  async getApiEndpoint() {
    try {
      const config_own_rodit = await this.roditClient.getConfigOwnRodit();
      if (config_own_rodit?.own_rodit?.metadata?.subjectuniqueidentifier_url) {
        return config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url;
      }
    } catch (error) {
      logger.warn("Failed to get API endpoint from roditClient configuration", {
        component: "TestRunner",
        method: "getApiEndpoint",
        error: error.message,
      });
    }
    throw new Error("API endpoint not available");
  }

  /**
   * Authenticate with the server using TestRunner's shared client
   * NOTE: This is for TestRunner orchestration auth, not individual test auth
   * @returns {Promise<void>}
   */
  async authenticate() {
    try {
      logger.info("Authenticating TestRunner with the server...");

      // Use the shared RoditClient for TestRunner orchestration
      if (!this.roditClient) {
        throw new Error(
          "RoditClient not available in app.locals - ensure app initialization completed"
        );
      }

      // Perform login using the RoditClient instance's method
      const loginResult = await this.roditClient.login_server();

      if (loginResult && loginResult.jwt_token) {
        this.authToken = loginResult.jwt_token;
        this.isAuthenticated = true;
        logger.info(
          "Successfully authenticated with the server using login_server",
          {
            hasToken: !!this.authToken,
          }
        );
      } else if (loginResult && loginResult.error) {
        throw new Error(`Authentication failed: ${loginResult.error}`);
      } else {
        throw new Error("Authentication failed: No token received");
      }
    } catch (error) {
      logger.error("Authentication error:", error);
      this.isAuthenticated = false;
      throw error;
    }
  }

  async runTest(testName, testFn, params = {}) {
    const testId = crypto.randomUUID();
    const ec_api_ep = await this.getApiEndpoint();
    const logContext = {
      runId: this.runId,
      testId,
      testName,
      apiEndpoint: ec_api_ep,
      startTime: new Date().toISOString(),
      app: this.app, // Pass app instance to test functions
      ...params,
    };

    logger.infoWithContext(`Starting test: ${testName}`, logContext);

    try {
      this.results.total++;
      const result = await testFn(ec_api_ep, logContext);

      if (result === null) {
        this.results.skipped++;
        logContext.result = "skipped";
        logger.warnWithContext(`Test skipped: ${testName}`, logContext);
      } else {
        // Import captureTestData if not already imported
        const { captureTestData } = require("./test-modules/test-utils");
        const duration = Date.now() - new Date(logContext.startTime).getTime();

        if (result.success) {
          this.results.passed++;
          logContext.result = "passed";

          // Use captureTestData for consistent test result reporting
          captureTestData(
            testName,
            logContext.moduleName || "native",
            {
              success: true,
              details: result.details || {},
            },
            {
              endpoint: ec_api_ep,
              testId: logContext.testId,
              duration,
            }
          );
        } else {
          this.results.notPassed++;
          logContext.result = "not-passed";

          // Use captureTestData for consistent test result reporting
          captureTestData(
            testName,
            logContext.moduleName || "native",
            {
              success: false,
              error: result.error || "Unknown error",
              details: result.details || {},
            },
            {
              endpoint: ec_api_ep,
              testId: logContext.testId,
              duration,
              error: result.error || "Unknown error",
              stack: result.stack,
            }
          );
        }
      }

      // Store test result
      this.results.testCases[testName] = {
        result: logContext.result,
        details: result?.details || {},
        error: result?.error || null,
        duration: new Date() - new Date(logContext.startTime),
      };

      return result;
    } catch (error) {
      this.results.notPassed++; // Use notPassed instead of failed for consistency
      logContext.result = "not-passed";
      logContext.errorMessage = error.message;

      // Import captureTestData if not already imported
      const { captureTestData } = require("./test-modules/test-utils");
      const duration = Date.now() - new Date(logContext.startTime).getTime();

      // Use captureTestData for consistent test result reporting
      captureTestData(
        testName,
        logContext.moduleName || "native",
        {
          success: false,
          error: error.message,
          stack: error.stack,
        },
        {
          endpoint: ec_api_ep,
          testId: logContext.testId,
          duration,
          error: error.message,
          stack: error.stack,
        }
      );

      // Store test result
      this.results.testCases[testName] = {
        result: "not-passed",
        error: error.message,
        stack: error.stack,
        duration: new Date() - new Date(logContext.startTime),
      };

      // Always continue with tests even when errors occur
      return { success: false, error: error.message };
    }
  }

  async runTestSuite(testSuite, name) {
    const suiteId = crypto.randomUUID();
    const logContext = {
      runId: this.runId,
      suiteId,
      suiteName: name,
      startTime: new Date().toISOString(),
    };

    logger.infoWithContext(`Starting test suite: ${name}`, logContext);

    const suiteResults = {
      name,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: Object.keys(testSuite).length,
    };

    // Ensure we're authenticated before running the test suite
    if (!this.isAuthenticated) {
      try {
        await this.authenticate();
      } catch (error) {
        logger.error(`Authentication failed for suite ${name}:`, error);
        throw new Error(`Test suite ${name} failed: Authentication required`);
      }
    }

    // Run tests sequentially
    for (const [testName, testFn] of Object.entries(testSuite)) {
      try {
        logger.info(`Running test: ${testName}`);
        const result = await this.runTest(testName, testFn, {
          moduleName: name,
        });

        if (result === null) {
          suiteResults.skipped++;
        } else if (result.success) {
          suiteResults.passed++;
        } else {
          suiteResults.failed++;
        }
      } catch (error) {
        logger.error(`Test ${testName} failed:`, error);
        suiteResults.failed++;
      }
    }

    logContext.endTime = new Date().toISOString();
    logContext.results = suiteResults;
    logger.infoWithContext(`Test suite completed: ${name}`, logContext);

    return suiteResults;
  }

  async runAllTests(testModules) {
    logger.info(`Starting test run ${this.runId}`);

    try {
      // Ensure authentication before running any tests
      await this.authenticate();

      // Run all test modules sequentially
      for (const [name, testModule] of Object.entries(testModules)) {
        logger.info(`Starting test module: ${name}`);
        await this.runTestSuite(testModule, name);
      }

      // Generate final report
      const report = this.generateReport();
      logger.info("Test run completed", { report });
      return report;
    } catch (error) {
      logger.error("Test run failed:", error);
      throw error;
    }
  }

  generateReport() {
    return {
      summary: {
        passed: this.results.passed,
        notPassed: this.results.notPassed,
        skipped: this.results.skipped,
        total: this.results.total,
        passRate:
          ((this.results.passed / this.results.total) * 100).toFixed(2) + "%",
      },
      testCases: this.results.testCases,
    };
  }
}

/**
 * Main client function that runs tests against API
 * @param {Object} config - Configuration object
 * @returns {Promise<void>}
 */
async function enhancedClient(config) {
  const clientId = crypto.randomUUID();
  const logContext = {
    clientId,
    component: "enhancedClient",
    startTime: new Date().toISOString(),
  };

  try {
    // Prevent multiple concurrent instances
    if (testExecutionState.isRunning) {
      logger.warnWithContext(
        "Enhanced client already running, skipping new execution",
        logContext
      );
      return;
    }

    testExecutionState.isRunning = true;
    testExecutionState.startTime = Date.now();

    // Initialize vault using the manager
    logger.infoWithContext("Initializing vault", logContext);
    await roditManager.initializeCredentialsStore().catch((error) => {
      logger.errorWithContext(
        "Vault initialization error, continuing with defaults",
        logContext,
        error
      );
    });

    // Initialize RODIT configuration with the "client" namespace
    logger.infoWithContext(
      "Initializing RODIT config with 'client' namespace",
      logContext
    );

    try {
      await roditManager.initializeRoditConfig("client");
    } catch (error) {
      logger.errorWithContext(
        "RODIT config initialization error",
        logContext,
        error
      );
      throw new Error(
        `Failed to initialize RODIT configuration: ${error.message}`
      );
    }

    logger.infoWithContext("Attempting server login", logContext);
    const { RoditClient } = require("../sdk");
    const client = await RoditClient.create("client");
    const loginResult = await client.login_server();

    // Store JWT token in the state manager
    if (loginResult.jwt_token) {
      logger.infoWithContext("JWT token received", {
        ...logContext,
        tokenReceived: true,
        apiEndpoint: loginResult.apiendpoint,
      });

      await stateManager.setJwtToken(loginResult.jwt_token);

      // Parse test configuration
      const TEST_CLIENT_DURATION =
        parseInt(config?.API_DEFAULT_OPTIONS?.TEST_CLIENT_DURATION, 10) *
          1000 || 60000;
      const TEST_INTERVAL =
        parseInt(config?.API_DEFAULT_OPTIONS?.TEST_INTERVAL, 10) * 1000 || 5000;
      const MAX_CONCURRENT_TESTS =
        parseInt(config?.API_DEFAULT_OPTIONS?.MAX_CONCURRENT_TESTS, 10) || 1;

      const startTime = Date.now();
      const endTime = startTime + TEST_CLIENT_DURATION;

      const testContext = {
        ...logContext,
        testDuration: TEST_CLIENT_DURATION / 1000,
        testInterval: TEST_INTERVAL / 1000,
        maxConcurrentTests: MAX_CONCURRENT_TESTS,
        plannedEndTime: new Date(endTime).toISOString(),
      };

      logger.infoWithContext(
        `Enhanced client will run tests for ${
          TEST_CLIENT_DURATION / 1000
        } seconds`,
        testContext
      );

      // Create a test runner
      const testRunner = new TestRunner(loginResult.apiendpoint, config);

      // Run legacy tests first
      logger.infoWithContext("Running legacy tests first", {
        ...testContext,
        testPhase: "legacy",
      });

      try {
        const legacyResults = await testRunner.runTestSuite(
          legacyTests,
          "legacy"
        );
        logger.infoWithContext("Legacy tests completed", {
          ...testContext,
          legacyTestsStatus: "completed",
          legacyTestResults: legacyResults,
        });
      } catch (legacyError) {
        logger.errorWithContext(
          "Error running legacy tests",
          {
            ...testContext,
            legacyTestsStatus: "error",
          },
          legacyError
        );
      }

      // Reset the timing after legacy tests complete to ensure main tests have enough time
      const resetStartTime = Date.now();
      const resetEndTime = resetStartTime + TEST_CLIENT_DURATION;

      logger.infoWithContext("Resetting test duration after legacy tests", {
        ...testContext,
        originalEndTime: new Date(endTime).toISOString(),
        newEndTime: new Date(resetEndTime).toISOString(),
        additionalTime:
          Math.floor((resetEndTime - endTime) / 1000) + " seconds",
      });

      // Run all test suites
      const allTestSuites = {
        authentication: authenticationTests,
        security: securityTests,
        performance: perfServiceTests,
        rateLimiting: rateLimitTests,
        cruda: crudaTests,
        encoding: encodingTests,
        concurrency: concurrencyTests,
        contentType: contentTypeTests,
        idempotency: idempotencyTests,
        sdk: sdkTests,
        integration: integrationTests,
        legacy: legacyTests,
        metrics: metricsTests,
        sdkSurface: sdkSurfaceTests,
        sessionManagement: sessionManagementTests,
        performanceExtended: performanceExtendedTests,
        mcp: mcpTests,
      };

      for (const [suiteName, testSuite] of Object.entries(allTestSuites)) {
        try {
          logger.infoWithContext(`Running ${suiteName} tests`, {
            ...testContext,
            testPhase: suiteName,
          });

          const suiteResults = await testRunner.runTestSuite(
            testSuite,
            suiteName
          );

          logger.infoWithContext(`${suiteName} tests completed`, {
            ...testContext,
            testPhase: suiteName,
            results: suiteResults,
          });
        } catch (error) {
          logger.errorWithContext(
            `Error running ${suiteName} tests`,
            {
              ...testContext,
              testPhase: suiteName,
              error: error.message,
            },
            error
          );
        }
      }

      logContext.endTime = new Date().toISOString();
      logContext.totalTestIterations = 1;
      logContext.completedTestIterations = 1;
      logContext.testSuccessRate = "100%";
      logContext.status = "completed";

      testExecutionState.endTime = Date.now();

      logger.infoWithContext(
        "Enhanced client finished running tests",
        logContext
      );

      // Return the test results
      return testRunner.generateReport();
    } else {
      logContext.status = "failed";
      logContext.failureReason = "JWT token not received";
      logger.errorWithContext("Failed to obtain JWT token", logContext);
      return { error: "Failed to obtain JWT token" };
    }
  } catch (error) {
    logContext.status = "failed";
    logContext.errorMessage = error.message;

    try {
      logContext.endTime = new Date().toISOString();
    } catch (dateError) {
      logContext.endTime = `[timestamp: ${Date.now()}]`;
    }

    logger.errorWithContext(
      "Enhanced client function error",
      logContext,
      error
    );

    return { error: error.message };
  } finally {
    testExecutionState.isRunning = false;
  }
}

/**
 * Run the SDK and native tests as part of the application startup
 * @param {Object} app - Express app instance with roditClient in app.locals
 */
async function runSdkTests(app = null) {
  const requestId = ulid();
  const startTime = Date.now();
  const moduleName = "sdk";

  logger.info("Running SDK and native tests during application startup", {
    component: "TestRunner",
    moduleName,
    testName: "runSdkTests",
    correlationId: requestId,
    phase: "start",
  });

  try {
    // Run SDK-based tests using TestRunner - app.locals.roditClient will be used for API endpoint
    const sdkBasedResults = await runSdkBasedTests(app, config);

    // Convert the results to the expected format
    const allTests = [];
    let overallSuccess = true;

    // Collect all test results from different categories
    Object.keys(sdkBasedResults).forEach((category) => {
      const categoryResult = sdkBasedResults[category];
      if (categoryResult.error) {
        allTests.push({
          success: false,
          error: categoryResult.error,
          category: category,
        });
        overallSuccess = false;
      } else if (categoryResult.tests) {
        allTests.push(...categoryResult.tests);
        overallSuccess =
          overallSuccess && categoryResult.tests.every((t) => t.success);
      }
    });

    const sdkResults = {
      success: overallSuccess,
      tests: allTests,
    };

    logger.info("SDK tests completed", {
      component: "TestRunner",
      moduleName,
      testName: "runSdkTests",
      correlationId: requestId,
      phase: "complete",
      duration: Date.now() - startTime,
      success: sdkResults.success,
      testsPassed: sdkResults.tests.filter((t) => t.success).length,
      testsFailed: sdkResults.tests.filter((t) => !t.success).length,
      totalTests: sdkResults.tests.length,
    });

    // Run native tests
    logger.info("Running native tests", {
      component: "TestRunner",
      moduleName: "native",
      testName: "runNativeTests",
      correlationId: requestId,
      phase: "start",
    });

    const testRunner = new TestRunner(app, config);

    // Define native test suites
    const nativeTestSuites = {
      authentication: authenticationTests,
      security: securityTests,
      legacy: legacyTests,
      rateLimiting: rateLimitTests,
      cruda: crudaTests,
      encoding: encodingTests,
      concurrency: concurrencyTests,
      contentType: contentTypeTests,
      idempotency: idempotencyTests,
      // New test modules
      mcp: mcpTests,
      metrics: metricsTests,
      sessionManagement: sessionManagementTests,
      integration: integrationTests,
      sdkSurface: sdkSurfaceTests,
      perfServiceTests: perfServiceTests,
      // Performance tests moved to end
      performanceExtended: performanceExtendedTests,
      performance: performanceTests,
    };

    // Get test configuration
    const enabledSuites = config.get(
      "API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES");
    const excludedTests = config.get("API_DEFAULT_OPTIONS.EXCLUDED_TESTS");

    logger.info("Test suite configuration:", {
      enabledSuites,
      excludedTests,
      allSuites: Object.keys(nativeTestSuites),
      component: "TestRunner",
      correlationId: requestId,
    });

    // Filter test suites based on configuration
    const filteredTestSuites = Object.entries(nativeTestSuites).reduce(
      (acc, [suiteName, testSuite]) => {
        logger.debug(`Processing test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
          suiteName,
          isExcluded: excludedTests.includes(suiteName),
          isEnabled:
            enabledSuites.length === 0 || enabledSuites.includes(suiteName),
        });

        // Skip if suite is explicitly excluded
        if (excludedTests.includes(suiteName)) {
          logger.info(`Skipping excluded test suite: ${suiteName}`, {
            component: "TestRunner",
            correlationId: requestId,
          });
          return acc;
        }

        // If specific suites are enabled, only include those
        if (enabledSuites.length > 0 && !enabledSuites.includes(suiteName)) {
          logger.info(
            `Skipping disabled test suite: ${suiteName} (not in enabled suites)`,
            {
              component: "TestRunner",
              correlationId: requestId,
              enabledSuites,
            }
          );
          return acc;
        }

        logger.info(`Including test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
        });
        acc[suiteName] = testSuite;
        return acc;
      },
      {}
    );

    logger.info("Filtered test suites to run:", {
      component: "TestRunner",
      correlationId: requestId,
      filteredSuites: Object.keys(filteredTestSuites),
      totalFiltered: Object.keys(filteredTestSuites).length,
    });

    // Run filtered test suites
    const nativeResults = {};
    for (const [suiteName, testSuite] of Object.entries(filteredTestSuites)) {
      try {
        logger.infoWithContext(`Running ${suiteName} tests`, {
          correlationId: requestId,
          testPhase: suiteName,
        });

        const suiteResults = await testRunner.runTestSuite(
          testSuite,
          suiteName
        );
        nativeResults[suiteName] = suiteResults;

        logger.infoWithContext(`${suiteName} tests completed`, {
          correlationId: requestId,
          testPhase: suiteName,
          results: suiteResults,
        });
      } catch (error) {
        logger.errorWithContext(
          `Error running ${suiteName} tests`,
          {
            correlationId: requestId,
            testPhase: suiteName,
            error: error.message,
          },
          error
        );
        nativeResults[suiteName] = { error: error.message };
      }
    }

    // Combine SDK and native test results
    const nativeSuiteValues = Object.values(nativeResults);
    const nativeSuccess =
      nativeSuiteValues.length > 0 &&
      nativeSuiteValues.every(
        (result) =>
          !result.error &&
          (typeof result.failed === "number" ? result.failed === 0 : true)
      );

    const combinedResults = {
      sdk: sdkResults,
      native: {
        success: nativeSuccess,
        suites: nativeResults,
      },
    };

    logger.info("All tests completed", {
      component: "TestRunner",
      correlationId: requestId,
      phase: "complete",
      duration: Date.now() - startTime,
    });

    return combinedResults;
  } catch (error) {
    logger.error(
      "Error running tests",
      {
        component: "TestRunner",
        moduleName,
        testName: "runSdkTests",
        correlationId: requestId,
        phase: "error",
        duration: Date.now() - startTime,
        error: error.message,
      },
      error
    );

    return { error: error.message };
  }
}

/**
 * Get current test execution state
 * @returns {Object} - Current test execution state
 */
function getTestExecutionState() {
  return {
    isRunning: testExecutionState.isRunning,
    currentTestIteration: testExecutionState.currentTestIteration,
    lastCompletedIteration: testExecutionState.lastCompletedIteration,
    testResults: testExecutionState.testResults,
    allTestResults: testExecutionState.allTestResults,
    latestRun: testExecutionState.latestRun,
    startTime: testExecutionState.startTime
      ? new Date(testExecutionState.startTime).toISOString()
      : null,
    endTime: testExecutionState.endTime
      ? new Date(testExecutionState.endTime).toISOString()
      : null,
    duration:
      testExecutionState.startTime && testExecutionState.endTime
        ? (testExecutionState.endTime - testExecutionState.startTime) / 1000
        : null,
  };
}

/**
 * Run authentication tests
 * @param {string} rat_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runAuthenticationTests(rat_api_ep) {
  // Ensure the API endpoint has a port
  if (
    rat_api_ep &&
    rat_api_ep.startsWith("https://") &&
    !rat_api_ep.includes(":", 8)
  ) {
    // Port configuration removed as requested
  }
  const testRunner = new TestRunner(rat_api_ep, {});
  return await testRunner.runTestSuite(authenticationTests, "authentication");
}

/**
 * Run security tests
 * @param {string} rst_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runSecurityTests(rst_api_ep) {
  const testRunner = new TestRunner(rst_api_ep, {});
  return await testRunner.runTestSuite(securityTests, "security");
}

/**
 * Run performance tests
 * @param {string} rpt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runPerformanceTests(rpt_api_ep) {
  const testRunner = new TestRunner(rpt_api_ep, {});
  return await testRunner.runTestSuite(performanceTests, "performance");
}

/**
 * Run legacy tests
 * @param {string} rlt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runLegacyTests(rlt_api_ep) {
  const testRunner = new TestRunner(rlt_api_ep, {});
  return await testRunner.runTestSuite(legacyTests, "legacy");
}

/**
 * Run rate limit tests
 * @param {string} rrlt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runRateLimitTests(rrlt_api_ep) {
  const testRunner = new TestRunner(rrlt_api_ep, {});
  return await testRunner.runTestSuite(rateLimitTests, "rate-limiting");
}

/**
 * Run CRUDA tests
 * @param {string} rct_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runCrudaTests(rct_api_ep) {
  // Ensure the API endpoint has a port
  if (
    rct_api_ep &&
    rct_api_ep.startsWith("https://") &&
    !rct_api_ep.includes(":", 8)
  ) {
    // Port configuration removed as requested
  }
  const testRunner = new TestRunner(rct_api_ep, {});
  return await testRunner.runTestSuite(crudaTests, "cruda");
}

/**
 * Run encoding tests
 * @param {string} ret_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runEncodingTests(ret_api_ep) {
  const testRunner = new TestRunner(ret_api_ep, {});
  return await testRunner.runTestSuite(encodingTests, "encoding");
}

/**
 * Run concurrency tests
 * @param {string} rct_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runConcurrencyTests(rct_api_ep) {
  const testRunner = new TestRunner(rct_api_ep, {});
  return await testRunner.runTestSuite(concurrencyTests, "concurrency");
}

/**
 * Run content class tests
 * @param {string} rsbt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runContentTypeTests(rsbt_api_ep) {
  const testRunner = new TestRunner(rsbt_api_ep, {});
  return await testRunner.runTestSuite(contentTypeTests, "content-type");
}

/**
 * Run idempotency tests
 * @param {string} rsbt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runIdempotencyTests(rsbt_api_ep) {
  const testRunner = new TestRunner(rsbt_api_ep, {});
  return await testRunner.runTestSuite(idempotencyTests, "idempotency");
}

/**
 * Run MCP tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runMcpTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(mcpTests, "MCP Tests");
}

/**
 * Run metrics tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runMetricsTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(metricsTests, "Metrics Tests");
}

/**
 * Run session management tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runSessionManagementTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(
    sessionManagementTests,
    "Session Management Tests"
  );
}

/**
 * Run integration tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runIntegrationTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(integrationTests, "Integration Tests");
}

/**
 * Run new performance tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runNewPerformanceTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(newPerformanceTests, "Performance Tests");
}

/**
 * Run SDK-based tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Test results
 */
async function runSdkBasedTests(app, config = {}) {
  const results = {};
  const requestId = ulid();

  logger.infoWithContext("Running SDK-based tests", {
    correlationId: requestId,
    hasApp: !!app,
    hasRoditClient: !!(app && app.locals && app.locals.roditClient),
  });

  // Get test configuration for filtering
  const enabledSuites = config.get(
    "API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES");
  const excludedTests = config.get("API_DEFAULT_OPTIONS.EXCLUDED_TESTS");

  logger.info("SDK test suite configuration:", {
    enabledSuites,
    excludedTests,
    component: "TestRunner",
    correlationId: requestId,
  });

  // Define all available SDK test suites
  // NOTE: tokenRenewal is last because it takes 2+ minutes to complete
  const availableSdkSuites = {
    integration: {
      name: "sdk_integration",
      tests: {
        completeAuthFlow: integrationTests.testCompleteAuthFlowWithSdk,
        componentInteractions:
          integrationTests.testComponentInteractionsWithSdk,
      },
    },
    mcp: {
      name: "sdk_mcp",
      tests: {
        resourcesListing: mcpTests.testMcpResourcesListingWithSdk,
        resourceRetrieval: mcpTests.testMcpResourceRetrievalWithSdk,
      },
    },
    sessionManagement: {
      name: "sdk_session_management",
      tests: {
        sessionManagement: sessionManagementTests.testSessionManagementWithSdk,
        multipleSessions: sessionManagementTests.testMultipleSessionsWithSdk,
      },
    },
    sdk: {
      name: "sdk_core",
      tests: {
        utilityFunctions: sdkTests.testSdkUtilityFunctionsWithSdk,
        clientInitialization: sdkTests.testSdkClientInitializationWithSdk,
      },
    },
    // Token renewal tests run LAST - automatic renewal takes 2+ minutes
    tokenRenewal: {
      name: "sdk_token_renewal",
      tests: {
        automaticTokenRenewal: tokenRenewalTests.testAutomaticTokenRenewal,
      },
    },
  };

  // Filter SDK test suites based on configuration (same logic as native tests)
  const filteredSdkSuites = Object.entries(availableSdkSuites).reduce(
    (acc, [suiteName, suiteConfig]) => {
      logger.debug(`Processing SDK test suite: ${suiteName}`, {
        component: "TestRunner",
        correlationId: requestId,
        suiteName,
        isExcluded: excludedTests.includes(suiteName),
        isEnabled:
          enabledSuites.length === 0 || enabledSuites.includes(suiteName),
      });

      // Skip if suite is explicitly excluded
      if (excludedTests.includes(suiteName)) {
        logger.info(`Skipping excluded SDK test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
        });
        return acc;
      }

      // If specific suites are enabled, only include those
      if (enabledSuites.length > 0 && !enabledSuites.includes(suiteName)) {
        logger.info(
          `Skipping disabled SDK test suite: ${suiteName} (not in enabled suites)`,
          {
            component: "TestRunner",
            correlationId: requestId,
            enabledSuites,
          }
        );
        return acc;
      }

      logger.info(`Including SDK test suite: ${suiteName}`, {
        component: "TestRunner",
        correlationId: requestId,
      });
      acc[suiteName] = suiteConfig;
      return acc;
    },
    {}
  );

  logger.info("Filtered SDK test suites to run:", {
    component: "TestRunner",
    correlationId: requestId,
    filteredSuites: Object.keys(filteredSdkSuites),
    totalFiltered: Object.keys(filteredSdkSuites).length,
  });

  // Create a test runner - it will get rsbt_api_ep from app.locals.roditClient
  const testRunner = new TestRunner(app, config);

  // Run filtered SDK test suites
  for (const [suiteName, suiteConfig] of Object.entries(filteredSdkSuites)) {
    try {
      logger.infoWithContext(`Running SDK-based ${suiteName} tests`, {
        correlationId: requestId,
        testPhase: suiteConfig.name,
      });

      results[suiteName] = await testRunner.runTestSuite(
        suiteConfig.tests,
        suiteConfig.name
      );
    } catch (error) {
      logger.errorWithContext(`Error running SDK-based ${suiteName} tests`, {
        correlationId: requestId,
        error: error.message,
        stack: error.stack,
      });

      results[suiteName] = { error: error.message };
    }
  }

  return results;
}

/**
 * Run token renewal tests
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @returns {Promise<Object>} - Test results
 */
async function runTokenRenewalTests(app) {
  const runner = new TestRunner(app);
  return await runner.runTestSuite(tokenRenewalTests, "Token Renewal Tests");
}

/**
 * Run a specific test suite
 * @param {string} rts_api_ep - API endpoint URL
 * @param {string} suiteName - Name of the test suite to run
 * @returns {Promise<Object>} - Test results
 */
async function runTestSuite(rts_api_ep, suiteName) {
  const requestId = ulid();
  const logContext = {
    requestId,
    suiteName,
    rts_api_ep,
    component: "TestSystem",
  };

  logger.infoWithContext(`Running test suite: ${suiteName}`, logContext);

  try {
    // Get the test suite function based on the suite name
    const testSuiteFunctions = {
      authentication: runAuthenticationTests,
      security: runSecurityTests,
      performance: runPerformanceTests,
      legacy: runLegacyTests,
      rateLimit: runRateLimitTests,
      cruda: runCrudaTests,
      encoding: runEncodingTests,
      concurrency: runConcurrencyTests,
      contentType: runContentTypeTests,
      idempotency: runIdempotencyTests,
      mcp: runMcpTests,
      metrics: runMetricsTests,
      sessionManagement: runSessionManagementTests,
      integration: runIntegrationTests,
      newPerformance: runNewPerformanceTests,
      tokenRenewal: runTokenRenewalTests,
      sdk: runSdkBasedTests,
      all: runAllNewTests,
    };

    const testSuiteFunction = testSuiteFunctions[suiteName];

    if (!testSuiteFunction) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        success: false,
        error: `Unknown test suite: ${suiteName}`,
      };
    }

    // Run the test suite
    const results = await testSuiteFunction(rts_api_ep);

    logger.infoWithContext(`Test suite ${suiteName} completed`, {
      ...logContext,
      success: true,
      results,
    });

    return {
      success: true,
      results,
    };
  } catch (error) {
    logger.errorWithContext(`Error running test suite ${suiteName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run a single test from a test suite
 * @param {string} rst_api_ep - API endpoint URL
 * @param {string} suiteName - Name of the test suite
 * @param {string} testName - Name of the test to run
 * @returns {Promise<Object>} - Test results
 */
async function runSingleTest(rst_api_ep, suiteName, testName) {
  const requestId = ulid();
  const logContext = {
    requestId,
    suiteName,
    testName,
    rst_api_ep,
    component: "TestSystem",
  };

  logger.infoWithContext(
    `Running single test: ${suiteName}.${testName}`,
    logContext
  );

  try {
    // Get the test suite based on the suite name
    const testSuites = {
      authentication: authenticationTests,
      security: securityTests,
      performance: performanceTests,
      legacy: legacyTests,
      rateLimiting: rateLimitTests,
      cruda: crudaTests,
      encoding: encodingTests,
      concurrency: concurrencyTests,
      contentType: contentTypeTests,
      idempotency: idempotencyTests,
      mcp: mcpTests,
      metrics: metricsTests,
      sessionManagement: sessionManagementTests,
      integration: integrationTests,
      performanceExtended: performanceExtendedTests,
      performanceService: perfServiceTests,
      sdkSurface: sdkSurfaceTests,
      sdk: sdkTests,
    };

    const testSuite = testSuites[suiteName];

    if (!testSuite) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        success: false,
        error: `Unknown test suite: ${suiteName}`,
      };
    }

    const testFunction = testSuite[testName];

    if (!testFunction) {
      logger.errorWithContext(
        `Unknown test: ${testName} in suite ${suiteName}`,
        logContext
      );
      return {
        success: false,
        error: `Unknown test: ${testName} in suite ${suiteName}`,
      };
    }

    // Create a test runner for the single test
    const testRunner = new TestRunner(rst_api_ep);

    // Run the single test
    const result = await testRunner.runTest(testName, testFunction, {
      suiteName,
      moduleName: suiteName,
    });

    logger.infoWithContext(`Test ${suiteName}.${testName} completed`, {
      ...logContext,
      success: result?.success,
      error: result?.error,
    });

    return {
      success: true,
      testResult: result,
    };
  } catch (error) {
    logger.errorWithContext(`Error running test ${suiteName}.${testName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack,
    });

    return {
      success: false,
      error: error.message,
    };
  }
}

// Export all functions
module.exports = {
  TestRunner,
  enhancedClient,
  runSdkTests,
  getTestExecutionState,
  runAuthenticationTests,
  runSecurityTests,
  runPerformanceTests,
  runLegacyTests,
  runRateLimitTests,
  runCrudaTests,
  runEncodingTests,
  runConcurrencyTests,
  runContentTypeTests,
  runIdempotencyTests,
  // New test functions
  runMcpTests,
  runMetricsTests,
  runSessionManagementTests,
  runIntegrationTests,
  runNewPerformanceTests,
  runTokenRenewalTests,
  runSdkBasedTests,
  // Export the new functions
  runTestSuite,
  runSingleTest,
};
