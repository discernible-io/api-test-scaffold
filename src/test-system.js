// test-system.js
// Consolidated module combining test-system.js and test-system.js
const crypto = require("crypto");
const path = require("path");
const { ulid } = require("ulid");
const { logger, roditManager, stateManager } = require("../sdk");
const config = require("../sdk/services/configsdk");
const { verifyTlsConnectivity } = require("./utils/tls-check");

// Mapping of config test suite names to file paths
const testModuleMapping = {
  authentication: "./test-modules/authentication-test",
  security: "./test-modules/security",
  rateLimiting: "./test-modules/rate-limiting",
  contentType: "./test-modules/content-type",
  mcp: "./test-modules/mcp",
  metrics: "./test-modules/metrics",
  sessionManagement: "./test-modules/session-management",
  identyclawApi: "./test-modules/identyclaw-api",
  performanceExtended: "./test-modules/performance-service",
  concurrency: "./test-modules/sdk-client-tests",
  integration: "./test-modules/did-web-resolution",
  performance: "./test-modules/performance-service",
  sdk: "./test-modules/sdk-client-tests",
  sdkSurface: "./test-modules/sdk-surface",
  tokenRenewal: "./test-modules/token-renewal",
  perfServiceTests: "./test-modules/performance-service",
  cruda: "./test-modules/sdk-client-tests",
  idempotency: "./test-modules/error-handling",
  legacy: "./test-modules/config-wrapper-tests",
  loggerTests: "./test-modules/logger-tests",
  mcpResources: "./test-modules/mcp-resources",
  policyDocuments: "./test-modules/policy-documents",
  schemaDocumentation: "./test-modules/schema-documentation",
  subagentAuthorization: "./test-modules/subagent-authorization",
  webhooks: "./test-modules/webhooks",
};

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
  logger.warn("Using default API endpoint (metadata resolution failed)", {
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
    
    // Fallback: Try to resolve from app using the helper function
    const resolvedEndpoint = await resolveApiEndpointFromApp(this.app);
    if (resolvedEndpoint) {
      return resolvedEndpoint;
    }
    
    // Last resort: Use hardcoded default
    const defaultEndpoint = "https://api.identyclaw.com";
    logger.warn("Using default API endpoint (all resolution methods failed)", {
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
      } else if (result === undefined) {
        // Test function didn't return a result - this is an error that should be surfaced
        this.results.notPassed++;
        logContext.result = "not-passed";
        
        const { captureTestData } = require("./test-modules/test-utils");
        const duration = Date.now() - new Date(logContext.startTime).getTime();
        
        const error = new Error(`Test function ${testName} did not return a result object. Tests must return { passed: boolean, error?: string, details?: object }`);
        error.code = 'TEST_RESULT_MISSING';
        error.statusCode = null;
        
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
            invalidProperties,
            actualResult: result
          });
          
          // Treat as not-passed
          this.results.notPassed++;
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
        } else if (result.passed) {
          this.results.passed++;
          logContext.result = "passed";

          // Use captureTestData for consistent test result reporting
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
        } else {
          this.results.notPassed++;
          logContext.result = "not-passed";

          // Use captureTestData for consistent test result reporting
          captureTestData(
            testName,
            logContext.moduleName || "native",
            {
              passed: false,
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
      // Extract comprehensive error details to prevent hiding errors
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      const errorStack = error?.stack || 'no stack trace';
      const errorName = error?.name || 'Unknown';
      const errorType = typeof error;

      logger.error(`Test ${testName} threw unhandled exception`, {
        component: 'TestRunner',
        moduleName: logContext.moduleName,
        testName,
        errorMessage,
        errorName,
        errorStack,
        errorType,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });

      this.results.notPassed++; // Use notPassed instead of failed for consistency
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
          suiteResults.failed++;
        }
      } catch (error) {
        // Extract comprehensive error details to prevent hiding errors
        const errorMessage = error?.message || error?.toString() || 'Unknown error';
        const errorStack = error?.stack || 'no stack trace';
        const errorName = error?.name || 'Unknown';
        const errorType = typeof error;

        logger.error(`Test ${testName} failed with unhandled exception`, {
          component: 'TestRunner',
          suiteName: name,
          testName,
          errorMessage,
          errorName,
          errorStack,
          errorType,
          fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
        });
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
    logger.error("TLS connectivity check failed. Aborting test execution", {
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
      error: "TLS connectivity check failed",
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
          passed: false,
          error: categoryResult.error,
          category: category,
        });
        overallSuccess = false;
      } else if (categoryResult.tests) {
        allTests.push(...categoryResult.tests);
        overallSuccess =
          overallSuccess && categoryResult.tests.every((t) => t.passed);
      }
    });

    const sdkResults = {
      passed: overallSuccess,
      tests: allTests,
    };

    logger.info("SDK tests completed", {
      component: "TestRunner",
      moduleName,
      testName: "runSdkTests",
      correlationId: requestId,
      phase: "complete",
      duration: Date.now() - startTime,
      passed: sdkResults.passed,
      testsPassed: sdkResults.tests.filter((t) => t.passed).length,
      testsFailed: sdkResults.tests.filter((t) => !t.passed).length,
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

    // Dynamically load test suites based on config
    const nativeTestSuites = loadTestModules();

    // Get test configuration
    const enabledSuites = config.get(
      "API_DEFAULT_OPTIONS.ENABLED_TEST_SUITES");
    const excludedTests = config.get("API_DEFAULT_OPTIONS.EXCLUDED_TESTS");

    logger.info("Test suite configuration:", {
      enabledSuites,
      excludedTests,
      loadedSuites: Object.keys(nativeTestSuites),
      component: "TestRunner",
      correlationId: requestId,
    });

    // Filter test suites based on exclusion list
    const filteredTestSuites = Object.entries(nativeTestSuites).reduce(
      (acc, [suiteName, testSuite]) => {
        logger.debug(`Processing test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
          suiteName,
          isExcluded: excludedTests.includes(suiteName),
        });

        // Skip if suite is explicitly excluded
        if (excludedTests.includes(suiteName)) {
          logger.info(`Skipping excluded test suite: ${suiteName}`, {
            component: "TestRunner",
            correlationId: requestId,
          });
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
        passed: nativeSuccess,
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

  // Dynamically load SDK test suites based on config
  const loadedSdkModules = loadTestModules();
  const availableSdkSuites = {};
  
  // Map loaded modules to SDK suite format
  for (const [suiteName, testModule] of Object.entries(loadedSdkModules)) {
    availableSdkSuites[suiteName] = {
      name: `sdk_${suiteName}`,
      tests: testModule,
    };
  }

  // Filter SDK test suites based on exclusion list
  const filteredSdkSuites = Object.entries(availableSdkSuites).reduce(
    (acc, [suiteName, suiteConfig]) => {
      logger.debug(`Processing SDK test suite: ${suiteName}`, {
        component: "TestRunner",
        correlationId: requestId,
        suiteName,
        isExcluded: excludedTests.includes(suiteName),
      });

      // Skip if suite is explicitly excluded
      if (excludedTests.includes(suiteName)) {
        logger.info(`Skipping excluded SDK test suite: ${suiteName}`, {
          component: "TestRunner",
          correlationId: requestId,
        });
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
        suiteName,
        hasTests: !!suiteConfig.tests,
        testKeys: suiteConfig.tests ? Object.keys(suiteConfig.tests) : [],
      });

      const suiteResult = await testRunner.runTestSuite(
        suiteConfig.tests,
        suiteConfig.name
      );

      logger.infoWithContext(`SDK-based ${suiteName} tests completed`, {
        correlationId: requestId,
        suiteName,
        resultType: typeof suiteResult,
        resultKeys: suiteResult ? Object.keys(suiteResult) : [],
        hasError: !!suiteResult?.error,
        errorMessage: suiteResult?.error,
      });

      results[suiteName] = suiteResult;
    } catch (error) {
      // Extract comprehensive error details to prevent hiding errors
      const errorMessage = error?.message || error?.toString() || 'Unknown error';
      const errorStack = error?.stack || 'no stack trace';
      const errorName = error?.name || 'Unknown';
      const errorType = typeof error;

      logger.errorWithContext(`Error running SDK-based ${suiteName} tests`, {
        correlationId: requestId,
        errorMessage,
        errorName,
        errorStack,
        errorType,
        fullError: JSON.stringify(error, Object.getOwnPropertyNames(error))
      });

      results[suiteName] = { error: errorMessage, errorName, errorStack };
    }
  }

  return results;
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
  runSdkBasedTests,
  runTestSuite,
  runSingleTest,
};
