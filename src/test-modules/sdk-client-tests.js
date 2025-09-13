/**
 * SDK Client Test Module
 * Tests for the RODiT SDK client functionality
 * 
 * Copyright (c) 2024 Discernible, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const assert = require('assert');
const logger = require('../../sdk/services/logger');
const { RoditClient, createClient, getClientState } = require('../../sdk/roditclient');

// Test utilities
const testUtils = require('./test-utils');

/**
 * Run SDK client tests
 * @param {Object} results - Test results object
 * @param {string} moduleName - Name of the module being tested
 * @param {string} correlationId - Correlation ID for logging
 */
async function runClientTests(results, moduleName, correlationId) {
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
    
    // Now initialize the RoditClient
    const client = new RoditClient();
    
    await client.init();
    assert.strictEqual(client.initialized, true, 'Client should be initialized');
    
    // Verify the client has loaded token metadata properly
    const metadata = client.getRoditMetadata();
    assert.ok(metadata, 'Token metadata should be loaded');
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
    
    const client = new RoditClient();
    await client.init();
    
    // Get the API endpoint
    const metadata = client.getRoditMetadata();
    
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
  
  // Test createClient helper
  await testUtils.runTest(results, 'sdk-createClient - initialization', async () => {
    const client = await createClient();
    
    // Client is already initialized by createClient
    assert.strictEqual(client.initialized, true, 'Client should be initialized');
    
    // Verify the client state is properly updated
    const state = getClientState();
    assert.ok(state, 'Client state should be available');
    assert.ok(Object.keys(state).length > 0, 'Client state should have properties');
  });
}

module.exports = {
  runClientTests
};
