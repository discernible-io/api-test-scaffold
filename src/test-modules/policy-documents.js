const { extractApiErrorInfo } = require('./test-utils');
const { probeHttpRejection } = require('./openapi-contract-helpers');

async function testPolicyDocuments(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testPolicyDocuments' };

  const policyEndpoints = [
    {
      path: '/.well-known/terms-of-service',
      name: 'Terms of Service',
    },
    {
      path: '/.well-known/privacy-policy',
      name: 'Privacy Policy',
    },
    {
      path: '/.well-known/data-retention',
      name: 'Data Retention Policy',
    },
    {
      path: '/.well-known/why-identyclaw',
      name: 'Why IdentityClaw',
    },
    {
      path: '/.well-known/did-method-rodit',
      name: 'did:rodit method specification',
    },
  ];

  try {
    for (const endpoint of policyEndpoints) {
      // Test markdown content negotiation
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
          headers: {
            'Accept': 'text/markdown',
          },
        });

        const content = await response.text();
        const passed =
          response.status === 200 &&
          content &&
          content.length > 0 &&
          (response.headers.get('content-type')?.includes('text/markdown') ||
            response.headers.get('content-type')?.includes('text/plain'));

        results.push({
          name: `${endpoint.name} - Markdown content negotiation`,
          passed,
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: content.length,
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `${endpoint.name} - Markdown content negotiation`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }

      // Test HTML content negotiation
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
          headers: {
            'Accept': 'text/html',
          },
        });

        const content = await response.text();
        const passed =
          response.status === 200 &&
          content &&
          content.length > 0 &&
          response.headers.get('content-type')?.includes('text/html');

        results.push({
          name: `${endpoint.name} - HTML content negotiation`,
          passed,
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: content.length,
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `${endpoint.name} - HTML content negotiation`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }

      // Test default content type (should be markdown)
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
        });

        const content = await response.text();
        const passed =
          response.status === 200 &&
          content &&
          content.length > 0;

        results.push({
          name: `${endpoint.name} - Default content type`,
          passed,
          statusCode: response.status,
          contentType: response.headers.get('content-type'),
          contentLength: content.length,
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `${endpoint.name} - Default content type`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }

      // Test server error scenario (simulate by checking response structure)
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
        });

        const passed = response.status === 200;

        results.push({
          name: `${endpoint.name} - Response status validation`,
          passed,
          statusCode: response.status,
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `${endpoint.name} - Response status validation`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }
    }

    // /.well-known/data-deletion: HTML by default; JSON when Accept is application/json (not markdown).
    const deletionPath = '/.well-known/data-deletion';
    try {
      const htmlResp = await fetch(`${apiEndpoint}${deletionPath}`, {
        method: 'GET',
        headers: { Accept: 'text/html' },
      });
      const htmlBody = await htmlResp.text();
      results.push({
        name: 'Data Deletion - HTML content negotiation',
        passed:
          htmlResp.status === 200 &&
          htmlBody.length > 0 &&
          (htmlResp.headers.get('content-type') || '').includes('text/html'),
        statusCode: htmlResp.status,
        contentType: htmlResp.headers.get('content-type'),
        contentLength: htmlBody.length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Data Deletion - HTML content negotiation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    try {
      const jsonResp = await fetch(`${apiEndpoint}${deletionPath}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const jsonCt = jsonResp.headers.get('content-type') || '';
      let jsonOk = false;
      if (jsonResp.status === 200 && jsonCt.includes('application/json')) {
        try {
          const parsed = JSON.parse(await jsonResp.text());
          jsonOk = parsed != null && typeof parsed === 'object';
        } catch (_) {
          jsonOk = false;
        }
      }
      results.push({
        name: 'Data Deletion - JSON content negotiation',
        passed: jsonOk,
        statusCode: jsonResp.status,
        contentType: jsonCt,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Data Deletion - JSON content negotiation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    try {
      const defaultResp = await fetch(`${apiEndpoint}${deletionPath}`, { method: 'GET' });
      const defaultBody = await defaultResp.text();
      results.push({
        name: 'Data Deletion - Default content type',
        passed: defaultResp.status === 200 && defaultBody.length > 0,
        statusCode: defaultResp.status,
        contentType: defaultResp.headers.get('content-type'),
        contentLength: defaultBody.length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Data Deletion - Default content type',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testPolicyDocuments',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testPolicyDocuments',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testPolicyDocumentContent(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testPolicyDocumentContent' };

  const policyEndpoints = [
    {
      path: '/.well-known/terms-of-service',
      name: 'Terms of Service',
      expectedKeywords: ['terms', 'service', 'agreement', 'user'],
    },
    {
      path: '/.well-known/privacy-policy',
      name: 'Privacy Policy',
      expectedKeywords: ['privacy', 'data', 'personal', 'collect'],
    },
    {
      path: '/.well-known/data-retention',
      name: 'Data Retention Policy',
      expectedKeywords: ['retention', 'data', 'delete', 'period'],
    },
    {
      path: '/.well-known/why-identyclaw',
      name: 'Why IdentityClaw',
      expectedKeywords: ['identyclaw', 'agent', 'identity', 'rodit'],
    },
    {
      path: '/.well-known/data-deletion',
      name: 'Data Deletion',
      accept: 'text/html',
      expectedKeywords: ['delete', 'data', 'identyclaw', 'app'],
    },
  ];

  try {
    for (const endpoint of policyEndpoints) {
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
          headers: {
            Accept: endpoint.accept || 'text/markdown',
          },
        });

        const content = (await response.text()).toLowerCase();
        const hasKeywords = endpoint.expectedKeywords.some(keyword =>
          content.includes(keyword.toLowerCase())
        );

        const passed =
          response.status === 200 &&
          content.length > 100 &&
          hasKeywords;

        results.push({
          name: `${endpoint.name} - Content validation`,
          passed,
          statusCode: response.status,
          contentLength: content.length,
          hasExpectedKeywords: hasKeywords,
          foundKeywords: endpoint.expectedKeywords.filter(kw =>
            content.includes(kw.toLowerCase())
          ),
        });
      } catch (error) {
        const errInfo = extractApiErrorInfo(error);
        results.push({
          name: `${endpoint.name} - Content validation`,
          passed: false,
          error: error.message,
          statusCode: errInfo.statusCode,
        });
      }
    }

    return {
      testName: 'testPolicyDocumentContent',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testPolicyDocumentContent',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testPolicyDocumentsUnsupportedMethods(apiEndpoint, logContext) {
  const results = [];
  const policyPaths = [
    '/.well-known/terms-of-service',
    '/.well-known/privacy-policy',
    '/.well-known/data-retention',
    '/.well-known/why-identyclaw',
    '/.well-known/did-method-rodit',
  ];

  try {
    for (const path of policyPaths) {
      const postProbe = await probeHttpRejection(apiEndpoint, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probe: true }),
      });
      results.push({
        name: `${path} rejects POST`,
        passed: postProbe.rejected,
        statusCode: postProbe.status,
      });

      const putProbe = await probeHttpRejection(apiEndpoint, path, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'probe',
      });
      results.push({
        name: `${path} rejects PUT`,
        passed: putProbe.rejected,
        statusCode: putProbe.status,
      });
    }

    // Spec: POST /.well-known/data-deletion → 405 (submissions not accepted).
    const deletionPost = await probeHttpRejection(
      apiEndpoint,
      '/.well-known/data-deletion',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ probe: true }),
      },
    );
    results.push({
      name: '/.well-known/data-deletion POST returns 405',
      passed: deletionPost.status === 405,
      statusCode: deletionPost.status,
    });

    const deletionPut = await probeHttpRejection(
      apiEndpoint,
      '/.well-known/data-deletion',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'text/plain' },
        body: 'probe',
      },
    );
    results.push({
      name: '/.well-known/data-deletion rejects PUT',
      passed: deletionPut.rejected,
      statusCode: deletionPut.status,
    });

    return {
      testName: 'testPolicyDocumentsUnsupportedMethods',
      passed: results.every((r) => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter((r) => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testPolicyDocumentsUnsupportedMethods',
      passed: false,
      error: error.message,
      results,
    };
  }
}

module.exports = {
  testPolicyDocuments,
  testPolicyDocumentContent,
  testPolicyDocumentsUnsupportedMethods,
};
