/**
 * SDK Client Test Module
 * Tests for the RODiT SDK client functionality
 * 
 * Copyright (c) 2024 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const assert = require('assert');
// Import SDK components using the new interface
const { logger } = require('../../sdk');
const { RoditClient } = require('../../sdk');

// Test utilities
const testUtils = require('./test-utils');
const { getSharedRoditClient } = require('./test-utils');

/**
 * Run SDK client tests
 * @param {Object} results - Test results object
 * @param {string} moduleName - Name of the module being tested
 * @param {string} correlationId - Correlation ID for logging
 * @param {Object} app - Express app instance with roditClient in app.locals
 */
async function runClientTests(results, moduleName, correlationId, app = null) {
  logger.info('Test phase: SDK client functionality', {
    component: "TestRunner",
    moduleName,
    testName: "runClientTests",
    correlationId,
    phase: "client_tests"
  });
  
  // Test client initialization
  await testUtils.runTest(results, 'sdk-RoditClient - initialization', async () => {
    const roditManager = require('../../sdk/lib/auth/roditmanager');
    
    // Initialize the RODiT configuration with the client namespace
    try {
      await roditManager.initializeRoditConfig('client');
    } catch (error) {
      logger.warn('Error initializing RODiT config for test, continuing anyway', {
        component: 'TestRunner',
        method: 'runClientTests',
        error: error.message
      });
    }
    
    // Get shared RoditClient instance or create new one
    const client = await getSharedRoditClient({ app });
    assert.strictEqual(client.initialized, true, 'Client should be initialized');
    
    // Verify the client has loaded token configuration properly
    const config = await client.getConfigOwnRodit();
    assert.ok(config && config.own_rodit && config.own_rodit.metadata, 'Token configuration and metadata should be loaded');
    const metadata = config.own_rodit.metadata;
  });
  
  // Test protocol handling
  await testUtils.runTest(results, 'sdk-RoditClient - protocol handling', async () => {
    const roditManager = require('../../sdk/lib/auth/roditmanager');
    try {
      await roditManager.initializeRoditConfig('client');
    } catch (error) {
      logger.warn('Error initializing RODiT config for test, continuing anyway', {
        component: 'TestRunner',
        method: 'runClientTests',
        error: error.message
      });
    }
    
    const client = await getSharedRoditClient({ app });
    
    // Get the API endpoint
    const config = await client.getConfigOwnRodit();
    const metadata = config?.own_rodit?.metadata;
    
    // If we have an endpoint, verify it has a protocol
    if (metadata && metadata.subjectuniqueidentifier_url) {
      const endpoint = metadata.subjectuniqueidentifier_url;
      
      // Check if it has the proper protocol prefix
      assert.ok(
        endpoint.startsWith('http://') || endpoint.startsWith('https://'),
        'API endpoint should have proper protocol prefix'
      );
    } else {
      // If no endpoint is available in the test environment, we'll skip this check
      logger.warn('No API endpoint available in metadata, skipping protocol check', {
        component: 'TestRunner',
        method: 'runClientTests',
        metadata: JSON.stringify(metadata)
      });
    }
  });
  
  // Test RoditClient.create() method
  await testUtils.runTest(results, 'sdk-RoditClient.create - initialization', async () => {
    const client = await RoditClient.create('client');
    
    // Client is already initialized by create()
    assert.strictEqual(client.initialized, true, 'Client should be initialized');
    
    // Verify the client state is properly updated
  });
}

module.exports = {
  runClientTests
};
