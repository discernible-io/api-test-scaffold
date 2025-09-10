#!/usr/bin/env node
/*
 * run-local-sdk-tests.js
 * Runs SDK-local, network-free test modules for quick validation.
 */

const path = require('path');

const modules = [
  '../src/test-modules/sdk-npm-surface-tests',
  '../src/test-modules/performance-service-tests',
  '../src/test-modules/logger-tests',
  '../src/test-modules/config-wrapper-tests'
];

(async () => {
  let passed = 0, failed = 0;
  for (const modPath of modules) {
    const abs = path.join(__dirname, modPath);
    const suite = require(abs);
    for (const [name, fn] of Object.entries(suite)) {
      process.stdout.write(`→ ${name} ... `);
      try {
        const result = await fn();
        if (result === null) {
          console.log('SKIPPED');
        } else if (result && result.success === false) {
          failed++;
          console.log('FAILED');
        } else {
          passed++;
          console.log('OK');
        }
      } catch (err) {
        failed++;
        console.log('ERROR');
        console.error(err && err.stack ? err.stack : err);
      }
    }
  }
  console.log(`\nSummary: passed=${passed}, failed=${failed}`);
  process.exitCode = failed > 0 ? 1 : 0;
})();
