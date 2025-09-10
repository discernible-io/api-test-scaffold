// test-system.js
// Consolidated module combining test-system.js and test-system.js
const crypto = require("crypto");
const { ulid } = require("ulid");
const { logger, roditManager, stateManager, login_server } = require("../sdk");
const os = require("os");

const config = require('../sdk/services/config');

// Import test modules
const authenticationTests = require("./test-modules/authentication-test");
const securityTests = require("./test-modules/security");
const performanceTests = require("./test-modules/performance");
const legacyTests = require("./test-modules/legacy-tests");
const rateLimitTests = require("./test-modules/rate-limiting");
const crudaTests = require("./test-modules/cruda-operations");
const encodingTests = require("./test-modules/encoding-tests");
const concurrencyTests = require("./test-modules/concurrency-tests");
const contentTypeTests = require("./test-modules/content-type-tests");
const idempotencyTests = require("./test-modules/idempotency-tests");
const sdkTests = require("./test-modules/sdk-tests");
// New test modules
const mcpTests = require("./test-modules/mcp-tests");
const metricsTests = require("./test-modules/metrics-tests");
const sessionManagementTests = require("./test-modules/session-management-tests");
const integrationTests = require("./test-modules/integration-tests");
const newPerformanceTests = require("./test-modules/performance-tests");
const perfServiceTests = require("./test-modules/performance-service-tests");
const sdkNpmSurfaceTests = require("./test-modules/sdk-npm-surface-tests");

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
  constructor(apiEndpoint, config) {
    this.apiEndpoint = apiEndpoint;
    this.config = config;
    this.results = {
      passed: 0,
      notPassed: 0, // Changed from 'failed' to 'notPassed' for consistency
      skipped: 0,
      total: 0,
      testCases: {}
    };
    this.runId = crypto.randomUUID();
  }

  async runTest(testName, testFn, params = {}) {
    const testId = crypto.randomUUID();
    const logContext = {
      runId: this.runId,
      testId,
      testName,
      apiEndpoint: this.apiEndpoint,
      startTime: new Date().toISOString(),
      ...params
    };

    logger.infoWithContext(`Starting test: ${testName}`, logContext);
    
    try {
      this.results.total++;
      const result = await testFn(this.apiEndpoint, logContext);
      
      if (result === null) {
        this.results.skipped++;
        logContext.result = "skipped";
        logger.warnWithContext(`Test skipped: ${testName}`, logContext);
      } else {
        // Import captureTestData if not already imported
        const { captureTestData } = require('./test-modules/test-utils');
        const duration = Date.now() - new Date(logContext.startTime).getTime();
        
        if (result.success) {
          this.results.passed++;
          logContext.result = "passed";
          
          // Use captureTestData for consistent test result reporting
          captureTestData(testName, logContext.moduleName || "native", {
            success: true,
            details: result.details || {}
          }, {
            apiEndpoint: this.apiEndpoint,
            testId: logContext.testId,
            duration
          });
        } else {
          this.results.notPassed++;
          logContext.result = "not-passed";
          
          // Use captureTestData for consistent test result reporting
          captureTestData(testName, logContext.moduleName || "native", {
            success: false,
            error: result.error || "Unknown error",
            details: result.details || {}
          }, {
            apiEndpoint: this.apiEndpoint,
            testId: logContext.testId,
            duration,
            error: result.error || "Unknown error",
            stack: result.stack
          });
        }
      }
      
      // Store test result
      this.results.testCases[testName] = {
        result: logContext.result,
        details: result?.details || {},
        error: result?.error || null,
        duration: new Date() - new Date(logContext.startTime)
      };
      
      return result;
    } catch (error) {
      this.results.notPassed++; // Use notPassed instead of failed for consistency
      logContext.result = "not-passed";
      logContext.errorMessage = error.message;
      
      // Import captureTestData if not already imported
      const { captureTestData } = require('./test-modules/test-utils');
      const duration = Date.now() - new Date(logContext.startTime).getTime();
      
      // Use captureTestData for consistent test result reporting
      captureTestData(testName, logContext.moduleName || "native", {
        success: false,
        error: error.message,
        stack: error.stack
      }, {
        apiEndpoint: this.apiEndpoint,
        testId: logContext.testId,
        duration,
        error: error.message,
        stack: error.stack
      });
      
      // Store test result
      this.results.testCases[testName] = {
        result: "not-passed",
        error: error.message,
        stack: error.stack,
        duration: new Date() - new Date(logContext.startTime)
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
      startTime: new Date().toISOString()
    };
    
    logger.infoWithContext(`Starting test suite: ${name}`, logContext);
    
    const suiteResults = {
      name,
      passed: 0,
      failed: 0,
      skipped: 0,
      total: Object.keys(testSuite).length
    };
    
    for (const [testName, testFn] of Object.entries(testSuite)) {
      const result = await this.runTest(testName, testFn);
      if (result === null) {
        suiteResults.skipped++;
      } else if (result.success) {
        suiteResults.passed++;
      } else {
        suiteResults.failed++;
      }
    }
    
    logContext.endTime = new Date().toISOString();
    logContext.results = suiteResults;
    logger.infoWithContext(`Test suite completed: ${name}`, logContext);
    
    return suiteResults;
  }
  
  async runAllTests(testModules) {
    const startTime = new Date();
    logger.infoWithContext(`Starting test run`, {
      runId: this.runId,
      startTime: startTime.toISOString()
    });
    
    for (const [suiteName, testSuite] of Object.entries(testModules)) {
      await this.runTestSuite(testSuite, suiteName);
    }
    
    const endTime = new Date();
    const duration = endTime - startTime;
    
    logger.infoWithContext(`Test run completed`, {
      runId: this.runId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      results: {
        passed: this.results.passed,
        notPassed: this.results.notPassed,
        skipped: this.results.skipped,
        total: this.results.total
      }
    });
    
    return this.results;
  }
  
  generateReport() {
    return {
      summary: {
        passed: this.results.passed,
        notPassed: this.results.notPassed,
        skipped: this.results.skipped,
        total: this.results.total,
        passRate: (this.results.passed / this.results.total * 100).toFixed(2) + '%'
      },
      testCases: this.results.testCases
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

    // Get configuration from state manager
    logger.debugWithContext("Retrieving config from state manager", logContext);
    const config_own_rodit = await stateManager.getConfigOwnRodit();

    if (!config_own_rodit) {
      logger.errorWithContext(
        "Failed to retrieve RODiT configuration",
        logContext
      );
      throw new Error("Failed to retrieve RODiT configuration");
    }

    logger.infoWithContext("Attempting server login", logContext);
    const loginResult = await login_server(config_own_rodit);

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
        parseInt(config?.API_DEFAULT_OPTIONS?.TEST_CLIENT_DURATION, 10) * 1000 || 60000;
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

      // Reset the timing after legacy tests complete to ensure main tests have enough time
      const resetStartTime = Date.now();
      const resetEndTime = resetStartTime + TEST_CLIENT_DURATION;
      
      logger.infoWithContext("Resetting test duration after legacy tests", {
        ...testContext,
        originalEndTime: new Date(endTime).toISOString(),
        newEndTime: new Date(resetEndTime).toISOString(),
        additionalTime: Math.floor((resetEndTime - endTime) / 1000) + " seconds"
      });

      // Run all test suites
      const allTestSuites = {
        authentication: authenticationTests,
        security: securityTests,
        performance: performanceTests,
        rateLimiting: rateLimitTests,
        cruda: crudaTests,
        encoding: encodingTests,
        concurrency: concurrencyTests,
        contentType: contentTypeTests,
        idempotency: idempotencyTests,
        sdk: sdkTests
      };
      
      // Run all test suites in sequence
      for (const [suiteName, testSuite] of Object.entries(allTestSuites)) {
        try {
          logger.infoWithContext(`Running ${suiteName} tests`, {
            ...testContext,
            testPhase: suiteName
          });
          
          const suiteResults = await testRunner.runTestSuite(testSuite, suiteName);
          
          logger.infoWithContext(`${suiteName} tests completed`, {
            ...testContext,
            testPhase: suiteName,
            results: suiteResults
          });
        } catch (error) {
          logger.errorWithContext(`Error running ${suiteName} tests`, {
            ...testContext,
            testPhase: suiteName,
            error: error.message
          }, error);
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
 */
async function runSdkTests() {
  const requestId = ulid();
  const startTime = Date.now();
  const moduleName = 'sdk';
  
  logger.info('Running SDK and native tests during application startup', {
    component: 'TestRunner',
    moduleName,
    testName: 'runSdkTests',
    correlationId: requestId,
    phase: 'start'
  });
  
  try {
    // Get the API protocol and server port from config
    // Config already imported at top of file
    
    // Call the runTests function directly from the sdk-tests module
    // This ensures we're using the same test implementation as before
    const sdkResults = await sdkTests.runTests({
      correlationId: requestId
    });
    
    logger.info('SDK tests completed', {
      component: 'TestRunner',
      moduleName,
      testName: 'runSdkTests',
      correlationId: requestId,
      phase: 'complete',
      duration: Date.now() - startTime,
      success: sdkResults.success,
      testsPassed: sdkResults.tests.filter(t => t.success).length,
      testsFailed: sdkResults.tests.filter(t => !t.success).length,
      totalTests: sdkResults.tests.length
    });
    
    // Run native tests
    logger.info('Running native tests', {
      component: 'TestRunner',
      moduleName: 'native',
      testName: 'runNativeTests',
      correlationId: requestId,
      phase: 'start'
    });
    
    // Get configuration from state manager
    const config_own_rodit = await stateManager.getConfigOwnRodit();
    if (!config_own_rodit) {
      logger.errorWithContext(
        'Failed to retrieve RODiT configuration for native tests',
        { correlationId: requestId }
      );
      throw new Error('Failed to retrieve RODiT configuration for native tests');
    }
    
    // Attempt server login to get API endpoint
    const loginResult = await login_server(config_own_rodit);
    if (!loginResult.jwt_token) {
      logger.errorWithContext('Failed to obtain JWT token for native tests', { correlationId: requestId });
      throw new Error('Failed to obtain JWT token for native tests');
    }
    
    // Store JWT token in the state manager
    await stateManager.setJwtToken(loginResult.jwt_token);
    
    // Port configuration removed as requested
    let apiEndpoint = loginResult.apiendpoint;
    
    // Create a test runner for native tests
    const testRunner = new TestRunner(apiEndpoint, config);
    
    // Define native test suites
    const nativeTestSuites = {
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
      // New test modules
      mcp: mcpTests,
      metrics: metricsTests,
      sessionManagement: sessionManagementTests,
      integration: integrationTests,
      performanceExtended: newPerformanceTests,
      performanceService: perfServiceTests,
      sdkSurface: sdkNpmSurfaceTests
    };
    
    // Run native test suites
    const nativeResults = {};
    for (const [suiteName, testSuite] of Object.entries(nativeTestSuites)) {
      try {
        logger.infoWithContext(`Running ${suiteName} tests`, {
          correlationId: requestId,
          testPhase: suiteName
        });
        
        const suiteResults = await testRunner.runTestSuite(testSuite, suiteName);
        nativeResults[suiteName] = suiteResults;
        
        logger.infoWithContext(`${suiteName} tests completed`, {
          correlationId: requestId,
          testPhase: suiteName,
          results: suiteResults
        });
      } catch (error) {
        logger.errorWithContext(`Error running ${suiteName} tests`, {
          correlationId: requestId,
          testPhase: suiteName,
          error: error.message
        }, error);
        nativeResults[suiteName] = { error: error.message };
      }
    }
    
    // Combine SDK and native test results
    const combinedResults = {
      sdk: sdkResults,
      native: {
        success: Object.values(nativeResults).every(result => !result.error),
        suites: nativeResults
      }
    };
    
    logger.info('All tests completed', {
      component: 'TestRunner',
      correlationId: requestId,
      phase: 'complete',
      duration: Date.now() - startTime
    });
    
    return combinedResults;
  } catch (error) {
    logger.error('Error running tests', {
      component: 'TestRunner',
      moduleName,
      testName: 'runSdkTests',
      correlationId: requestId,
      phase: 'error',
      duration: Date.now() - startTime,
      error: error.message
    }, error);
    
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
    startTime: testExecutionState.startTime ? new Date(testExecutionState.startTime).toISOString() : null,
    endTime: testExecutionState.endTime ? new Date(testExecutionState.endTime).toISOString() : null,
    duration: testExecutionState.startTime && testExecutionState.endTime
      ? (testExecutionState.endTime - testExecutionState.startTime) / 1000
      : null
  };
}

/**
 * Run authentication tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runAuthenticationTests(apiEndpoint) {
  // Ensure the API endpoint has a port
  if (apiEndpoint && apiEndpoint.startsWith('https://') && !apiEndpoint.includes(':', 8)) {
    // Port configuration removed as requested
  }
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(authenticationTests, "authentication");
}

/**
 * Run security tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runSecurityTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(securityTests, "security");
}

/**
 * Run performance tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runPerformanceTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(performanceTests, "performance");
}

/**
 * Run legacy tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runLegacyTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(legacyTests, "legacy");
}

/**
 * Run rate limit tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runRateLimitTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(rateLimitTests, "rate-limiting");
}

/**
 * Run CRUDA tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runCrudaTests(apiEndpoint) {
  // Ensure the API endpoint has a port
  if (apiEndpoint && apiEndpoint.startsWith('https://') && !apiEndpoint.includes(':', 8)) {
    // Port configuration removed as requested
  }
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(crudaTests, "cruda");
}

/**
 * Run encoding tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runEncodingTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(encodingTests, "encoding");
}

/**
 * Run concurrency tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runConcurrencyTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(concurrencyTests, "concurrency");
}

/**
 * Run content type tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runContentTypeTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(contentTypeTests, "content-type");
}

/**
 * Run idempotency tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runIdempotencyTests(apiEndpoint) {
  const testRunner = new TestRunner(apiEndpoint, {});
  return await testRunner.runTestSuite(idempotencyTests, "idempotency");
}

/**
 * Run MCP tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runMcpTests(apiEndpoint) {
  const runner = new TestRunner(apiEndpoint);
  return await runner.runTestSuite(mcpTests, 'MCP Tests');
}

/**
 * Run metrics tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runMetricsTests(apiEndpoint) {
  const runner = new TestRunner(apiEndpoint);
  return await runner.runTestSuite(metricsTests, 'Metrics Tests');
}

/**
 * Run session management tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runSessionManagementTests(apiEndpoint) {
  const runner = new TestRunner(apiEndpoint);
  return await runner.runTestSuite(sessionManagementTests, 'Session Management Tests');
}

/**
 * Run integration tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runIntegrationTests(apiEndpoint) {
  const runner = new TestRunner(apiEndpoint);
  return await runner.runTestSuite(integrationTests, 'Integration Tests');
}

/**
 * Run new performance tests
 * @param {string} apiEndpoint - API endpoint URL
 * @returns {Promise<Object>} - Test results
 */
async function runNewPerformanceTests(apiEndpoint) {
  const runner = new TestRunner(apiEndpoint);
  return await runner.runTestSuite(newPerformanceTests, 'Performance Tests');
}

/**
 * Run all new test modules
 * @param {string} apiEndpoint - API endpoint
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Test results
 */
async function runAllNewTests(apiEndpoint, config = {}) {
  const results = {};
  
  // Run MCP tests
  results.mcp = await runMcpTests(apiEndpoint, config);
  
  // Run metrics tests
  results.metrics = await runMetricsTests(apiEndpoint, config);
  
  // Run session management tests
  results.sessionManagement = await runSessionManagementTests(apiEndpoint, config);
  
  // Run integration tests
  results.integration = await runIntegrationTests(apiEndpoint, config);
  
  // Run new performance tests
  results.newPerformance = await runNewPerformanceTests(apiEndpoint, config);
  
  // Run SDK-based tests
  results.sdkTests = await runSdkBasedTests(apiEndpoint, config);
  
  return results;
}

/**
 * Run SDK-based tests
 * @param {string} apiEndpoint - API endpoint
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Test results
 */
async function runSdkBasedTests(apiEndpoint, config = {}) {
  const results = {};
  const requestId = ulid();
  
  logger.infoWithContext('Running SDK-based tests', {
    correlationId: requestId,
    apiEndpoint
  });
  
  // Create a test runner
  const testRunner = new TestRunner(apiEndpoint, config);
  
  // Run SDK-based integration tests
  try {
    logger.infoWithContext('Running SDK-based integration tests', {
      correlationId: requestId,
      testPhase: 'sdk_integration'
    });
    
    const integrationSdkTests = {
      completeAuthFlow: integrationTests.testCompleteAuthFlowWithSdk,
      componentInteractions: integrationTests.testComponentInteractionsWithSdk
    };
    
    results.integration = await testRunner.runTestSuite(integrationSdkTests, 'sdk_integration');
  } catch (error) {
    logger.errorWithContext('Error running SDK-based integration tests', {
      correlationId: requestId,
      error: error.message,
      stack: error.stack
    });
    
    results.integration = { error: error.message };
  }
  
  // Run SDK-based MCP tests
  try {
    logger.infoWithContext('Running SDK-based MCP tests', {
      correlationId: requestId,
      testPhase: 'sdk_mcp'
    });
    
    const mcpSdkTests = {
      resourcesListing: mcpTests.testMcpResourcesListingWithSdk,
      resourceRetrieval: mcpTests.testMcpResourceRetrievalWithSdk
    };
    
    results.mcp = await testRunner.runTestSuite(mcpSdkTests, 'sdk_mcp');
  } catch (error) {
    logger.errorWithContext('Error running SDK-based MCP tests', {
      correlationId: requestId,
      error: error.message,
      stack: error.stack
    });
    
    results.mcp = { error: error.message };
  }
  
  // Run SDK-based session management tests
  try {
    logger.infoWithContext('Running SDK-based session management tests', {
      correlationId: requestId,
      testPhase: 'sdk_session_management'
    });
    
    const sessionSdkTests = {
      sessionManagement: sessionManagementTests.testSessionManagementWithSdk,
      multipleSessions: sessionManagementTests.testMultipleSessionsWithSdk
    };
    
    results.sessionManagement = await testRunner.runTestSuite(sessionSdkTests, 'sdk_session_management');
  } catch (error) {
    logger.errorWithContext('Error running SDK-based session management tests', {
      correlationId: requestId,
      error: error.message,
      stack: error.stack
    });
    
    results.sessionManagement = { error: error.message };
  }
  
  return results;
}

/**
 * Run a specific test suite
 * @param {string} apiEndpoint - API endpoint URL
 * @param {string} suiteName - Name of the test suite to run
 * @returns {Promise<Object>} - Test results
 */
async function runTestSuite(apiEndpoint, suiteName) {
  const requestId = ulid();
  const logContext = {
    requestId,
    suiteName,
    apiEndpoint,
    component: "TestSystem"
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
      sdk: runSdkBasedTests,
      all: runAllNewTests
    };
    
    const testSuiteFunction = testSuiteFunctions[suiteName];
    
    if (!testSuiteFunction) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        success: false,
        error: `Unknown test suite: ${suiteName}`
      };
    }
    
    // Run the test suite
    const results = await testSuiteFunction(apiEndpoint);
    
    logger.infoWithContext(`Test suite ${suiteName} completed`, {
      ...logContext,
      success: true,
      results
    });
    
    return {
      success: true,
      results
    };
  } catch (error) {
    logger.errorWithContext(`Error running test suite ${suiteName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run a single test from a test suite
 * @param {string} apiEndpoint - API endpoint URL
 * @param {string} suiteName - Name of the test suite
 * @param {string} testName - Name of the test to run
 * @returns {Promise<Object>} - Test results
 */
async function runSingleTest(apiEndpoint, suiteName, testName) {
  const requestId = ulid();
  const logContext = {
    requestId,
    suiteName,
    testName,
    apiEndpoint,
    component: "TestSystem"
  };
  
  logger.infoWithContext(`Running single test: ${suiteName}.${testName}`, logContext);
  
  try {
    // Get the test suite based on the suite name
    const testSuites = {
      authentication: authenticationTests,
      security: securityTests,
      performance: performanceTests,
      legacy: legacyTests,
      rateLimit: rateLimitTests,
      cruda: crudaTests,
      encoding: encodingTests,
      concurrency: concurrencyTests,
      contentType: contentTypeTests,
      idempotency: idempotencyTests,
      mcp: mcpTests,
      metrics: metricsTests,
      sessionManagement: sessionManagementTests,
      integration: integrationTests,
      newPerformance: newPerformanceTests,
      sdk: sdkTests
    };
    
    const testSuite = testSuites[suiteName];
    
    if (!testSuite) {
      logger.errorWithContext(`Unknown test suite: ${suiteName}`, logContext);
      return {
        success: false,
        error: `Unknown test suite: ${suiteName}`
      };
    }
    
    const testFunction = testSuite[testName];
    
    if (!testFunction) {
      logger.errorWithContext(`Unknown test: ${testName} in suite ${suiteName}`, logContext);
      return {
        success: false,
        error: `Unknown test: ${testName} in suite ${suiteName}`
      };
    }
    
    // Create a test runner for the single test
    const testRunner = new TestRunner(apiEndpoint);
    
    // Run the single test
    const result = await testRunner.runTest(testName, testFunction, {
      suiteName,
      moduleName: suiteName
    });
    
    logger.infoWithContext(`Test ${suiteName}.${testName} completed`, {
      ...logContext,
      success: result?.success,
      error: result?.error
    });
    
    return {
      success: true,
      testResult: result
    };
  } catch (error) {
    logger.errorWithContext(`Error running test ${suiteName}.${testName}`, {
      ...logContext,
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
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
  runSdkBasedTests,
  runAllNewTests,
  // Export the new functions
  runTestSuite,
  runSingleTest
};