const fs = require('fs').promises;
const path = require('path');

// Mapping of current filenames to new filenames
const fileRenames = [
  { from: 'authentication-test.js', to: 'authentication.js' },
  { from: 'concurrency-tests.js', to: 'concurrency.js' },
  { from: 'content-type-tests.js', to: 'content-type.js' },
  { from: 'cruda-operations.js', to: 'cruda.js' },
  { from: 'encoding-tests.js', to: 'encoding.js' },
  { from: 'idempotency-tests.js', to: 'idempotency.js' },
  { from: 'integration-tests.js', to: 'integration.js' },
  { from: 'legacy-tests.js', to: 'legacy.js' },
  { from: 'mcp-tests.js', to: 'mcp.js' },
  { from: 'metrics-tests.js', to: 'metrics.js' },
  { from: 'performance-service-tests.js', to: 'performance-service.js' },
  { from: 'performance-tests.js', to: 'performance-extended.js' },
  { from: 'session-management-tests.js', to: 'session-management.js' },
  { from: 'sdk-npm-surface-tests.js', to: 'sdk-surface.js' }
];

async function renameFiles() {
  const testModulesDir = path.join(__dirname, '../src/test-modules');
  
  for (const { from, to } of fileRenames) {
    const fromPath = path.join(testModulesDir, from);
    const toPath = path.join(testModulesDir, to);
    
    try {
      await fs.rename(fromPath, toPath);
      console.log(`Renamed: ${from} -> ${to}`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log(`Skipping: ${from} (not found)`);
      } else {
        console.error(`Error renaming ${from} to ${to}:`, error.message);
      }
    }
  }
  
  console.log('File renaming complete!');
}

renameFiles().catch(console.error);
