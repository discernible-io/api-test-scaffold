// test-utils.js
const { ulid } = require("ulid");
// Import SDK components using the new interface
const { logger } = require('../../sdk');

/**
 * Standardized function to capture and log test results consistently
 */
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || (testData.apiEndpoint ? `${testData.apiEndpoint} (derived)` : "unknown"),
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
        endpoint: result.testInfo.endpoint,
        failureData: {
          testInfo: result.testInfo,
          testData,
          details: result.details || {}
        }
      },
      error: result.error ? { message: result.error } : new Error("Unknown error")
    });

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    // Use standardized logging format for passed tests
    logTestResult(true, testName, {
      component: "TestRunner",
      details: {
        moduleName,
        endpoint: result.testInfo.endpoint,
        testDetails: result.details || {}
      }
    });

    logger.metric("test_success", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
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
 * @param {Object} options - Fetch options
 * @returns {Promise<Object>} - Response data
 */
async function fetchWithErrorHandling(url, options = {}) {
  const requestId = ulid();
  const startTime = Date.now();
  
  try {
    logger.debug(`Fetching ${url}`, {
      component: "fetchWithErrorHandling",
      requestId,
      url,
      method: options.method || "GET"
    });

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });

    const duration = Date.now() - startTime;
    
    if (!response.ok) {
      const errorText = await response.text();
      
      logger.error(`Fetch error: ${response.status} ${response.statusText}`, {
        component: "fetchWithErrorHandling",
        requestId,
        url,
        method: options.method || "GET",
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
      method: options.method || "GET",
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
      method: options.method || "GET",
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
      apiEndpoint: "local",
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
      apiEndpoint: "local",
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
 * @param {Object} options - Additional options
 * @param {string} options.testId - Test ID
 * @param {Object} options.details - Additional details to log
 * @param {Error} options.error - Error object if test failed
 */
function logTestResult(success, testName, options = {}) {
  const {
    testId = ulid(),
    details = {},
    error = null,
    component = "TestRunner"
  } = options;
  
  const duration = options.duration || 0;
  
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

module.exports = {
  captureTestData,
  captureTestDataForReporting,
  fetchWithErrorHandling,
  runTest,
  logTestResult
};