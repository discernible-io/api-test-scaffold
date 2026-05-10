#!/usr/bin/env node
/**
 * Coverage Matrix Generator
 * 
 * Parses target-swagger.json and test modules to produce a living map of:
 * - Each (path, method) → list of test functions that touch it
 * - Coverage status: covered-positive / covered-negative / both / gap
 * - Error responses defined in Swagger vs assertions in tests
 * 
 * Output: CSV and JSON artifacts for CI and dashboards
 */

const fs = require('fs');
const path = require('path');

// Load Swagger spec
function loadSwagger(swaggerPath) {
  const content = fs.readFileSync(swaggerPath, 'utf-8');
  return JSON.parse(content);
}

// Extract all (path, method) pairs and their error responses from Swagger
function extractSwaggerEndpoints(swagger) {
  const endpoints = [];
  
  if (!swagger.paths) {
    return endpoints;
  }

  for (const [pathKey, pathItem] of Object.entries(swagger.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
        continue;
      }

      const responses = operation.responses || {};
      const errorResponses = {};
      
      for (const [statusCode, response] of Object.entries(responses)) {
        const code = parseInt(statusCode);
        if (code >= 400) {
          errorResponses[statusCode] = {
            description: response.description || '',
            hasErrorSchema: !!response.content?.['application/json']?.schema
          };
        }
      }

      endpoints.push({
        path: pathKey,
        method: method.toUpperCase(),
        operationId: operation.operationId || `${method.toUpperCase()}_${pathKey}`,
        summary: operation.summary || '',
        security: operation.security || [],
        errorResponses,
        tags: operation.tags || []
      });
    }
  }

  return endpoints;
}

// Scan test modules for references to endpoints
function scanTestModules(testModulesDir) {
  const testMap = {}; // { "path:method" => { positive: [], negative: [], inconclusive: [] } }
  
  if (!fs.existsSync(testModulesDir)) {
    return testMap;
  }

  const files = fs.readdirSync(testModulesDir).filter(f => f.endsWith('.js'));

  for (const file of files) {
    const filePath = path.join(testModulesDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    
    // Extract test function names and their descriptions
    const testFunctions = extractTestFunctions(content);
    
    // Look for endpoint references (simple heuristic: URL patterns in test code)
    const endpointRefs = extractEndpointReferences(content);
    
    for (const ref of endpointRefs) {
      const key = `${ref.method}:${ref.path}`;
      if (!testMap[key]) {
        testMap[key] = { positive: [], negative: [], inconclusive: [] };
      }
      
      // Categorize based on test context
      const category = detectTestCategory(content, ref.testName);
      testMap[key][category].push({
        testName: ref.testName,
        module: file,
        line: ref.line
      });
    }
  }

  return testMap;
}

// Extract test function definitions
function extractTestFunctions(content) {
  const functions = [];
  const testRegex = /(?:async\s+)?function\s+(test\w+)\s*\(|const\s+(test\w+)\s*=\s*(?:async\s*)?\(/g;
  let match;
  
  while ((match = testRegex.exec(content)) !== null) {
    functions.push(match[1] || match[2]);
  }
  
  return functions;
}

// Extract endpoint references from test code
function extractEndpointReferences(content) {
  const refs = [];
  
  // Pattern 1: client.request('METHOD', '/path/...')
  const pattern1 = /client\.request\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH|HEAD)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi;
  let match;
  while ((match = pattern1.exec(content)) !== null) {
    refs.push({
      path: match[2],
      method: match[1].toUpperCase(),
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 2: fetch(..., { method: 'METHOD' })
  const pattern2 = /fetch\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{\s*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH|HEAD)['"`]/gi;
  while ((match = pattern2.exec(content)) !== null) {
    refs.push({
      path: match[1],
      method: match[2].toUpperCase(),
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 3: Explicit method calls like client.request('GET', '/path')
  const pattern3 = /await\s+client\.request\s*\(\s*['"`](GET|POST|PUT|DELETE|PATCH|HEAD)['"`]\s*,\s*['"`]([^'"`]+)['"`]/gi;
  while ((match = pattern3.exec(content)) !== null) {
    refs.push({
      path: match[2],
      method: match[1].toUpperCase(),
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 4: fetchDirect(api_ep, '/path', { method: 'METHOD' })
  const pattern4 = /fetchDirect\s*\(\s*[^,]+\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*\{\s*method\s*:\s*['"`](GET|POST|PUT|DELETE|PATCH|HEAD)['"`]/gi;
  while ((match = pattern4.exec(content)) !== null) {
    refs.push({
      path: match[1],
      method: match[2].toUpperCase(),
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 5: fetchDirect with default GET method (no method specified)
  const pattern5 = /fetchDirect\s*\(\s*[^,]+\s*,\s*['"`]([^'"`]+)['"`]\s*,\s*\{\s*(?!method)/gi;
  while ((match = pattern5.exec(content)) !== null) {
    refs.push({
      path: match[1],
      method: 'GET',
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 6: Template literals with ${variable} - normalize to {param}
  const pattern6 = /['"`]([^'"`]*\$\{[^}]+\}[^'"`]*)['"`]/gi;
  while ((match = pattern6.exec(content)) !== null) {
    // Replace ${variable} with {variable}
    const normalizedPath = match[1].replace(/\$\{([^}]+)\}/g, '{$1}');
    refs.push({
      path: normalizedPath,
      method: 'GET', // Default to GET if not specified
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  // Pattern 7: Paths with encodeURIComponent - look for /api/mcp/resource/ pattern
  const pattern7 = /\/api\/mcp\/resource\/\$\{[^}]+\}/gi;
  while ((match = pattern7.exec(content)) !== null) {
    refs.push({
      path: '/api/mcp/resource/{uri}',
      method: 'GET',
      testName: 'unknown',
      line: content.substring(0, match.index).split('\n').length
    });
  }
  
  return refs;
}

// Detect if test is positive, negative, or inconclusive
function detectTestCategory(content, testName) {
  // Simple heuristic: look for keywords in surrounding context
  if (content.includes('negative') || content.includes('invalid') || content.includes('error')) {
    return 'negative';
  }
  if (content.includes('inconclusive') || content.includes('optional')) {
    return 'inconclusive';
  }
  return 'positive';
}

// Generate coverage matrix
function generateCoverageMatrix(swaggerEndpoints, testMap) {
  const matrix = [];
  
  for (const endpoint of swaggerEndpoints) {
    const key = `${endpoint.method}:${endpoint.path}`;
    const tests = testMap[key] || { positive: [], negative: [], inconclusive: [] };
    
    let coverage = 'gap';
    if (tests.positive.length > 0 && tests.negative.length > 0) {
      coverage = 'both';
    } else if (tests.positive.length > 0) {
      coverage = 'covered-positive';
    } else if (tests.negative.length > 0) {
      coverage = 'covered-negative';
    }
    
    const errorResponseCount = Object.keys(endpoint.errorResponses).length;
    const errorAssertions = tests.negative.length;
    
    matrix.push({
      path: endpoint.path,
      method: endpoint.method,
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      coverage,
      positiveTests: tests.positive.length,
      negativeTests: tests.negative.length,
      inconclusiveTests: tests.inconclusive.length,
      totalTests: tests.positive.length + tests.negative.length + tests.inconclusive.length,
      definedErrorResponses: errorResponseCount,
      errorAssertions,
      requiresAuth: endpoint.security.length > 0,
      tags: endpoint.tags.join(',')
    });
  }
  
  return matrix.sort((a, b) => {
    // Sort by coverage status (gaps first), then by path
    const coverageOrder = { gap: 0, 'covered-positive': 1, 'covered-negative': 2, both: 3 };
    const diff = coverageOrder[a.coverage] - coverageOrder[b.coverage];
    return diff !== 0 ? diff : a.path.localeCompare(b.path);
  });
}

// Generate CSV output
function generateCSV(matrix) {
  const headers = [
    'Path',
    'Method',
    'OperationId',
    'Summary',
    'Coverage',
    'Positive Tests',
    'Negative Tests',
    'Inconclusive Tests',
    'Total Tests',
    'Defined Error Responses',
    'Error Assertions',
    'Requires Auth',
    'Tags'
  ];
  
  const rows = matrix.map(row => [
    row.path,
    row.method,
    row.operationId,
    row.summary,
    row.coverage,
    row.positiveTests,
    row.negativeTests,
    row.inconclusiveTests,
    row.totalTests,
    row.definedErrorResponses,
    row.errorAssertions,
    row.requiresAuth ? 'Yes' : 'No',
    row.tags
  ]);
  
  const csv = [
    headers.map(h => `"${h}"`).join(','),
    ...rows.map(r => r.map(v => `"${v}"`).join(','))
  ].join('\n');
  
  return csv;
}

// Generate markdown summary
function generateMarkdownSummary(matrix) {
  const gapCount = matrix.filter(r => r.coverage === 'gap').length;
  const coveredPositiveCount = matrix.filter(r => r.coverage === 'covered-positive').length;
  const coveredNegativeCount = matrix.filter(r => r.coverage === 'covered-negative').length;
  const bothCount = matrix.filter(r => r.coverage === 'both').length;
  const totalEndpoints = matrix.length;
  
  const coveragePercentage = ((bothCount + coveredPositiveCount + coveredNegativeCount) / totalEndpoints * 100).toFixed(1);
  
  let md = '# Test Coverage Matrix Summary\n\n';
  md += `**Generated**: ${new Date().toISOString()}\n\n`;
  md += '## Coverage Statistics\n\n';
  md += `- **Total Endpoints**: ${totalEndpoints}\n`;
  md += `- **Both (positive + negative)**: ${bothCount} (${(bothCount / totalEndpoints * 100).toFixed(1)}%)\n`;
  md += `- **Positive Only**: ${coveredPositiveCount} (${(coveredPositiveCount / totalEndpoints * 100).toFixed(1)}%)\n`;
  md += `- **Negative Only**: ${coveredNegativeCount} (${(coveredNegativeCount / totalEndpoints * 100).toFixed(1)}%)\n`;
  md += `- **Gaps (No Tests)**: ${gapCount} (${(gapCount / totalEndpoints * 100).toFixed(1)}%)\n`;
  md += `- **Overall Coverage**: ${coveragePercentage}%\n\n`;
  
  md += '## Gaps Requiring Attention\n\n';
  const gaps = matrix.filter(r => r.coverage === 'gap');
  if (gaps.length > 0) {
    md += '| Path | Method | Summary |\n';
    md += '|------|--------|----------|\n';
    for (const gap of gaps.slice(0, 20)) {
      md += `| \`${gap.path}\` | ${gap.method} | ${gap.summary} |\n`;
    }
    if (gaps.length > 20) {
      md += `| ... | ... | ${gaps.length - 20} more gaps |\n`;
    }
  } else {
    md += 'No gaps found!\n';
  }
  
  return md;
}

// Main execution
function main() {
  const projectRoot = path.join(__dirname, '..');
  const swaggerPath = path.join(projectRoot, 'api-docs', 'target-swagger.json');
  const testModulesDir = path.join(projectRoot, 'src', 'test-modules');
  const outputDir = path.join(projectRoot, 'coverage-reports');
  
  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  console.log('Loading Swagger specification...');
  const swagger = loadSwagger(swaggerPath);
  
  console.log('Extracting endpoints from Swagger...');
  const swaggerEndpoints = extractSwaggerEndpoints(swagger);
  console.log(`Found ${swaggerEndpoints.length} endpoints`);
  
  console.log('Scanning test modules...');
  const testMap = scanTestModules(testModulesDir);
  console.log(`Mapped ${Object.keys(testMap).length} endpoint references in tests`);
  
  console.log('Generating coverage matrix...');
  const matrix = generateCoverageMatrix(swaggerEndpoints, testMap);
  
  // Write CSV
  const csvPath = path.join(outputDir, 'coverage-matrix.csv');
  const csv = generateCSV(matrix);
  fs.writeFileSync(csvPath, csv);
  console.log(`✓ CSV matrix written to ${csvPath}`);
  
  // Write JSON
  const jsonPath = path.join(outputDir, 'coverage-matrix.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ 
    generated: new Date().toISOString(),
    totalEndpoints: matrix.length,
    matrix 
  }, null, 2));
  console.log(`✓ JSON matrix written to ${jsonPath}`);
  
  // Write Markdown summary
  const mdPath = path.join(outputDir, 'COVERAGE_SUMMARY.md');
  const md = generateMarkdownSummary(matrix);
  fs.writeFileSync(mdPath, md);
  console.log(`✓ Markdown summary written to ${mdPath}`);
  
  // Print summary to console
  console.log('\n' + md);
  
  // Exit with error if gaps exist
  const gapCount = matrix.filter(r => r.coverage === 'gap').length;
  if (gapCount > 0) {
    console.warn(`\n⚠ WARNING: ${gapCount} endpoints have no test coverage`);
    process.exit(1);
  }
}

main();
