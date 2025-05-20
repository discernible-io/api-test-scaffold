// test-utils.js
const { ulid } = require("ulid");
const logger = require("../../config/logger");
const fetch = require("node-fetch");

/**
 * Standardized function to capture and log test results consistently
 */
function captureTestData(testName, moduleName, result, testData) {
  result.testInfo = {
    testName,
    moduleName,
    timestamp: new Date().toISOString(),
    endpoint: testData.endpoint || "unknown",
  };

  if (!result.success) {
    const correlationId = ulid();
    result.testInfo.correlationId = correlationId;

    logger.error(
      `Test '${testName}' not-passed for endpoint ${result.testInfo.endpoint}`,
      {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
        correlationId,
        error: result.error,
      }
    );

    logger.info(`Test not-passed details`, {
      component: "TestRunner",
      moduleName,
      testName,
      endpoint: result.testInfo.endpoint,
      correlationId,
      failureData: JSON.stringify({
        testInfo: result.testInfo,
        error: result.error,
        testData,
        details: result.details || {},
      }),
    });

    logger.metric("test_failure", 1, {
      module: moduleName,
      test: testName,
      endpoint: result.testInfo.endpoint,
      correlation_id: correlationId,
    });
  } else {
    logger.debug(
      `Test '${testName}' passed for endpoint ${result.testInfo.endpoint}`,
      {
        component: "TestRunner",
        moduleName,
        testName,
        endpoint: result.testInfo.endpoint,
      }
    );

    logger.info(`Test passed : ${testName}`, {
      component: "TestRunner",
      moduleName,
      testName,
      details: result.details || {},
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

module.exports = {
  captureTestData,
  captureTestDataForReporting,
  fetchWithErrorHandling
};