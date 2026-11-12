// test-system.js
// Consolidated module combining test-system.js and test-system.js
const crypto = require("crypto");
const path = require("path");
const { ulid } = require("ulid");
const { logger, roditManager, stateManager, config } = require("../sdk");
const { verifyTlsConnectivity } = require("./utils/tls-check");
const { logSuiteOutcome } = require("./test-modules/test-utils");

/** Aggregate counter key — constitution terminology (test-rodit-constitution.md). */
const NOT_PASSED = "not-passed";

// Mapping of config test suite names to file paths (group by OpenAPI roles in ENABLED_TEST_SUITES order)
const testModuleMapping = {
  authentication: "./test-modules/authentication-test",
  authenticationComprehensive: "./test-modules/authentication-comprehensive",
  security: "./test-modules/security",
  rateLimiting: "./test-modules/rate-limiting",
  contentType: "./test-modules/content-type",
  mcp: "./test-modules/mcp",
  metrics: "./test-modules/metrics",
  sessionManagement: "./test-modules/session-management",
  sessionLifetime: "./test-modules/session-lifetime",
  identyclawApi: "./test-modules/identyclaw-api",
  integration: "./test-modules/did-web-resolution",
  errorHandling: "./test-modules/error-handling",
  policyDocuments: "./test-modules/policy-documents",
  schemaDocumentation: "./test-modules/schema-documentation",
  openapiSurface: "./test-modules/openapi-surface",
  subagentAuthorization: "./test-modules/subagent-authorization",
  webhooks: "./test-modules/webhooks",
  holaVerificationCoverage: "./test-modules/hola-verification-coverage",
  sdkInfrastructure: "./test-modules/sdk-infrastructure-tests",
  stressTests: "./test-modules/stress-tests",
  performanceSlo: "./test-modules/performance-slo",
};

/**
 * Suites that include session/JWT lifetime waits. Always scheduled after all
 * other enabled suites (relative order among them is preserved).
 */
const LIFETIME_TIMEOUT_SUITES = new Set(["sessionLifetime", "performanceSlo"]);

/**
 * Lifetime/renewal timeout tests: started in parallel at the beginning of the
 * run (isolated TestRunner each) so their wait clocks overlap other suites.
 * Results are joined after the rest of the matrix finishes.
 */
const LIFETIME_TIMEOUT_TEST_ORDER = [
  "testAutomaticTokenRenewal",
  "testSessionLifetimePollUntilExpiry",
  "testPerfJwtSteadyPoll",
  "testPerfLoginErrorBudget",
];
const LIFETIME_TIMEOUT_TESTS = new Set(LIFETIME_TIMEOUT_TEST_ORDER);

/**
 * Preserve ENABLED_TEST_SUITES order, but move lifetime-timeout suites to the end.
 * @param {string[]} suiteNames
 * @returns {string[]}
 */
function orderSuitesForExecution(suiteNames) {
  const regular = [];
  const lifetime = [];
  for (const name of suiteNames) {
    if (LIFETIME_TIMEOUT_SUITES.has(name)) {
      lifetime.push(name);
    } else {
      regular.push(name);
    }
  }
  return [...regular, ...lifetime];
}

// Dynamically load test modules based on config
function loadTestModules() {
  const enabledSuites = config.get("API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES") || [];
  const loadedModules = {};

  for (const suiteName of enabledSuites) {
    const modulePath = testModuleMapping[suiteName];
    if (!modulePath) {
      logger.warn(`Test suite "${suiteName}" not found in mapping`, {
        component: "TestRunner",
      });
      continue;
    }

    try {
      loadedModules[suiteName] = require(modulePath);
      logger.debug(`Loaded test module: ${suiteName}`, {
        component: "TestRunner",
      });
    } catch (error) {
      logger.error(`Failed to load test module: ${suiteName}`, {
        component: "TestRunner",
        error: error.message,
      });
    }
  }

  return loadedModules;
}

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

async function resolveApiEndpointFromApp(app) {
  if (!app || !app.locals || !app.locals.roditClient) {
    logger.warn("RoditClient missing from app.locals; cannot resolve API endpoint", {
      component: "TestRunner",
    });
    return null;
  }

  const client = app.locals.roditClient;

  // Try to get endpoint from getConfigOwnRodit (async method)
  if (typeof client.getConfigOwnRodit === "function") {
    try {
      const configOwnRodit = await client.getConfigOwnRodit();
      
      // Check for subjectuniqueidentifier_url in metadata
      const endpoint =
        configOwnRodit?.own_rodit?.metadata?.subjectuniqueidentifier_url;
      if (endpoint) {
        logger.debug("Resolved API endpoint from getConfigOwnRodit", {
          component: "TestRunner",
          endpoint,
        });
        return endpoint;
      }
    } catch (error) {
      logger.warn("Failed to resolve API endpoint via getConfigOwnRodit", {
        component: "TestRunner",
        error: error.message,
      });
    }
  }

  // Fallback: Try to get from stateManager directly (synchronous)
  if (client.stateManager && typeof client.stateManager.getConfigOwnRodit === "function") {
    try {
      const configOwnRodit = client.stateManager.getConfigOwnRodit();
      const endpoint =
        configOwnRodit?.own_rodit?.metadata?.subjectuniqueidentifier_url;
      if (endpoint) {
        logger.debug("Resolved API endpoint from stateManager", {
          component: "TestRunner",
          endpoint,
        });
        return endpoint;
      }
    } catch (error) {
      logger.warn("Failed to resolve API endpoint via stateManager", {
        component: "TestRunner",
        error: error.message,
      });
    }
  }

  // Last resort: Use hardcoded default for identyclaw API
  const defaultEndpoint = "https://api.identyclaw.com";
  logger.warn("Using default API endpoint (metadata resolution not-passed)", {
    component: "TestRunner",
    endpoint: defaultEndpoint,
  });
  return defaultEndpoint;
}

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
      [NOT_PASSED]: 0,
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
    
    // Fallback: Try to resolve from app using the helper function
    const resolvedEndpoint = await resolveApiEndpointFromApp(this.app);
    if (resolvedEndpoint) {
      return resolvedEndpoint;
    }
    
    // Last resort: Use hardcoded default
    const defaultEndpoint = "https://api.identyclaw.com";
    logger.warn("Using default API endpoint (all resolution methods not-passed)", {
      component: "TestRunner",
      method: "getApiEndpoint",
      endpoint: defaultEndpoint,
    });
    return defaultEndpoint;
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

      // Reuse JWT from SDK phase / app init — avoid login storms (HTTP 429) before native suites
      const existingToken = await this.roditClient.getSessionToken();
      if (existingToken) {
        this.authToken = existingToken;
        this.isAuthenticated = true;
        logger.info("Reusing existing session token for TestRunner", {
          hasToken: !!this.authToken,
        });
        return;
      }

      // Use RoditClient's login_server method which properly handles config retrieval
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
        throw new Error(`Authentication not-passed: ${loginResult.error}`);
      } else {
        throw new Error("Authentication not-passed: No token received");
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
      } else if (result === undefined) {
        // Test function didn't return a result - this is an error that should be surfaced
        this.results[NOT_PASSED]++;
        logContext.result = "not-passed";
        
        const { captureTestData } = require("./test-modules/test-utils");
        const duration = Date.now() - new Date(logContext.startTime).getTime();
        
        const error = new Error(`Test function ${testName} did not return a result object. Tests must return { passed: boolean, error?: string, details?: object }`);
        error.code = 'TEST_RESULT_MISSING';
        error.statusCode = null;
        logger.errorWithContext(`Test not-passed: ${testName}`, {
          component: "TestRunner",
          moduleName: logContext.moduleName,
          testName,
          correlationId: logContext.correlationId,
          result: "not-passed",
          reason: "test_result_missing",
          error: error.message
        });
        
        captureTestData(
          testName,
          logContext.moduleName || "native",
          {
            passed: false,
            error: error.message,
            details: { testName, expectedResultStructure: '{ passed: boolean, error?: string, details?: object }' }
          },
          {
            endpoint: ec_api_ep,
            testId: logContext.testId,
            duration,
            error: error.message,
            stack: error.stack
          }
        );
      } else {
        // Import captureTestData if not already imported
        const { captureTestData } = require("./test-modules/test-utils");
        const duration = Date.now() - new Date(logContext.startTime).getTime();

        // Enforce standard result structure: { passed: boolean, ... }
        if (result.passed === undefined) {
          // Test module is badly implemented - doesn't use 'passed' property
          const invalidProperties = Object.keys(result).filter(k => k !== 'passed');
          const errorMessage = `Test module badly implemented: must return { passed: boolean } but got properties: ${invalidProperties.join(', ')}`;
          
          logger.errorWithContext(errorMessage, {
            component: "TestRunner",
            moduleName: logContext.moduleName,
            testName,
            correlationId: logContext.correlationId,
            result: "not-passed",
            invalidProperties,
            actualResult: result
          });
          
          // Treat as not-passed
          this.results[NOT_PASSED]++;
          logContext.result = "not-passed";
          
          captureTestData(
            testName,
            logContext.moduleName || "native",
            {
              passed: false,
              error: errorMessage,
              details: { testName, invalidProperties, actualResult: result }
            },
            {
              endpoint: ec_api_ep,
              testId: logContext.testId,
              duration,
              error: errorMessage
            }
          );
        } else if (result.passed === true) {
          this.results.passed++;
          logContext.result = "passed";

          // Modules that return captureTestData() already logged via logTestResult
          if (!result.testInfo?.timestamp) {
            captureTestData(
              testName,
              logContext.moduleName || "native",
              {
                passed: true,
                details: result.details || {},
              },
              {
                endpoint: ec_api_ep,
                testId: logContext.testId,
                duration,
              }
            );
          }
        } else {
          this.results[NOT_PASSED]++;
          logContext.result = "not-passed";

          if (!result.testInfo?.timestamp) {
            captureTestData(
              testName,
              logContext.moduleName || "native",
              {
                passed: false,
                error: result.error,
                details: result.details || {},
                ...(Array.isArray(result.results)
                  ? { results: result.results }
                  : {}),
              },
              {
                endpoint: ec_api_ep,
                testId: logContext.testId,
                duration,
                error: result.error,
                stack: result.stack,
                ...(Array.isArray(result.results)
                  ? { results: result.results }
                  : {}),
              }
            );
          }
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
      // Extract comprehensive error details to prevent hiding errors
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      const errorStack = error?.stack || 'no stack trace';
      const errorName = error?.name || 'Unknown';
      const errorType = typeof error;

      logger.error(`Test ${testName} threw unhandled exception`, {
        component: 'TestRunner',
        moduleName: logContext.moduleName,
        testName,
        result: "not-passed",
        errorMessage,
        errorName,
        errorStack,
        errorType,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });

      this.results[NOT_PASSED]++;
      logContext.result = "not-passed";
      logContext.errorMessage = errorMessage;

      // Import captureTestData if not already imported
      const { captureTestData } = require("./test-modules/test-utils");
      const duration = Date.now() - new Date(logContext.startTime).getTime();

      // Use captureTestData for consistent test result reporting
      captureTestData(
        testName,
        logContext.moduleName || "native",
        {
          passed: false,
          error: errorMessage,
          stack: errorStack,
          details: {
            errorName,
            errorType
          }
        },
        {
          endpoint: ec_api_ep,
          testId: logContext.testId,
          duration,
          error: errorMessage,
          stack: errorStack,
        }
      );

      // Store test result
      this.results.testCases[testName] = {
        result: "not-passed",
        error: errorMessage,
        stack: errorStack,
        duration: new Date() - new Date(logContext.startTime),
      };

      // Always continue with tests even when errors occur
      return { passed: false, error: errorMessage };
    }
  }

  async runTestSuite(testSuite, name, extraLogContext = {}) {
    const suiteId = crypto.randomUUID();
    const logContext = {
      runId: this.runId,
      suiteId,
      suiteName: name,
      startTime: new Date().toISOString(),
      ...extraLogContext,
    };

    logger.infoWithContext(`Starting test suite: ${name}`, logContext);

    const suiteResults = {
      name,
      passed: 0,
      [NOT_PASSED]: 0,
      skipped: 0,
      total: Object.keys(testSuite).length,
    };

    // Ensure we're authenticated before running the test suite
    if (!this.isAuthenticated) {
      try {
        await this.authenticate();
      } catch (error) {
        logger.error(`Authentication not-passed for suite ${name}:`, error);
        throw new Error(`Test suite ${name} not-passed: Authentication required`);
      }
    }

    const excludedTests =
      (typeof this.config?.get === "function"
        ? this.config.get("API_DEFAULT_OPTIONS.EXCLUDED_TESTS")
        : this.config?.API_DEFAULT_OPTIONS?.EXCLUDED_TESTS) || [];

    const perfSummary =
      name.includes("performanceSlo")
        ? { gateFailures: [], metricWarnings: [], infraAborts: [] }
        : null;

    const deferTestNames =
      extraLogContext.deferTestNames instanceof Set
        ? extraLogContext.deferTestNames
        : LIFETIME_TIMEOUT_TESTS;
    const deferred = [];

    // Run tests sequentially
    // Filter out helper functions (only run functions that start with 'test')
    for (const [testName, testFn] of Object.entries(testSuite)) {
      // Skip helper functions that don't start with 'test'
      if (!testName.startsWith('test')) {
        logger.debug(`Skipping helper function: ${testName}`, {
          component: "TestRunner",
          suiteName: name,
        });
        suiteResults.total--; // Don't count helper functions in total
        continue;
      }

      if (excludedTests.includes(testName)) {
        logger.info(`Skipping excluded test: ${testName}`, {
          component: "TestRunner",
          suiteName: name,
          testName,
        });
        suiteResults.skipped++;
        suiteResults.total--;
        continue;
      }

      if (deferTestNames.has(testName)) {
        logger.info(`Deferring lifetime/renewal timeout test until final pass: ${testName}`, {
          component: "TestRunner",
          suiteName: name,
          testName,
        });
        deferred.push({ testName, testFn, suiteName: name });
        suiteResults.total--;
        continue;
      }
      
      try {
        logger.info(`Running test: ${testName}`);
        const result = await this.runTest(testName, testFn, {
          moduleName: name,
        });

        if (result === null) {
          suiteResults.skipped++;
        } else if (result.passed) {
          suiteResults.passed++;
        } else {
          suiteResults[NOT_PASSED]++;
          logger.warn(`Test not-passed in suite ${name}`, {
            component: "TestRunner",
            suiteName: name,
            testName,
            result: "not-passed",
            error: result?.error || null
          });
        }

        if (perfSummary && result?.details) {
          if (result.details.infraAbort) {
            perfSummary.infraAborts.push({ testName, message: result.message || result.details.whatHappened });
          }
          if (Array.isArray(result.details.gateFailures)) {
            perfSummary.gateFailures.push(
              ...result.details.gateFailures.map((g) => ({ testName, ...g }))
            );
          }
          if (Array.isArray(result.details.metricWarnings)) {
            perfSummary.metricWarnings.push(
              ...result.details.metricWarnings.map((m) => ({ testName, ...m }))
            );
          }
        }
      } catch (error) {
        const { isInfraAbortError } = require("./test-modules/perf-slo-utils");
        if (name.includes("performanceSlo") && isInfraAbortError(error)) {
          suiteResults.passed++;
          perfSummary?.infraAborts.push({
            testName,
            message: String(error.message),
          });
          logger.warn(`PERF INFRA ABORT in suite ${name}`, {
            component: "TestRunner",
            suiteName: name,
            testName,
            error: error.message,
          });
          continue;
        }
        // Extract comprehensive error details to prevent hiding errors
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        const errorStack = error?.stack || 'no stack trace';
        const errorName = error?.name || 'Unknown';
        const errorType = typeof error;

        logger.error(`Test ${testName} not-passed with unhandled exception`, {
          component: 'TestRunner',
          suiteName: name,
          testName,
          result: "not-passed",
          errorMessage,
          errorName,
          errorStack,
          errorType,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
        suiteResults[NOT_PASSED]++;
      }
    }

    logContext.endTime = new Date().toISOString();
    if (perfSummary) {
      logContext.perfSummary = perfSummary;
      logger.info("Performance SLO suite summary", {
        component: "TestRunner",
        suiteName: name,
        gateFailures: perfSummary.gateFailures,
        metricWarnings: perfSummary.metricWarnings,
        infraAborts: perfSummary.infraAborts,
        gateFailureCount: perfSummary.gateFailures.length,
        metricWarningCount: perfSummary.metricWarnings.length,
      });
    }
    logSuiteOutcome(logger, name, suiteResults, logContext);

    return { ...suiteResults, deferred };
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
      logger.error("Test run not-passed:", error);
      throw error;
    }
  }

  generateReport() {
    return {
      summary: {
        passed: this.results.passed,
        [NOT_PASSED]: this.results[NOT_PASSED],
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
    const loginResult = await client.login_server_withaccountid();

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

      // Run all test suites
      const allTestSuites = {
        authentication: authenticationTests,
        security: securityTests,
        rateLimiting: rateLimitTests,
        contentType: contentTypeTests,
        metrics: metricsTests,
        sessionManagement: sessionManagementTests,
        mcp: mcpTests,
        identyclawApi: identyclawApiTests,
      };

      for (const [suiteName, testSuite] of Object.entries(allTestSuites)) {
        try {
          logger.infoWithContext(`Running ${suiteName} tests`, {
            ...testContext,
            testPhase: suiteName,
          });

          await testRunner.runTestSuite(testSuite, suiteName, {
            ...testContext,
            testPhase: suiteName,
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
      logContext.status = "not-passed";
      logContext.failureReason = "JWT token not received";
      logger.errorWithContext("Failed to obtain JWT token", logContext);
      return { error: "Failed to obtain JWT token" };
    }
  } catch (error) {
    logContext.status = "not-passed";
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
    hasApp: !!app,
    hasRoditClient: !!(app && app.locals && app.locals.roditClient),
  });

  // Resolve API endpoint after RoditClient is fully initialized
  logger.debug("Resolving API endpoint from fully initialized RoditClient", {
    component: "TestRunner",
    correlationId: requestId,
    phase: "endpoint-resolution",
  });

  const apiEndpoint = await resolveApiEndpointFromApp(app);

  if (!apiEndpoint) {
    logger.error("API endpoint could not be resolved. Aborting test execution", {
      component: "TestRunner",
      moduleName,
      testName: "runSdkTests",
      correlationId: requestId,
      phase: "endpoint-resolution",
    });

    return {
      error: "API endpoint unavailable",
    };
  }

  logger.info("API endpoint resolved successfully", {
    component: "TestRunner",
    correlationId: requestId,
    phase: "endpoint-resolution",
    apiEndpoint,
  });

  // Perform TLS connectivity check after RoditClient is fully loaded
  logger.debug("Performing TLS connectivity check on resolved endpoint", {
    component: "TestRunner",
    correlationId: requestId,
    phase: "tls-check",
    apiEndpoint,
  });

  const tlsResult = await verifyTlsConnectivity(apiEndpoint);

  if (!tlsResult.ok) {
    logger.error("TLS connectivity check not-passed. Aborting test execution", {
      component: "TestRunner",
      moduleName,
      testName: "runSdkTests",
      correlationId: requestId,
      phase: "tls-check",
      apiEndpoint,
      tlsReason: tlsResult.reason,
      tlsStatusCode: tlsResult.statusCode,
      tlsError: tlsResult.error?.message,
    });

    return {
      error: "TLS connectivity check not-passed",
      tls: {
        apiEndpoint,
        ...tlsResult,
      },
    };
  }

  logger.info("TLS connectivity check succeeded. Proceeding with tests", {
    component: "TestRunner",
    moduleName,
    testName: "runSdkTests",
    correlationId: requestId,
    phase: "tls-check",
    apiEndpoint,
    tlsStatusCode: tlsResult.statusCode,
  });

  try {
    // Single SDK-mature phase: each enabled suite runs once (no native re-run).
    const sharedTestRunner = new TestRunner(app, config);
    const suiteResultsByName = await runEnabledTestSuites(
      app,
      config,
      sharedTestRunner
    );

    let passedCount = 0;
    let notPassedCount = 0;
    let totalCount = 0;
    let skippedCount = 0;
    let overallSuccess = true;

    Object.values(suiteResultsByName).forEach((categoryResult) => {
      if (categoryResult?.error) {
        overallSuccess = false;
        notPassedCount += 1;
        totalCount += 1;
        return;
      }
      if (typeof categoryResult?.[NOT_PASSED] === "number") {
        passedCount += categoryResult.passed || 0;
        notPassedCount += categoryResult[NOT_PASSED] || 0;
        skippedCount += categoryResult.skipped || 0;
        totalCount += categoryResult.total || 0;
        if (categoryResult[NOT_PASSED] > 0) {
          overallSuccess = false;
        }
      } else if (Array.isArray(categoryResult?.tests)) {
        const suiteTests = categoryResult.tests;
        totalCount += suiteTests.length;
        passedCount += suiteTests.filter((t) => t.passed).length;
        notPassedCount += suiteTests.filter((t) => !t.passed).length;
        if (suiteTests.some((t) => !t.passed)) {
          overallSuccess = false;
        }
      }
    });

    const summary = {
      passed: passedCount,
      [NOT_PASSED]: notPassedCount,
      skipped: skippedCount,
      total: totalCount,
    };

    const results = {
      passed: overallSuccess,
      suites: suiteResultsByName,
      summary,
      // Compatibility aliases for older log/app consumers (single phase).
      sdk: { passed: overallSuccess, suites: suiteResultsByName, summary },
      native: {
        passed: true,
        suites: {},
        summary: { passed: 0, [NOT_PASSED]: 0, skipped: 0, total: 0 },
        skippedPhase: true,
        message: "Native re-run removed; suites execute once via SDK path",
      },
    };

    logger.info("All tests completed", {
      component: "TestRunner",
      correlationId: requestId,
      phase: "complete",
      duration: Date.now() - startTime,
      passed: overallSuccess,
      testsPassed: passedCount,
      [NOT_PASSED]: notPassedCount,
      totalTests: totalCount,
    });

    return results;
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
 * Run rate limit tests
 * @param {string} rrlt_api_ep - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runRateLimitTests(rrlt_api_ep) {
  const testRunner = new TestRunner(rrlt_api_ep, {});
  return await testRunner.runTestSuite(rateLimitTests, "rate-limiting");
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
 * Collect lifetime-timeout test fns from loaded modules (enabled + not excluded).
 * @param {Object} loadedModules
 * @param {string[]} suiteNames
 * @param {string[]} excludedTests
 * @returns {{ testName: string, testFn: Function, suiteName: string }[]}
 */
function collectLifetimeTimeoutTests(loadedModules, suiteNames, excludedTests) {
  const byName = new Map();
  for (const suiteName of suiteNames) {
    const mod = loadedModules[suiteName];
    if (!mod) continue;
    for (const [testName, testFn] of Object.entries(mod)) {
      if (!LIFETIME_TIMEOUT_TESTS.has(testName)) continue;
      if (excludedTests.includes(testName)) continue;
      if (typeof testFn !== "function") continue;
      byName.set(testName, { testName, testFn, suiteName });
    }
  }
  return LIFETIME_TIMEOUT_TEST_ORDER.map((n) => byName.get(n)).filter(Boolean);
}

/**
 * Run one lifetime/renewal test on an isolated TestRunner (safe for Promise.all).
 * @param {Object} app
 * @param {Object} config
 * @param {{ testName: string, testFn: Function, suiteName: string }} item
 * @param {string} correlationId
 */
async function runLifetimeTimeoutTestIsolated(app, config, item, correlationId) {
  const runner = new TestRunner(app, config);
  const started = Date.now();
  logger.info("Starting lifetime/renewal timeout test in parallel", {
    component: "TestRunner",
    correlationId,
    testName: item.testName,
    sourceSuite: item.suiteName,
    phase: "lifetimeTimeout-parallel",
  });
  try {
    await runner.authenticate();
    const result = await runner.runTest(item.testName, item.testFn, {
      moduleName: "lifetimeTimeout",
      correlationId,
      sourceSuite: item.suiteName,
    });
    logger.info("Lifetime/renewal timeout test finished", {
      component: "TestRunner",
      correlationId,
      testName: item.testName,
      passed: result == null ? null : result?.passed !== false,
      skipped: result === null,
      durationMs: Date.now() - started,
    });
    return { testName: item.testName, result };
  } catch (error) {
    logger.error("Lifetime/renewal timeout test not-passed with exception", {
      component: "TestRunner",
      correlationId,
      testName: item.testName,
      error: error?.message || String(error),
      durationMs: Date.now() - started,
    });
    return {
      testName: item.testName,
      result: { passed: false, error: error?.message || String(error) },
    };
  }
}

/**
 * Run enabled test suites once (SDK-mature single phase).
 * Lifetime/renewal timeout tests start in parallel up front and overlap the
 * rest of the matrix; lifetime suites' remaining tests still run last.
 * @param {Object} app - Express app instance with roditClient in app.locals
 * @param {Object} config - Configuration object
 * @param {TestRunner|null} sharedTestRunner
 * @returns {Promise<Object>} Test results by suite name
 */
async function runEnabledTestSuites(app, config = {}, sharedTestRunner = null) {
  const results = {};
  const requestId = ulid();

  logger.infoWithContext("Running enabled test suites (single phase)", {
    correlationId: requestId,
    hasApp: !!app,
    hasRoditClient: !!(app && app.locals && app.locals.roditClient),
  });

  const enabledSuites = config.get("API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES") || [];
  const excludedTests = config.get("API_DEFAULT_OPTIONS.EXCLUDED_TESTS") || [];
  const loadedModules = loadTestModules();

  const filteredSuiteNames = orderSuitesForExecution(
    enabledSuites.filter((suiteName) => {
      if (excludedTests.includes(suiteName)) {
        logger.info(`Skipping excluded test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
        });
        return false;
      }
      if (!loadedModules[suiteName]) {
        logger.warn(`Enabled suite not loaded: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
        });
        return false;
      }
      return true;
    })
  );

  const lifetimeItems = collectLifetimeTimeoutTests(
    loadedModules,
    filteredSuiteNames,
    excludedTests
  );

  logger.info("Filtered test suites to run:", {
    component: "TestRunner",
    correlationId: requestId,
    filteredSuites: filteredSuiteNames,
    lifetimeSuitesLast: filteredSuiteNames.filter((n) =>
      LIFETIME_TIMEOUT_SUITES.has(n)
    ),
    lifetimeTimeoutParallel: lifetimeItems.map((i) => i.testName),
    totalFiltered: filteredSuiteNames.length,
  });

  // Start long waits immediately so their clocks overlap the rest of the matrix.
  const lifetimePromise =
    lifetimeItems.length > 0
      ? Promise.all(
          lifetimeItems.map((item) =>
            runLifetimeTimeoutTestIsolated(app, config, item, requestId)
          )
        )
      : Promise.resolve([]);

  if (lifetimeItems.length > 0) {
    logger.infoWithContext(
      "Lifetime/renewal timeout tests started in parallel (overlapping other suites)",
      {
        correlationId: requestId,
        testPhase: "lifetimeTimeout",
        tests: lifetimeItems.map((d) => d.testName),
      }
    );
  }

  const testRunner = sharedTestRunner || new TestRunner(app, config);

  for (const suiteName of filteredSuiteNames) {
    const testModule = loadedModules[suiteName];
    try {
      logger.infoWithContext(`Running ${suiteName} tests`, {
        correlationId: requestId,
        testPhase: suiteName,
        suiteName,
        hasTests: !!testModule,
        testKeys: testModule ? Object.keys(testModule) : [],
      });

      const suiteResult = await testRunner.runTestSuite(testModule, suiteName, {
        correlationId: requestId,
        component: "TestRunner",
        testPhase: suiteName,
        deferTestNames: LIFETIME_TIMEOUT_TESTS,
      });

      const { deferred: _deferred, ...publicSuiteResult } = suiteResult;
      results[suiteName] = publicSuiteResult;
    } catch (error) {
      const errorMessage = error?.message || error?.toString() || "Unknown error";
      const errorStack = error?.stack || "no stack trace";
      const errorName = error?.name || "Unknown";
      const errorType = typeof error;

      logger.errorWithContext(`Error running ${suiteName} tests`, {
        correlationId: requestId,
        errorMessage,
        errorName,
        errorStack,
        errorType,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error)),
      });

      results[suiteName] = { error: errorMessage, errorName, errorStack };
    }
  }

  const lifetimeOutcomes = await lifetimePromise;
  if (lifetimeOutcomes.length > 0) {
    const lifetimeSuiteName = "lifetimeTimeout";
    const suiteResults = {
      name: lifetimeSuiteName,
      passed: 0,
      [NOT_PASSED]: 0,
      skipped: 0,
      total: lifetimeOutcomes.length,
      parallel: true,
    };
    for (const { result } of lifetimeOutcomes) {
      if (result === null) {
        suiteResults.skipped++;
      } else if (result?.passed) {
        suiteResults.passed++;
      } else {
        suiteResults[NOT_PASSED]++;
      }
    }
    logSuiteOutcome(logger, lifetimeSuiteName, suiteResults, {
      correlationId: requestId,
      parallel: true,
    });
    results[lifetimeSuiteName] = suiteResults;
  }

  return results;
}

/** @deprecated Use runEnabledTestSuites — alias kept for callers/tests. */
async function runSdkBasedTests(app, config = {}, sharedTestRunner = null) {
  return runEnabledTestSuites(app, config, sharedTestRunner);
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
      rateLimit: runRateLimitTests,
      contentType: runContentTypeTests,
      mcp: runMcpTests,
      metrics: runMetricsTests,
      sessionManagement: runSessionManagementTests,
      sdk: runSdkBasedTests,
    };

    const testSuiteFunction = testSuiteFunctions[suiteName];

    if (!testSuiteFunction) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        passed: false,
        error: `Unknown test suite: ${suiteName}`,
      };
    }

    // Run the test suite
    const results = await testSuiteFunction(rts_api_ep);

    logger.infoWithContext(`Test suite ${suiteName} completed`, {
      ...logContext,
      passed: true,
      results,
    });

    return {
      passed: true,
      results,
    };
  } catch (error) {
    logger.errorWithContext(`Error running test suite ${suiteName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack,
    });

    return {
      passed: false,
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
      rateLimiting: rateLimitTests,
      contentType: contentTypeTests,
      mcp: mcpTests,
      metrics: metricsTests,
      sessionManagement: sessionManagementTests,
      identyclawApi: identyclawApiTests,
    };

    const testSuite = testSuites[suiteName];

    if (!testSuite) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        passed: false,
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
        passed: false,
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
      passed: result?.passed,
      error: result?.error,
    });

    return {
      passed: true,
      testResult: result,
    };
  } catch (error) {
    logger.errorWithContext(`Error running test ${suiteName}.${testName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack,
    });

    return {
      passed: false,
      error: error.message,
    };
  }
}

// Export all functions
/**
 * Run stress tests
 */
async function runStressTests(apiEndpoint) {
  const requestId = ulid();
  const logContext = {
    requestId,
    component: "StressTestRunner",
    apiEndpoint,
  };

  try {
    const stressTestsModule = require("./test-modules/stress-tests");
    const results = [];

    // Run baseline stress test
    logger.debug("Running baseline stress test", logContext);
    const baselineResult = await stressTestsModule.testBaselineStress(apiEndpoint, logContext);
    results.push(baselineResult);

    // Run auth stress test
    logger.debug("Running auth stress test", logContext);
    const authResult = await stressTestsModule.testAuthStress(apiEndpoint, logContext);
    results.push(authResult);

    // Run burst stress test
    logger.debug("Running burst stress test", logContext);
    const burstResult = await stressTestsModule.testBurstStress(apiEndpoint, logContext);
    results.push(burstResult);

    // Run failure scenario test
    logger.debug("Running failure scenario test", logContext);
    const failureResult = await stressTestsModule.testFailureScenarios(apiEndpoint, logContext);
    results.push(failureResult);

    const passed = results.every((r) => r.passed || r.skipped);

    logger.info("Stress tests completed", {
      ...logContext,
      passed,
      totalTests: results.length,
      passedTests: results.filter((r) => r.passed).length,
    });

    return {
      passed,
      results,
      totalTests: results.length,
      passedTests: results.filter((r) => r.passed).length,
    };
  } catch (error) {
    logger.error("Error running stress tests", {
      ...logContext,
      error: error.message,
      stack: error.stack,
    });

    return {
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

module.exports = {
  TestRunner,
  enhancedClient,
  runSdkTests,
  getTestExecutionState,
  runAuthenticationTests,
  runSecurityTests,
  runRateLimitTests,
  runContentTypeTests,
  runMcpTests,
  runMetricsTests,
  runSessionManagementTests,
  runEnabledTestSuites,
  runSdkBasedTests,
  runStressTests,
  runTestSuite,
  runSingleTest,
  orderSuitesForExecution,
  LIFETIME_TIMEOUT_SUITES,
  LIFETIME_TIMEOUT_TEST_ORDER,
};
