// enhanced-client.js
const crypto = require("crypto");
const logger = require("../config/logger");
const {
  roditManager,
  stateManager,
  login_server,
} = require("./middleware/rodit");
const TestRunner = require("./test-runner");
const os = require("os");

// Import test modules
const authenticationTests = require("./test-modules/authentication");
const permissionTests = require("./test-modules/permissions");
const rateLimitTests = require("./test-modules/rate-limiting");
const securityTests = require("./test-modules/security");
const performanceTests = require("./test-modules/performance");
const legacyTests = require("./test-modules/legacy-tests");

// Track state of test execution
const testExecutionState = {
  isRunning: false,
  currentTestIteration: 0,
  lastCompletedIteration: 0,
  startTime: null,
  endTime: null,
  testResults: [],
};

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
    await roditManager.initializeVault().catch((error) => {
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

    // Get configuration from state manager
    logger.debugWithContext("Retrieving config from state manager", logContext);
    const roditConfig = await stateManager.getConfigOwnRodit();

    if (!roditConfig) {
      logger.errorWithContext(
        "Failed to retrieve RODiT configuration",
        logContext
      );
      throw new Error("Failed to retrieve RODiT configuration");
    }

    logger.infoWithContext("Attempting server login", logContext);
    const loginResult = await login_server(roditConfig.own_rodit);

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
        parseInt(config?.API_OPTIONS?.TEST_CLIENT_DURATION, 10) * 1000 || 60000;
      const TEST_INTERVAL =
        parseInt(config?.API_OPTIONS?.TEST_INTERVAL, 10) * 1000 || 5000;
      const MAX_CONCURRENT_TESTS =
        parseInt(config?.API_OPTIONS?.MAX_CONCURRENT_TESTS, 10) || 1;

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

      // MODIFIED: Run legacy tests first
      logger.infoWithContext("Running legacy tests first", {
        ...testContext,
        testPhase: "legacy",
      });
      
      try {
        const legacyResults = await testRunner.runTestSuite(legacyTests, "legacy");
        logger.infoWithContext("Legacy tests completed", {
          ...testContext,
          legacyTestsStatus: "completed",
          legacyTestResults: legacyResults,
        });
      } catch (legacyError) {
        logger.errorWithContext("Error running legacy tests", {
          ...testContext,
          legacyTestsStatus: "error",
        }, legacyError);
      }

      // Group all other tests into test suites
      const testSuites = {
        authentication: authenticationTests,
        permissions: permissionTests,
        rateLimits: rateLimitTests,
        security: securityTests,
        performance: performanceTests,
        // Legacy tests are removed from the main test suites as they're run separately first
      };

      // Check if specific test suites are enabled
      const enabledSuites =
        config?.API_OPTIONS?.ENABLED_TEST_SUITES || Object.keys(testSuites);
      const excludedTests = config?.API_OPTIONS?.EXCLUDED_TESTS || [];

      // Filter test suites based on configuration
      const filteredTestSuites = {};
      for (const suiteName of enabledSuites) {
        if (testSuites[suiteName]) {
          // Filter out excluded tests
          const suiteTests = testSuites[suiteName];
          filteredTestSuites[suiteName] = {};

          for (const [testName, testFn] of Object.entries(suiteTests)) {
            const fullTestName = `${suiteName}.${testName}`;
            if (
              !excludedTests.includes(fullTestName) &&
              !excludedTests.includes(testName)
            ) {
              filteredTestSuites[suiteName][testName] = testFn;
            } else {
              logger.infoWithContext(
                `Skipping excluded test: ${fullTestName}`,
                {
                  ...testContext,
                  excludedTest: fullTestName,
                }
              );
            }
          }
        }
      }

      let testCount = 0;
      let concurrentTestsRunning = 0;
      let testsRunning = false;

      const runTestIteration = async (iterationNumber) => {
        testExecutionState.currentTestIteration = iterationNumber;
        concurrentTestsRunning++;

        const iterationContext = {
          ...testContext,
          testIteration: iterationNumber,
          iterationStartTime: new Date().toISOString(),
          concurrentRunning: concurrentTestsRunning,
        };

        logger.infoWithContext(
          `Starting test iteration ${iterationNumber}`,
          iterationContext
        );

        try {
          // Run all tests with the test runner
          const results = await testRunner.runAllTests(filteredTestSuites);

          // Also run comparative tests
          const comparativeResult = await testRunner.runComparativeTests(
            loginResult.apiendpoint
          );
          logger.infoWithContext("Comparative test results", {
            ...testContext,
            result: comparativeResult?.success ? "PASS" : "FAIL",
            details: comparativeResult?.details || {},
          });
          // Generate and log test report
          const report = testRunner.generateReport();

          // Store results
          testExecutionState.testResults.push({
            iteration: iterationNumber,
            timestamp: new Date().toISOString(),
            report: report.summary,
          });

          logger.infoWithContext("Test report", {
            ...iterationContext,
            report: report.summary,
          });

          iterationContext.iterationEndTime = new Date().toISOString();
          logger.infoWithContext(
            `Completed test iteration ${iterationNumber}`,
            iterationContext
          );

          testExecutionState.lastCompletedIteration = iterationNumber;
        } catch (error) {
          logger.errorWithContext(
            `Error in test iteration ${iterationNumber}`,
            { ...iterationContext, error: error.message },
            error
          );
        } finally {
          concurrentTestsRunning--;
        }
      };

      // Main test loop
      while (Date.now() < endTime) {
        testCount++;

        // Check system load before starting new tests
        const cpuLoad = os.loadavg()[0];
        const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;

        const systemContext = {
          ...testContext,
          cpuLoad,
          memoryUsage: `${memoryUsage.toFixed(2)} MB`,
          concurrentRunning: concurrentTestsRunning,
        };

        // Throttle tests if system is under heavy load
        if (cpuLoad > 3.0 || memoryUsage > 1024) {
          logger.warnWithContext(
            "System under heavy load, throttling test execution",
            systemContext
          );

          // Wait for load to decrease before continuing
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }

        // Check if we can run more concurrent tests
        if (concurrentTestsRunning < MAX_CONCURRENT_TESTS) {
          runTestIteration(testCount).catch((error) => {
            logger.errorWithContext(
              `Unexpected error in test iteration ${testCount}`,
              { ...testContext, error: error.message },
              error
            );
          });

          // Small delay between starting test iterations
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          logger.debugWithContext(
            `Maximum concurrent tests running (${concurrentTestsRunning}), waiting...`,
            systemContext
          );
        }

        // Wait for the next test interval or until the end time, whichever comes first
        const timeUntilNextTest = Math.min(
          TEST_INTERVAL,
          Math.max(0, endTime - Date.now()) // Ensure we don't get negative values
        );

        if (timeUntilNextTest > 0) {
          logger.debugWithContext(
            `Waiting ${timeUntilNextTest}ms until next test`,
            {
              ...testContext,
              nextTestIn: timeUntilNextTest,
              concurrentRunning: concurrentTestsRunning,
            }
          );
          await new Promise((resolve) =>
            setTimeout(resolve, timeUntilNextTest)
          );
        }
      }

      // Wait for all running tests to complete
      if (concurrentTestsRunning > 0) {
        logger.infoWithContext(
          `Waiting for ${concurrentTestsRunning} running tests to complete`,
          testContext
        );

        // Check every second if tests are done
        while (concurrentTestsRunning > 0) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logContext.endTime = new Date().toISOString();
      logContext.totalTestIterations = testCount;
      logContext.completedTestIterations =
        testExecutionState.lastCompletedIteration;
      logContext.testSuccessRate = `${(
        (testExecutionState.lastCompletedIteration / testCount) *
        100
      ).toFixed(2)}%`;
      logContext.status = "completed";

      testExecutionState.endTime = Date.now();

      logger.infoWithContext(
        "Enhanced client finished running tests",
        logContext
      );
    } else {
      logContext.status = "failed";
      logContext.failureReason = "JWT token not received";
      logger.errorWithContext("Failed to obtain JWT token", logContext);
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
  } finally {
    testExecutionState.isRunning = false;
  }
}

/**
 * Run a specific test suite by name
 * @param {string} apiEndpoint - API endpoint URL
 * @param {string} suiteName - Name of test suite to run
 * @returns {Promise<Object>} - Test results
 */
async function runTestSuite(apiEndpoint, suiteName) {
  const suiteContext = {
    component: "runTestSuite",
    suiteName,
    apiEndpoint,
    startTime: new Date().toISOString(),
  };

  try {
    const testRunner = new TestRunner(apiEndpoint);

    // Map suite name to test module
    const testModules = {
      authentication: authenticationTests,
      permissions: permissionTests,
      rateLimits: rateLimitTests,
      security: securityTests,
      performance: performanceTests,
      legacy: legacyTests,
    };

    // Check if suite exists
    if (!testModules[suiteName]) {
      logger.errorWithContext(
        `Test suite '${suiteName}' not found`,
        suiteContext
      );
      return {
        success: false,
        error: `Test suite '${suiteName}' not found`,
      };
    }

    // Run the test suite
    logger.infoWithContext(`Running test suite: ${suiteName}`, suiteContext);
    await testRunner.runTestSuite(testModules[suiteName], suiteName);

    // Generate and log test report
    const report = testRunner.generateReport();
    logger.infoWithContext(`${suiteName} test report`, {
      ...suiteContext,
      report: report.summary,
    });

    suiteContext.endTime = new Date().toISOString();
    suiteContext.status = "completed";
    logger.infoWithContext(`Test suite ${suiteName} completed`, suiteContext);

    return {
      success: true,
      report: report,
    };
  } catch (error) {
    suiteContext.endTime = new Date().toISOString();
    suiteContext.status = "error";
    suiteContext.error = error.message;

    logger.errorWithContext(
      `Error running test suite '${suiteName}'`,
      suiteContext,
      error
    );

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run a specific test by name and suite
 * @param {string} apiEndpoint - API endpoint URL
 * @param {string} suiteName - Name of test suite
 * @param {string} testName - Name of test to run
 * @returns {Promise<Object>} - Test results
 */
async function runSingleTest(apiEndpoint, suiteName, testName) {
  const testContext = {
    component: "runSingleTest",
    suiteName,
    testName,
    apiEndpoint,
    startTime: new Date().toISOString(),
  };

  try {
    const testRunner = new TestRunner(apiEndpoint);

    // Map suite name to test module
    const testModules = {
      authentication: authenticationTests,
      permissions: permissionTests,
      rateLimits: rateLimitTests,
      security: securityTests,
      performance: performanceTests,
      legacy: legacyTests,
    };

    // Check if suite exists
    if (!testModules[suiteName]) {
      logger.errorWithContext(
        `Test suite '${suiteName}' not found`,
        testContext
      );
      return {
        success: false,
        error: `Test suite '${suiteName}' not found`,
      };
    }

    // Check if test exists in suite
    if (!testModules[suiteName][testName]) {
      logger.errorWithContext(
        `Test '${testName}' not found in suite '${suiteName}'`,
        testContext
      );
      return {
        success: false,
        error: `Test '${testName}' not found in suite '${suiteName}'`,
      };
    }

    // Run the specific test
    logger.infoWithContext(
      `Running test: ${suiteName}.${testName}`,
      testContext
    );
    await testRunner.runTest(testName, testModules[suiteName][testName]);

    // Generate and log test report
    const report = testRunner.generateReport();
    logger.infoWithContext(`Single test report for ${suiteName}.${testName}`, {
      ...testContext,
      report: report.summary,
      testDetails: report.testCases[testName],
    });

    testContext.endTime = new Date().toISOString();
    testContext.status = "completed";
    logger.infoWithContext(
      `Test ${suiteName}.${testName} completed`,
      testContext
    );

    return {
      success: true,
      report: report,
      testDetails: report.testCases[testName],
    };
  } catch (error) {
    testContext.endTime = new Date().toISOString();
    testContext.status = "error";
    testContext.error = error.message;

    logger.errorWithContext(
      `Error running test '${testName}' in suite '${suiteName}'`,
      testContext,
      error
    );

    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get current test execution state
 * @returns {Object} - Current test execution state
 */
function getTestExecutionState() {
  return {
    isRunning: testExecutionState.isRunning,
    currentIteration: testExecutionState.currentTestIteration,
    lastCompletedIteration: testExecutionState.lastCompletedIteration,
    startTime: testExecutionState.startTime
      ? new Date(testExecutionState.startTime).toISOString()
      : null,
    endTime: testExecutionState.endTime
      ? new Date(testExecutionState.endTime).toISOString()
      : null,
    runningDuration: testExecutionState.startTime
      ? Math.floor((Date.now() - testExecutionState.startTime) / 1000)
      : 0,
    recentResults: testExecutionState.testResults.slice(-5), // Last 5 results
  };
}

module.exports = {
  enhancedClient,
  runTestSuite,
  runSingleTest,
  getTestExecutionState,
  runComparativeTests: async (apiEndpoint) => {
    const testRunner = new TestRunner(apiEndpoint);
    return await testRunner.runComparativeTests();
  },
  // Add these new exports for direct access to legacy tests
  runLegacyTests: async (apiEndpoint) => {
    const testRunner = new TestRunner(apiEndpoint);
    const results = await testRunner.runTestSuite(legacyTests, "legacy");
    return results;
  },
  runLegacyCRUDA: async (apiEndpoint) => {
    return await legacyTests.testCRUDAOperationsLegacy(apiEndpoint);
  },
  runLegacyEcho: async (apiEndpoint, message) => {
    return await legacyTests.testEchoLegacy(
      apiEndpoint,
      message || "Default echo message"
    );
  },
};