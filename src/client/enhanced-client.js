/**
 * Enhanced RODiT Client Implementation
 * 
 * This client implementation follows the principles outlined in the project:
 * 1. Uses singleton instances of RoditManager and AuthStateManager
 * 2. Does not handle configuration directly
 * 3. Gets configuration from RODiT token metadata
 * 4. Ensures proper protocol prefixes for API endpoints
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const { ulid } = require('ulid');
const logger = require('../../config/logger');
const roditManager = require('../auth/roditmanager');
const authStateManager = require('../blockchain/statemanager');
const { ensureProtocol } = require('../utils');
const RoditClient = require('./roditclient');

/**
 * Initialize the RODiT client with credentials from a file
 * @param {string} configPath - Path to the credentials file
 * @returns {Promise<RoditClient>} Initialized RoditClient instance
 */
async function setupRoditCredentialsFromFile(configPath) {
  const requestId = ulid();
  
  logger.info('Setting up RODiT credentials from file', {
    component: 'EnhancedClient',
    method: 'setupRoditCredentialsFromFile',
    requestId,
    configPath
  });
  
  try {
    // Set the configuration path in the RoditManager
    await roditManager.setConfigPath(configPath);
    
    // Load credentials from the file
    const credentials = await roditManager.getCredentials('client');
    
    logger.debug('Credentials loaded successfully', {
      component: 'EnhancedClient',
      method: 'setupRoditCredentialsFromFile',
      requestId,
      hasAccountId: !!credentials.account_id,
      hasTokenId: !!credentials.token_id
    });
    
    // Validate that the required metadata is present
    if (!credentials.config_own_rodit || !credentials.config_own_rodit.metadata) {
      throw new Error('Missing RODiT token metadata in credentials');
    }
    
    const metadata = credentials.config_own_rodit.metadata;
    
    // Validate the required subjectuniqueidentifier_url field
    if (!metadata.subjectuniqueidentifier_url) {
      throw new Error('Missing required field: subjectuniqueidentifier_url in token metadata');
    }
    
    // Ensure the API endpoint has the proper protocol prefix
    const apiEndpoint = ensureProtocol(metadata.subjectuniqueidentifier_url);
    
    logger.info('RODiT API endpoint configured', {
      component: 'EnhancedClient',
      method: 'setupRoditCredentialsFromFile',
      requestId,
      apiEndpoint
    });
    
    // Set the configuration in the AuthStateManager
    await authStateManager.setConfigOwnRodit(credentials.config_own_rodit);
    
    // Create a new client instance without passing configuration
    // The client will get its configuration from the singletons
    const client = new RoditClient();
    
    // Initialize the client
    await client.init();
    
    return client;
  } catch (error) {
    logger.error('Failed to set up RODiT credentials', {
      component: 'EnhancedClient',
      method: 'setupRoditCredentialsFromFile',
      requestId,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Create and initialize a RODiT client with the given configuration path
 * @param {string} configPath - Path to the credentials file
 * @returns {Promise<RoditClient>} Initialized RoditClient instance
 */
async function createClient(configPath) {
  return setupRoditCredentialsFromFile(configPath);
}

module.exports = {
  setupRoditCredentialsFromFile,
  createClient
};
