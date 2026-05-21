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
  ];

  try {
    for (const endpoint of policyEndpoints) {
      try {
        const response = await fetch(`${apiEndpoint}${endpoint.path}`, {
          method: 'GET',
          headers: {
            'Accept': 'text/markdown',
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
