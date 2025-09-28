// test-utils.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger, RoditClient } = require('../../sdk');

/**
 * Standardized function to capture and log test results consistently
 */
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    apiEndpoint: testData.endpoint || (testData.ctd_api_ep ? `${testData.ctd_api_ep} (derived)` : "unknown"),
  };

  if (!result.success) {
    const correlationId = ulid();
    result.testInfo.correlationId = correlationId;

    // Use standardized logging format for not-passed tests
    logTestResult(false, testName, {
      testId: correlationId,
      component: "TestRunner",
      details: {
        moduleName,
        apiEndpoint: result.testInfo.endpoint,
        failureData: {
          testInfo: result.testInfo,
          testData,
          details: result.details || {}
        }
      },
      error: result.error || "Unknown error"
    });

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      apiEndpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    // Use standardized logging format for passed tests
    logTestResult(true, testName, {
      component: "TestRunner",
      details: {
        moduleName,
        apiEndpoint: result.testInfo.endpoint,
        testDetails: result.details || {}
      }
    });

    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      apiEndpoint: result.testInfo.endpoint,
    });
  }

  return result;
}

/**
 * Capture test data for reporting and analysis
 * @param {string} moduleName - Name of test module
 * @param {string} testName - Name of test
 * @param {string} operation - Operation being performed
 * @param {Object} data - Data to capture
 */
function captureTestDataForReporting(moduleName, testName, operation, data) {
  // Add timestamp and identifiers
  const capturedData = {
    timestamp: new Date().toISOString(),
    moduleName,
    testName,
    operation,
    ...data
  };

  // Log the captured data
  logger.debug(`Test data captured: ${moduleName}.${testName}.${operation}`, capturedData);
  
  return capturedData;
}

/**
 * Fetch with error handling for API calls
 * @param {string} url - URL to fetch
 * @param {Object} testutils - Fetch testutils
 * @returns {Promise<Object>} - Response data
 */
async function fetchWithErrorHandling(url, testutils = {}) {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    logger.debug(`Fetching ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET"
    });

    const response = await fetch(url, {
      ...testutils,
      headers: {
        "Content-Type": "application/json",
        ...testutils.headers
      }
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      
      logger.error(`Fetch error: ${response.status} ${response.statusText}`, {
        component: "fetchWithErrorHandling",
        requestId,
        url,
        method: testutils.method || "GET",
        status: response.status,
        statusText: response.statusText,
        duration,
        errorText
      });
      
      throw new Error(`HTTP error ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    logger.debug(`Fetch successful: ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET",
      status: response.status,
      duration
    });
    
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logger.error(`Fetch exception: ${error.message}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: testutils.method || "GET",
      duration,
      error: error.message,
      stack: error.stack
    });
    
    throw error;
  }
}

/**
 * Run a single test and record the result
 * @param {Object} results - Results object to update
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Test function to execute
 * @returns {Promise<Object>} - Test result
 */
async function runTest(results, testName, testFn) {
  const testId = ulid();
  const startTime = new Date().toISOString();
  const startTimeMs = Date.now();
  
  // Add sdk- prefix to test names for better identification
  const displayTestName = testName.startsWith('sdk-') ? testName : `sdk-${testName}`;
  
  // Use INFO level for test execution to ensure visibility in console logs
  logger.info(`Running test: ${displayTestName}`, {
    component: "TestRunner",
    testId,
    testName: displayTestName,
    startTime,
    phase: "start"
  });
  
  try {
    await testFn();
    
    const endTimeMs = Date.now();
    const duration = endTimeMs - startTimeMs;
    
    const result = {
      id: testId,
      name: displayTestName,
      success: true,
      startTime,
      endTime: new Date().toISOString(),
      duration,
      result: "passed" // Explicitly set result for consistency
    };
    
    results.tests.push(result);
    
    // Use captureTestData for consistent test result reporting
    return captureTestData(displayTestName, "sdk", result, {
      ctd_api_ep: "local",
      testId,
      duration
    });
  } catch (error) {
    const endTimeMs = Date.now();
    const duration = endTimeMs - startTimeMs;
    
    const result = {
      id: testId,
      name: displayTestName,
      success: false,
      startTime,
      endTime: new Date().toISOString(),
      duration,
      error: error.message,
      stack: error.stack,
      result: "not-passed" // Explicitly set result for consistency
    };
    
    results.tests.push(result);
    results.errors.push({
      test: displayTestName,
      error: error.message,
      stack: error.stack
    });
    
    // Use captureTestData for consistent test result reporting
    return captureTestData(displayTestName, "sdk", result, {
      ctd_api_ep: "local",
      testId,
      duration,
      error: error.message,
      stack: error.stack
    });
    
    // Note: captureTestData already handles proper logging and metrics
  }
}

/**
 * Log test result with standardized format
 * @param {boolean} success - Whether the test passed
 * @param {string} testName - Name of the test
 * @param {Object} testutils - Additional testutils
 * @param {string} testutils.testId - Test ID
 * @param {Object} testutils.details - Additional details to log
 * @param {Error} testutils.error - Error object if test failed
 */
function logTestResult(success, testName, testutils = {}) {
  const {
    testId = ulid(),
    details = {},
    error = null,
    component = "TestRunner"
  } = testutils;
  
  const duration = testutils.duration || 0;
  
  if (success) {
    // Log passed test with consistent format - using INFO level for visibility
    logger.info(`Test passed: ${testName}`, {
      component,
      testId,
      testName,
      duration,
      result: "passed",
      ...details
    });
    
    // Also log at debug level for detailed logs
    logger.debug(`Test details: ${testName}`, {
      component,
      testId,
      testName,
      duration,
      result: "passed",
      ...details
    });
  } else {
    // Log not-passed test with consistent format
    logger.info(`Test not-passed: ${testName}`, {
      component,
      testId,
      testName,
      error: error ? error.message : "Unknown error",
      result: "not-passed",
      duration,
      ...details
    });
    
    // Also log at error level for alerting
    logger.error(`Test error details: ${testName}`, {
      component,
      testId,
      testName,
      error: error ? error.message : "Unknown error",
      stack: error ? error.stack : null,
      result: "not-passed",
      duration,
      ...details
    });
  }
  
  return {
    success,
    result: success ? "passed" : "not-passed",
    testId,
    testName,
    details,
    error: error ? error.message : null
  };
}

/**
 * Get shared RoditClient instance or create a new one
 * This function tries to access the shared roditClient from app.locals if available,
 * otherwise creates a new instance and initializes it.
 * @param {Object} testutils - Options object
 * @param {Object} testutils.app - Express app instance with roditClient in app.locals
 * @returns {Promise<RoditClient>} Initialized RoditClient instance
 */
async function getSharedRoditClient(testutils = {}) {
    logger.debug('Using shared RoditClient from app.locals', {
      component: 'test-utils',
      method: 'getSharedRoditClient',
      source: 'app.locals'
    });
    return testutils.app.locals.roditClient;
}

/**
 * Create a test instance of RoditClient with independent state
 * This is useful for testing multiple concurrent sessions
 * @param {Object} testutils - Options object
 * @returns {Promise<RoditClient>} Initialized test RoditClient instance
 */
async function createTestRoditClient(testutils = {}) {
  logger.debug('Creating test RoditClient instance', {
    component: 'test-utils',
    method: 'createTestRoditClient',
    testutils
  });
  
  return await RoditClient.createTestInstance(testutils);
}

module.exports = {
  captureTestData,
  captureTestDataForReporting,
  fetchWithErrorHandling,
  runTest,
  logTestResult,
  getSharedRoditClient,
  createTestRoditClient
};