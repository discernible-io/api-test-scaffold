const { extractApiErrorInfo } = require('./test-utils');

async function testSwaggerJsonSchema(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testSwaggerJsonSchema' };

  try {
    // Test swagger.json endpoint
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data &&
        typeof data === 'object' &&
        (data.openapi || data.swagger) &&
        data.info &&
        data.paths;

      results.push({
        name: 'Retrieve swagger.json schema',
        passed,
        statusCode: response.status,
        hasOpenApiVersion: !!(data.openapi || data.swagger),
        hasInfo: !!data.info,
        hasPaths: !!data.paths,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Retrieve swagger.json schema',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test schema structure validation
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const hasRequiredFields =
        data.info &&
        data.info.title &&
        data.info.version &&
        data.paths &&
        typeof data.paths === 'object';

      const passed = response.status === 200 && hasRequiredFields;

      results.push({
        name: 'Schema structure validation',
        passed,
        statusCode: response.status,
        hasTitle: !!data.info?.title,
        hasVersion: !!data.info?.version,
        pathCount: Object.keys(data.paths || {}).length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Schema structure validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test schema components validation
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const hasComponents = data.components && typeof data.components === 'object';
      const hasSchemas = data.components?.schemas && typeof data.components.schemas === 'object';

      const passed = response.status === 200 && (hasComponents || data.definitions);

      results.push({
        name: 'Schema components validation',
        passed,
        statusCode: response.status,
        hasComponents,
        hasSchemas,
        schemaCount: Object.keys(data.components?.schemas || {}).length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Schema components validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test content type validation
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const contentType = response.headers.get('content-type');
      const passed =
        response.status === 200 &&
        contentType &&
        contentType.includes('application/json');

      results.push({
        name: 'Content-Type validation',
        passed,
        statusCode: response.status,
        contentType,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Content-Type validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testSwaggerJsonSchema',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testSwaggerJsonSchema',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testOpenApiJsonSchema(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testOpenApiJsonSchema' };

  try {
    // Test openapi.json endpoint
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data &&
        typeof data === 'object' &&
        data.openapi &&
        data.info &&
        data.paths;

      results.push({
        name: 'Retrieve openapi.json schema',
        passed,
        statusCode: response.status,
        hasOpenApiVersion: !!data.openapi,
        hasInfo: !!data.info,
        hasPaths: !!data.paths,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Retrieve openapi.json schema',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test OpenAPI version validation
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const isValidVersion = data.openapi && data.openapi.startsWith('3.');

      const passed = response.status === 200 && isValidVersion;

      results.push({
        name: 'OpenAPI version validation',
        passed,
        statusCode: response.status,
        openApiVersion: data.openapi,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'OpenAPI version validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test schema completeness
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const pathCount = Object.keys(data.paths || {}).length;
      const schemaCount = Object.keys(data.components?.schemas || {}).length;

      const passed =
        response.status === 200 &&
        pathCount > 0 &&
        schemaCount > 0;

      results.push({
        name: 'Schema completeness validation',
        passed,
        statusCode: response.status,
        pathCount,
        schemaCount,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Schema completeness validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test error response schema
    try {
      const response = await fetch(`${apiEndpoint}/openapi.json`, {
        method: 'GET',
      });

      const data = await response.json();
      const hasErrorSchema = data.components?.schemas?.ErrorResponse !== undefined;

      const passed = response.status === 200 && hasErrorSchema;

      results.push({
        name: 'Error response schema validation',
        passed,
        statusCode: response.status,
        hasErrorSchema,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Error response schema validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testOpenApiJsonSchema',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testOpenApiJsonSchema',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testApiV1OpenApiRedirect(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testApiV1OpenApiRedirect' };

  try {
    // Test redirect behavior
    try {
      const response = await fetch(`${apiEndpoint}/api/v1/openapi.json`, {
        method: 'GET',
        redirect: 'manual',
      });

      const passed =
        response.status === 301 ||
        response.status === 302 ||
        response.status === 307 ||
        response.status === 308;

      results.push({
        name: 'Redirect to /openapi.json',
        passed,
        statusCode: response.status,
        location: response.headers.get('location'),
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Redirect to /openapi.json',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test following redirect
    try {
      const response = await fetch(`${apiEndpoint}/api/v1/openapi.json`, {
        method: 'GET',
        redirect: 'follow',
      });

      const data = await response.json();
      const passed =
        response.status === 200 &&
        data &&
        (data.openapi || data.swagger);

      results.push({
        name: 'Follow redirect to schema',
        passed,
        statusCode: response.status,
        hasSchema: !!(data.openapi || data.swagger),
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Follow redirect to schema',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testApiV1OpenApiRedirect',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testApiV1OpenApiRedirect',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

async function testDocsEndpoint(apiEndpoint, logContext) {
  const results = [];
  const context = { ...logContext, testName: 'testDocsEndpoint' };

  try {
    // Test docs HTML endpoint
    try {
      const response = await fetch(`${apiEndpoint}/docs`, {
        method: 'GET',
      });

      const html = await response.text();
      const passed =
        response.status === 200 &&
        html &&
        html.length > 0 &&
        response.headers.get('content-type')?.includes('text/html');

      results.push({
        name: 'Retrieve HTML documentation',
        passed,
        statusCode: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: html.length,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Retrieve HTML documentation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    // Test Swagger UI presence
    try {
      const response = await fetch(`${apiEndpoint}/docs`, {
        method: 'GET',
      });

      const html = await response.text();
      const hasSwaggerUI =
        html.includes('swagger') ||
        html.includes('Swagger') ||
        html.includes('swagger-ui');

      const passed = response.status === 200 && hasSwaggerUI;

      results.push({
        name: 'Swagger UI presence validation',
        passed,
        statusCode: response.status,
        hasSwaggerUI,
      });
    } catch (error) {
      const errInfo = extractApiErrorInfo(error);
      results.push({
        name: 'Swagger UI presence validation',
        passed: false,
        error: error.message,
        statusCode: errInfo.statusCode,
      });
    }

    return {
      testName: 'testDocsEndpoint',
      passed: results.every(r => r.passed),
      results,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
    };
  } catch (error) {
    return {
      testName: 'testDocsEndpoint',
      passed: false,
      error: error.message,
      results: [],
    };
  }
}

module.exports = {
  testSwaggerJsonSchema,
  testOpenApiJsonSchema,
  testApiV1OpenApiRedirect,
  testDocsEndpoint,
};
