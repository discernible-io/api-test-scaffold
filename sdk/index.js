/**
 * RODiT ID Authentication System
 * 
 * This module exports the core authentication functions directly from their source files.
 * It provides a simple interface for using the RODiT ID Authentication system without adding
 * unnecessary abstraction layers.
 * 
 * Copyright (c) 2025 Discernible Inc. All rights reserved.
 */

// Import authentication middleware functions
const { 
  authenticate_apicall,
  login_client,
  logout_client,
  login_client_withnep413,
  login_portal,
  login_server
} = require('./lib/middleware/authenticationmw');

// Import token service functions
const {
  validate_jwt_token_be,
  generate_jwt_token
} = require('./lib/auth/tokenservice');

// Import permission validation - direct function import
const validatePermissions = require('./lib/middleware/validatepermissions');

// Import session management
const { sessionManager } = require('./lib/auth/sessionmanager');

// Import blockchain services
const blockchainService = require('./lib/blockchain/blockchainservice');
const stateManager = require('./lib/blockchain/statemanager');

// Import webhook functionality directly
const webhookHandler = require('./lib/webhook/webhookhandler');
// Note: eventHandler has been consolidated into webhookhandler.js

// Import versioning functionality
const { versioningMiddleware } = require('./lib/middleware/versioningmw');
const { versionManager, VersionManager } = require('./lib/versioning/versionmanager');

// Public surface additions
const loggingmw = require('./lib/middleware/loggingmw');
const ratelimitmw = require('./lib/middleware/ratelimit');
const utils = require('./utils');
const config = require('./services/config');
const {
  validateAndSetDate,
  validateAndSetJson,
  validateAndSetUrl,
  calculateCanonicalHash,
} = utils;
const logger = require('./services/logger');
const performanceService = require('./services/performanceservice');
const roditManager = require('./lib/auth/roditmanager');

// Global singleton guard to avoid duplicate instances when the SDK is loaded via different paths
// (e.g., local '../../sdk' vs '@rodit/rodit-auth-be')
const __g = (globalThis.__RODIT_SINGLETONS__ ||= {});
__g.stateManager = __g.stateManager || stateManager;
__g.roditManager = __g.roditManager || roditManager;
__g.logger = __g.logger || logger;
__g.blockchainService = __g.blockchainService || blockchainService;
const { RoditClient } = require('./roditclient');

// Helper to initialize config for a specific environment role
// env must be one of: 'portal', 'sanctum', 'client', 'server'
async function initConfig(env) {
  const allowed = new Set(['portal', 'sanctum', 'client', 'server']);
  if (!allowed.has(env)) {
    throw new Error(`initConfig: invalid env '${env}'. Must be one of portal|sanctum|client|server`);
  }
  await __g.roditManager.initializeCredentialsStore();
  await __g.roditManager.initializeRoditConfig(env);
}

// Import the simplified initialization
const { initializeRoditSdk } = require('./init');

// Simple export of the authentication system
module.exports = {
  // Simplified SDK initialization
  initializeRoditSdk,
  // Configuration
  config,
  
  // Core middleware functions
  authenticate: authenticate_apicall,
  validatePermissions,
  
  // Authentication handlers
  login: login_server,
  logout: logout_client,
  loginWithNEP413: login_client_withnep413,
  
  // Original function names for backward compatibility
  authenticate_apicall,
  login_client,
  logout_client,
  login_client_withnep413,
  login_portal,
  login_server,
  
  // Token functions
  validateToken: validate_jwt_token_be,
  generateToken: generate_jwt_token,
  
  // Services
  sessionManager,
  blockchainService: __g.blockchainService,
  stateManager: __g.stateManager,
  
  // Webhook functionality
  webhook: {
    // Export all webhook handler functionality
    ...webhookHandler
    // Note: eventHandler functionality is now part of webhookHandler
  },
  
  // Versioning functionality
  versioning: {
    middleware: versioningMiddleware,
    manager: versionManager,
    VersionManager
  },
  
  // Logging middleware and utilities
  loggingmw,
  ratelimitmw,
  utils,
  // Individual util functions at top-level for convenience
  validateAndSetDate,
  validateAndSetJson,
  validateAndSetUrl,
  calculateCanonicalHash,
  logger: __g.logger,
  performanceService,
  
  // Client & initialization helpers
  RoditClient,
  initConfig,
  roditManager: __g.roditManager,
  
  // Session maintenance helpers (top-level convenience exports)
  runManualCleanup: (...args) => sessionManager.runManualCleanup(...args),
  
  // Configuration helper
  configure: (config) => {
    // Store configuration in state manager for access by all components
    if (config) {
      __g.stateManager.setConfig(config);
      
      // Configure versioning if specified
      if (config.apiVersion) {
        versionManager.setVersion(config.apiVersion);
      }
      
      if (config.versionHeaderType) {
        versionManager.setHeaderType(config.versionHeaderType);
      }
    }
    return module.exports;
  }
};

