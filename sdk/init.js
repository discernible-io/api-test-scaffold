const roditManager = require('./lib/auth/roditmanager');
const stateManager = require('./lib/blockchain/statemanager');
const logger = require('./services/logger');
const loggingmw = require('./lib/middleware/loggingmw');

/**
 * Initialize the RODiT SDK with a single function call
 * @param {Object} [options] - Configuration options
 * @param {string} [options.environment='sanctum'] - Environment to initialize ('sanctum' or 'portal')
 * @returns {Promise<Object>} The initialized RODiT configuration object
 * @throws {Error} If initialization fails
 */
async function initializeRoditSdk(options = {}) {
  const { environment = 'sanctum' } = options;
  
  try {
    // Initialize vault and configuration using SDK
    await roditManager.initializeCredentialsStore();
    
    // Initialize RODiT configuration for the specified environment
    await roditManager.initializeRoditConfig(environment);
    
    logger.info(`Vault initialized and RODiT configuration loaded for environment: ${environment}`);
    
    // Get and validate the configuration
    const configObject = await stateManager.getConfigOwnRodit();
    if (!configObject) {
      throw new Error('Failed to initialize RODiT configuration: No configuration returned');
    }
    
    // Apply rate limiting if configured
    const { own_rodit } = configObject;
    if (own_rodit?.metadata?.max_requests && own_rodit?.metadata?.maxrq_window) {
      // This function should be provided by the application
      if (typeof updateRateLimit === 'function') {
        updateRateLimit(
          own_rodit.metadata.max_requests,
          own_rodit.metadata.maxrq_window
        );
      }
    }
    
    return configObject;
  } catch (error) {
    logger.error(`Failed to initialize RODiT SDK: ${error.message}`, { error });
    throw new Error(`SDK initialization failed: ${error.message}`);
  }
}

module.exports = {
  initializeRoditSdk,
  // Re-export the managers and middleware for advanced use cases
  roditManager,
  stateManager,
  logger,
  loggingmw
};
