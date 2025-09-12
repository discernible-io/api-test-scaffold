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
const { createLogContext, logErrorWithMetrics } = logger;
const { validateAndExtractCredentials } = require("../../utils");
class FileManager {
  constructor() {
    this.credentialsFilePath = config.get("NEAR_CREDENTIALS_FILE_PATH");
    this.initialized = false;
    this.credentials = {};
  }

  async initialize(options = {}) {
    const context = createLogContext("FileCredentialStore", "initialize", {
      requestId: ulid(),
      hasConfigPath: !!options.credentialsFilePath
    });
  
    logger.debugWithContext("Initializing file credential store", context);
  
    if (this.initialized) {
      logger.debugWithContext("File credential store already initialized", context);
      return this;
    }
  
    try {
      this.credentialsFilePath = options.credentialsFilePath || config.get('NEAR_CREDENTIALS_FILE_PATH');
      if (!this.credentialsFilePath) {
        throw new Error('NEAR_CREDENTIALS_FILE_PATH is not set in config or options');
      }
  
      // Ensure the directory exists
      try {
        await fs.mkdir(require('path').dirname(this.credentialsFilePath), { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }

      this.credentials = await this.getCredentials();
      this.initialized = true;
      
      logger.debugWithContext("File credential store initialized successfully", {
        ...context,
        credentialsFilePath: this.credentialsFilePath,
        credentialCount: Object.keys(this.credentials).length
      });
  
      return this;
    } catch (error) {
      logger.errorWithContext("Failed to initialize file credential store", {
        ...context,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  async checkFileAccess(filePath) {
    try {
      const stats = await fs.stat(filePath);
      await fs.access(filePath, fs.constants.R_OK | fs.constants.W_OK);
      return { exists: true, isWritable: true, stats };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { exists: false, isWritable: false };
      }
      return { 
        exists: false, 
        isWritable: false, 
        error: error.message,
        code: error.code
      };
    }
  }

  async getCredentials(type) {
    const context = createLogContext("FileCredentialStore", "getCredentials", {
      requestId: ulid(),
      type: type || 'all'
    });
    const startTime = Date.now();

    try {
      logger.debugWithContext("Attempting to read credentials file", {
        ...context,
        credentialsFilePath: this.credentialsFilePath
      });

      const { exists } = await this.checkFileAccess(this.credentialsFilePath);
      if (!exists) {
        logger.infoWithContext("Credentials file does not exist, will be created when needed", {
          ...context,
          credentialsFilePath: this.credentialsFilePath
        });
        return {};
      }

      const fileContent = await fs.readFile(this.credentialsFilePath, 'utf8');
      if (!fileContent.trim()) {
        logger.infoWithContext("Credentials file exists but is empty", {
          ...context,
          credentialsFilePath: this.credentialsFilePath
        });
        return {};
      }

      const parsed = JSON.parse(fileContent);
      
      // Filter by type if specified
      let result = type ? 
        Object.fromEntries(
          Object.entries(parsed).filter(([_, cred]) => cred.type === type)
        ) : parsed;

      // Validate credentials if any are found
      if (Object.keys(result).length > 0) {
        try {
          result = validateAndExtractCredentials(result, logger);
          logger.debugWithContext("Successfully validated credentials", {
            ...context,
            duration: Date.now() - startTime,
            credentialCount: Object.keys(result).length
          });
        } catch (validationError) {
          logErrorWithMetrics(
            "Credential validation failed",
            {
              ...context,
              duration: Date.now() - startTime,
              errorDetails: validationError.message,
              errorType: validationError.name
            },
            validationError,
            "credential_validation_error",
            { error_type: "validation_failure" }
          );
          throw validationError;
        }
      }
  } catch (error) {
    logErrorWithMetrics(
      "Error retrieving credentials from file",
      {
        ...context,
        duration: Date.now() - startTime,
        errorDetails: error.message,
        errorType: error.name,
        credentialsFilePath: this.credentialsFilePath
      },
      error,
      "file_credential_retrieval_error",
      { error_type: "retrieval_failure" }
    );
    throw error;
  }
}

// Mock function to maintain interface compatibility with vaultcredentialstore.js
setupTokenRenewal(store) {
  const context = createLogContext("FileCredentialStore", "setupTokenRenewal", {
    requestId: ulid()
  });
  
  logger.debugWithContext("Skipping token renewal setup (not applicable for file-based credentials)", context);
  return Promise.resolve();
}


}

const fileManager = new FileManager();

module.exports = {
  initializeProductionCredentialStore: (options) => fileManager.initialize(options),
  setupTokenRenewal: () => fileManager.setupTokenRenewal(),
  getCredentials: (type) => fileManager.getCredentials(type),
  vault: null,
  // For testing purposes
  _fileManager: fileManager
};
