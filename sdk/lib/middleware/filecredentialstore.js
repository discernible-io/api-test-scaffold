/**
 * File-based credential storage system
 * Alternative to Vault for storing RODiT credentials
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const fs = require('fs').promises;
const { ulid } = require("ulid");
const config = require('../../services/config');
const logger = require("../../services/logger");
const { createLogContext } = logger;

const credentials = {};
let initialized = false;
let configPath = null;

async function checkFileAccess(filePath) {
  try {
    const stats = await fs.stat(filePath);
    await fs.access(filePath, fs.constants.R_OK);
    return { exists: true, stats };
  } catch (error) {
    return { exists: false, error };
  }
}

async function loadCredentials() {
  const context = createLogContext("FileCredentialStore", "loadCredentials", {
    requestId: ulid()
  });

  try {
    const { exists } = await checkFileAccess(configPath);
    if (!exists) {
      logger.infoWithContext("Credentials file does not exist, will be created when needed", {
        ...context,
        configPath
      });
      return {};
    }

    const fileContent = await fs.readFile(configPath, 'utf8');
    if (!fileContent.trim()) {
      logger.infoWithContext("Credentials file exists but is empty", {
        ...context,
        configPath
      });
      return {};
    }

    const parsed = JSON.parse(fileContent);
    logger.infoWithContext("Loaded credentials from file", {
      ...context,
      configPath,
      credentialCount: Object.keys(parsed).length
    });

    return parsed;
  } catch (error) {
    logger.warnWithContext("Using empty credentials due to load error", {
      ...context,
      error: error.message,
      configPath
    });
    return {};
  }
}

async function initialize(options = {}) {
  const context = createLogContext("FileCredentialStore", "initialize", {
    requestId: ulid(),
    hasConfigPath: !!options.configPath
  });

  logger.debugWithContext("Initializing file credential store", context);

  if (initialized) {
    logger.debugWithContext("File credential store already initialized", context);
    return { initialize };
  }

  try {
    configPath = options.configPath || config.get('NEAR_CREDENTIALS_FILE_PATH');
    if (!configPath) {
      throw new Error('NEAR_CREDENTIALS_FILE_PATH is not set in config or options');
    }

    Object.assign(credentials, await loadCredentials());
    initialized = true;
    
    logger.debugWithContext("File credential store initialized successfully", {
      ...context,
      configPath,
      credentialCount: Object.keys(credentials).length
    });

    return { initialize };
  } catch (error) {
    logger.errorWithContext("Failed to initialize file credential store", {
      ...context,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

// Mock function to maintain interface compatibility with vaultcredentialstore.js
async function setupTokenRenewal(store) {
  const context = createLogContext("FileCredentialStore", "setupTokenRenewal", {
    requestId: ulid()
  });
  
  logger.debugWithContext("Skipping token renewal setup (not applicable for file-based credentials)", context);
  return Promise.resolve();
}

// Export the interface expected by roditmanager.js
module.exports = {
  initializeProductionCredentialStore: async () => {
    const credentialsFilePath = config.get('NEAR_CREDENTIALS_FILE_PATH');
    if (!credentialsFilePath) {
      throw new Error('NEAR_CREDENTIALS_FILE_PATH is not set in config');
    }
    
    return initialize({ configPath: credentialsFilePath });
  },
  setupTokenRenewal,
  vault: null, // Maintain interface compatibility
  getCredentials: async (type) => {
    // Simple pass-through since credentials are already in memory
    return credentials[type] || null;
  }
};
