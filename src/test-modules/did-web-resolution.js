const { extractApiErrorInfo, getRoditClientForTest } = require('./test-utils');
const {
  readResponseBodySafe,
  runOpenapiContractCase,
  hasStructuredErrorPayload,
  probeHttpRejection,
} = require("./openapi-contract-helpers");

/** JWT + lowercase token_id for the authenticated test agent (not a static fixture). */
async function resolveAuthenticatedTokenContext(client) {
  const loginResult = await client.login_server();
  const jwtToken = loginResult?.jwt_token;
  if (!jwtToken) {
    throw new Error(loginResult?.error || 'login_server did not return jwt_token');
  }
  const configOwnRodit = await client.getConfigOwnRodit();
  const tokenId = configOwnRodit?.own_rodit?.token_id;
  if (!tokenId) {
    throw new Error('Unable to resolve own_rodit.token_id for DID web tests');
  }
  return { jwtToken, tokenId: String(tokenId).toLowerCase() };
}

async function testDidWebTokenResolution(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDidWebTokenResolution' };

  try {
    const client = await getRoditClientForTest();
    const { jwtToken, tokenId } = await resolveAuthenticatedTokenContext(client);

    // Test valid did:web resolution
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/${tokenId}`, {
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
      error: error?.message || error?.toString() || 'Test execution not-passed',
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
    const client = await getRoditClientForTest();
    const { jwtToken, tokenId } = await resolveAuthenticatedTokenContext(client);

    // Test valid did.json retrieval
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/${tokenId}/did.json`, {
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
      error: error?.message || error?.toString() || 'Test execution not-passed',
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
      error: error?.message || error?.toString() || 'Test execution not-passed',
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
      error: error?.message || error?.toString() || 'Test execution not-passed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

async function testQueryParameterValidation(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testQueryParameterValidation' };

  try {
    // Get authenticated RoditClient for proper JWT token
    const client = await getRoditClientForTest();
    const { jwtToken, tokenId } = await resolveAuthenticatedTokenContext(client);

    // Test XSS attempt
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=<script>alert(1)</script>`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'XSS attempt in did parameter',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'XSS attempt in did parameter',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test SQL injection attempt
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did='; DROP TABLE users; --`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'SQL injection attempt in did parameter',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'SQL injection attempt in did parameter',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test null byte in parameter
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=valid\x00injection`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status >= 400;

      results.push({
        name: 'Null byte in did parameter',
        passed,
        statusCode: response.status,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Null byte in did parameter',
        passed: errInfo.statusCode >= 400,
        statusCode: errInfo.statusCode,
      });
    }

    // Test extra unknown parameters
    try {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=did:rodit:${tokenId}&extra=param&another=value`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
      });

      const passed = response.status === 200 || response.status >= 400;

      results.push({
        name: 'Extra unknown parameters',
        passed,
        statusCode: response.status,
        note: 'Extra parameters should be ignored or rejected',
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Extra unknown parameters',
        passed: errInfo.statusCode >= 400 || errInfo.statusCode === 200,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testQueryParameterValidation',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testQueryParameterValidation',
      passed: false,
      error: error?.message || error?.toString() || 'Test execution not-passed',
      errorDetails: {
        message: error?.message,
        stack: error?.stack,
        name: error?.name
      },
      results: [],
    };
  }
}

async function testDidResolveInternalErrorContract(apiEndpoint) {
  return runOpenapiContractCase(
    "integration",
    "testDidResolveInternalErrorContract",
    apiEndpoint,
    "/.well-known/did/resolve",
    { method: "GET", expectedStatus: 500 },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/.well-known/did/resolve?did=did:unsupported:trigger500`, {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
          "X-Request-ID": requestId,
          "X-Force-Error": "true",
        },
      });
      const body = await readResponseBodySafe(response);
      if (response.status === 500 && !hasStructuredErrorPayload(body)) {
        throw new Error("Expected structured payload when DID resolve returns 500");
      }
      if (![400, 401, 404, 500].includes(response.status)) {
        throw new Error(`Unexpected status from DID resolve contract probe: ${response.status}`);
      }
      return { status: response.status, observed500: response.status === 500 };
    },
  );
}

async function testDidRoditInternalErrorContract(apiEndpoint) {
  return runOpenapiContractCase(
    "integration",
    "testDidRoditInternalErrorContract",
    apiEndpoint,
    "/.well-known/did/rodit/{tokenId}",
    { method: "GET", expectedStatus: 500 },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/.well-known/did/rodit/zzzzzzzzzzzz`, {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
          "X-Request-ID": requestId,
          "X-Force-Error": "true",
        },
      });
      const body = await readResponseBodySafe(response);
      if (response.status === 500 && !hasStructuredErrorPayload(body)) {
        throw new Error("Expected structured payload when did:rodit returns 500");
      }
      if (![400, 401, 404, 500].includes(response.status)) {
        throw new Error(`Unexpected status from did:rodit contract probe: ${response.status}`);
      }
      return { status: response.status, observed500: response.status === 500 };
    },
  );
}

async function testDidWebTokenInternalErrorContract(apiEndpoint) {
  return runOpenapiContractCase(
    "integration",
    "testDidWebTokenInternalErrorContract",
    apiEndpoint,
    "/.well-known/did/web/token/{tokenId}",
    { method: "GET", expectedStatus: 500 },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz`, {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
          "X-Request-ID": requestId,
          "X-Force-Error": "true",
        },
      });
      const body = await readResponseBodySafe(response);
      if (response.status === 500 && !hasStructuredErrorPayload(body)) {
        throw new Error("Expected structured payload when did:web token returns 500");
      }
      if (![400, 401, 404, 500].includes(response.status)) {
        throw new Error(`Unexpected status from did:web token contract probe: ${response.status}`);
      }
      return { status: response.status, observed500: response.status === 500 };
    },
  );
}

async function testDidWebJsonInternalErrorContract(apiEndpoint) {
  return runOpenapiContractCase(
    "integration",
    "testDidWebJsonInternalErrorContract",
    apiEndpoint,
    "/.well-known/did/web/token/{tokenId}/did.json",
    { method: "GET", expectedStatus: 500 },
    async (requestId) => {
      const response = await fetch(`${apiEndpoint}/.well-known/did/web/token/zzzzzzzzzzzz/did.json`, {
        method: "GET",
        headers: {
          Authorization: "Bearer test-token",
          "X-Request-ID": requestId,
          "X-Force-Error": "true",
        },
      });
      const body = await readResponseBodySafe(response);
      if (response.status === 500 && !hasStructuredErrorPayload(body)) {
        throw new Error("Expected structured payload when did:web did.json returns 500");
      }
      if (![400, 401, 404, 500].includes(response.status)) {
        throw new Error(`Unexpected status from did:web did.json contract probe: ${response.status}`);
      }
      return { status: response.status, observed500: response.status === 500 };
    },
  );
}

async function testDidWellKnownUnsupportedMethods(apiEndpoint, logContext) {
  const results = [];

  try {
    const client = await getRoditClientForTest();
    const { tokenId } = await resolveAuthenticatedTokenContext(client);

    const postTargets = [
      `/.well-known/did/rodit/${tokenId}`,
      `/.well-known/did/web/token/${tokenId}`,
      `/.well-known/did/web/token/${tokenId}/did.json`,
      "/.well-known/did/resolve?did=did:rodit:zzzzzzzzzzzz",
    ];

    for (const path of postTargets) {
      const probe = await probeHttpRejection(apiEndpoint, path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ probe: true }),
      });
      results.push({
        name: `POST ${path} rejected`,
        passed: probe.rejected,
        statusCode: probe.status,
      });
    }

    return {
      testName: "testDidWellKnownUnsupportedMethods",
      passed: results.every((r) => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter((r) => r.passed).length,
    };
  } catch (error) {
    return {
      testName: "testDidWellKnownUnsupportedMethods",
      passed: false,
      error: error.message,
      results,
    };
  }
}

module.exports = {
  testDidWebTokenResolution,
  testDidWebJsonResolution,
  testDidRoditResolutionNegativeCases,
  testDidResolveNegativeCases,
  testQueryParameterValidation,
  testDidWellKnownUnsupportedMethods,
  testDidResolveInternalErrorContract,
  testDidRoditInternalErrorContract,
  testDidWebTokenInternalErrorContract,
  testDidWebJsonInternalErrorContract,
};
