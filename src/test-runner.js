// test-runner.js
const crypto = require("crypto");
const logger = require("../config/logger");

class TestRunner {
  constructor(apiEndpoint, config) {
    this.apiEndpoint = apiEndpoint;
    this.config = config;
    this.results = {
      passed: 0,
      failed: 0,
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
      } else if (result.success) {
        this.results.passed++;
        logContext.result = "passed";
        logger.infoWithContext(`Test passed: ${testName}`, {
          ...logContext,
          details: result.details || {}
        });
      } else {
        this.results.failed++;
        logContext.result = "failed";
        logger.errorWithContext(`Test failed: ${testName}`, {
          ...logContext,
          error: result.error,
          details: result.details || {}
        });
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
      this.results.failed++;
      logContext.result = "error";
      logContext.errorMessage = error.message;
      logger.errorWithContext(`Test error: ${testName}`, logContext, error);
      
      // Store test result
      this.results.testCases[testName] = {
        result: "error",
        error: error.message,
        stack: error.stack,
        duration: new Date() - new Date(logContext.startTime)
      };
      
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
        failed: this.results.failed,
        skipped: this.results.skipped,
        total: this.results.total
      }
    });
    
    return this.results;
  }
  
  async runComparativeTests() {
    const comparativeTests = require('./test-modules/comparative-tests');
    const startTime = new Date();
    
    logger.infoWithContext(`Starting comparative tests`, {
      runId: this.runId,
      startTime: startTime.toISOString()
    });
    
    // Run the comparative test
    const result = await this.runTest('testEndpointProtections', comparativeTests.testEndpointProtections);
    
    const endTime = new Date();
    const duration = endTime - startTime;
    
    logger.infoWithContext(`Comparative tests completed`, {
      runId: this.runId,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      duration,
      result: result.success ? 'PASS' : 'FAIL',
      details: result.details || {}
    });
    
    return result;
  }
  generateReport() {
    return {
      summary: {
        passed: this.results.passed,
        failed: this.results.failed,
        skipped: this.results.skipped,
        total: this.results.total,
        passRate: (this.results.passed / this.results.total * 100).toFixed(2) + '%'
      },
      testCases: this.results.testCases
    };
  }
}

module.exports = TestRunner;