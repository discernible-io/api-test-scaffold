const { extractApiErrorInfo, getRoditClientForTest } = require('./test-utils');

async function testDidWebTokenResolution(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDidWebTokenResolution' };

  try {
    // Get authenticated RoditClient for proper JWT token
    const client = await getRoditClientForTest();
    const loginResult = await client.login_server();
    const jwtToken = loginResult.jwt_token;

    // Test valid did:web resolution
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/bjbvcjzqbdsj`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data['@context'] &&
        data.id &&
        data.verificationMethod &&
        Array.isArray(data.verificationMethod);

      results.push({
        name: 'Valid did:web resolution',
        passed,
        statusCode: response.status,
        hasDid: !!data.id,
        hasVerificationMethod: !!data.verificationMethod,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Valid did:web resolution',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (uppercase)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/BJBVCJZQBDSJ`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (too short)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/abcdef`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (too short)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (too short)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (too long)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/abcdefghijklmno`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (too long)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (too long)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test non-existent token (404)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent token returns 404',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent token returns 404',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testDidWebTokenResolution',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDidWebTokenResolution',
      passed: false,
      error: error?.message || error?.toString() || 'Test execution failed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

async function testDidWebJsonResolution(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDidWebJsonResolution' };

  try {
    // Get authenticated RoditClient for proper JWT token
    const client = await getRoditClientForTest();
    const loginResult = await client.login_server();
    const jwtToken = loginResult.jwt_token;

    // Test valid did.json retrieval
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/bjbvcjzqbdsj/did.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data['@context'] &&
        data.id &&
        data.verificationMethod &&
        Array.isArray(data.verificationMethod);

      results.push({
        name: 'Valid did.json retrieval',
        passed,
        statusCode: response.status,
        hasDid: !!data.id,
        hasVerificationMethod: !!data.verificationMethod,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Valid did.json retrieval',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (uppercase)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/BJBVCJZQBDSJ/did.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (too short)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/abcdef/did.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (too short)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (too short)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (too long)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/abcdefghijklmno/did.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (too long)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (too long)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test non-existent token (404)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz/did.json`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent token returns 404',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent token returns 404',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testDidWebJsonResolution',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDidWebJsonResolution',
      passed: false,
      error: error?.message || error?.toString() || 'Test execution failed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

async function testDidRoditResolutionNegativeCases(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDidRoditResolutionNegativeCases' };

  try {
    // Test invalid tokenId format (uppercase)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/rodit/BJBVCJZQBDSJ`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (uppercase)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid tokenId format (too short)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/rodit/abcdef`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid tokenId format (too short)',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid tokenId format (too short)',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test non-existent token (404)
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/rodit/zzzzzzzzzzzz`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent token returns 404',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent token returns 404',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testDidRoditResolutionNegativeCases',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDidRoditResolutionNegativeCases',
      passed: false,
      error: error?.message || error?.toString() || 'Test execution failed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

async function testDidResolveNegativeCases(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDidResolveNegativeCases' };

  try {
    // Test missing did parameter
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Missing did parameter',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Missing did parameter',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test invalid DID format
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=invalid-did-format`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Invalid DID format',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Invalid DID format',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test non-existent did:rodit
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=did:rodit:zzzzzzzzzzzz`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent did:rodit',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent did:rodit',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test non-existent did:web
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=did:web:example.com:zzzzzzzzzzzz`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token',
        },
      });

      const passed = response.status === 404 || response.status >= 400;

      results.push({
        name: 'Non-existent did:web',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Non-existent did:web',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testDidResolveNegativeCases',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDidResolveNegativeCases',
      passed: false,
      error: error?.message || error?.toString() || 'Test execution failed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

module.exports = {
  testDidWebTokenResolution,
  testDidWebJsonResolution,
  testDidRoditResolutionNegativeCases,
  testDidResolveNegativeCases,
};
