/**
 * File-based credential storage system
 * Alternative to Vault for storing RODiT credentials
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const fs = require('fs').promises;
const bs58 = require("bs58");
const path = require("path");
const crypto = require('crypto');
const { ulid } = require("ulid");
const config = require("config");
const logger = require("../../config/logger");
const { validateAndExtractCredentials, validateCredentialParameters } = require("../utils");

/**
 * FileCredentialStore class
 * Provides file-based credential storage with optional encryption
 */
class FileCredentialStore {
  constructor() {
    if (FileCredentialStore.instance) {
      return FileCredentialStore.instance;
    }

    this.initialized = false;
    this.configPath = null;
    this.credentials = {};
    this.encryptionKey = null;

    FileCredentialStore.instance = this;
  }

  /**
   * Initialize the file credential store
   * 
   * @param {Object} options - Initialization options
   * @param {string} options.configPath - Path to the credentials file
   * @param {string} options.encryptionKey - Optional encryption key for securing credentials
   * @returns {Promise<Object>} - The initialized store instance
   */
  async initialize(options = {}) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Initializing file credential store", {
      component: "FileCredentialStore",
      method: "initialize",
      requestId,
      hasConfigPath: !!options.configPath,
      hasEncryptionKey: !!options.encryptionKey,
      initialized: this.initialized
    });

    if (this.initialized) {
      logger.debug("File credential store already initialized", {
        component: "FileCredentialStore",
        method: "initialize",
        requestId
      });
      return this;
    }

    try {
      // Get configuration path from options or config
      this.configPath = config.get('RODIT_CONFIGURATION_FILE_PATH');
      
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // Set encryption key if provided
      if (options.encryptionKey) {
        this.encryptionKey = options.encryptionKey;
      }

      // Check if credentials file exists and load it
      try {
        const fileExists = await fs.access(this.configPath)
          .then(() => true)
          .catch(() => false);

        if (fileExists) {
          const fileContent = await fs.readFile(this.configPath, 'utf8');
          
          if (fileContent.trim()) {
            const parsedContent = JSON.parse(fileContent);
            
            // Decrypt if necessary
            if (this.encryptionKey && parsedContent.encrypted) {
              this.credentials = this.decryptCredentials(parsedContent.data);
            } else {
              this.credentials = parsedContent;
            }
            
            logger.info("Loaded credentials from file", {
              component: "FileCredentialStore",
              method: "initialize",
              requestId,
              configPath: this.configPath,
              credentialCount: Object.keys(this.credentials).length
            });
          } else {
            logger.info("Credentials file exists but is empty", {
              component: "FileCredentialStore",
              method: "initialize",
              requestId,
              configPath: this.configPath
            });
            this.credentials = {};
          }
        } else {
          logger.info("Credentials file does not exist, will be created when needed", {
            component: "FileCredentialStore",
            method: "initialize",
            requestId,
            configPath: this.configPath
          });
          this.credentials = {};
        }
      } catch (fileError) {
        logger.warn("Failed to load credentials file, creating new one", {
          component: "FileCredentialStore",
          method: "initialize",
          requestId,
          configPath: this.configPath,
          error: fileError.message
        });
        this.credentials = {};
      }

      this.initialized = true;
      
      const duration = Date.now() - startTime;
      logger.info("File credential store initialized successfully", {
        component: "FileCredentialStore",
        method: "initialize",
        requestId,
        duration,
        configPath: this.configPath,
        encrypted: !!this.encryptionKey
      });

      return this;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Failed to initialize file credential store", {
        component: "FileCredentialStore",
        method: "initialize",
        requestId,
        duration,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Encrypt credentials data
   * 
   * @param {Object} data - Data to encrypt
   * @returns {string} - Encrypted data string
   */
  encryptCredentials(data) {
    if (!this.encryptionKey) {
      return data;
    }

    // Create a key from the encryption key string
    const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
    
    // Generate a random initialization vector
    const iv = crypto.randomBytes(16);
    
    // Create cipher
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    // Encrypt the data
    const jsonData = JSON.stringify(data);
    let encrypted = cipher.update(jsonData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    // Return the encrypted data with the IV
    return {
      iv: iv.toString('hex'),
      data: encrypted
    };
  }

  /**
   * Decrypt credentials data
   * 
   * @param {Object} encryptedData - Encrypted data object with IV
   * @returns {Object} - Decrypted data
   */
  decryptCredentials(encryptedData) {
    if (!this.encryptionKey || !encryptedData || !encryptedData.iv || !encryptedData.data) {
      return encryptedData;
    }

    // Create a key from the encryption key string
    const key = crypto.createHash('sha256').update(this.encryptionKey).digest();
    
    // Get the IV from the encrypted data
    const iv = Buffer.from(encryptedData.iv, 'hex');
    
    // Create decipher
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    // Decrypt the data
    let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    // Parse and return the decrypted data
    return JSON.parse(decrypted);
  }

  /**
   * Save credentials to file
   * 
   * @returns {Promise<boolean>} - True if successful
   */
  async saveCredentials() {
    const requestId = ulid();
    const startTime = Date.now();

    logger.debug("Saving credentials to file", {
      component: "FileCredentialStore",
      method: "saveCredentials",
      requestId,
      configPath: this.configPath,
      credentialCount: Object.keys(this.credentials).length
    });

    try {
      // Prepare data for saving
      let dataToSave;
      
      if (this.encryptionKey) {
        dataToSave = {
          encrypted: true,
          data: this.encryptCredentials(this.credentials)
        };
      } else {
        dataToSave = this.credentials;
      }
      
      // Write to file
      await fs.writeFile(this.configPath, JSON.stringify(dataToSave, null, 2), 'utf8');
      
      const duration = Date.now() - startTime;
      logger.info("Credentials saved to file successfully", {
        component: "FileCredentialStore",
        method: "saveCredentials",
        requestId,
        duration,
        configPath: this.configPath,
        encrypted: !!this.encryptionKey
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Failed to save credentials to file", {
        component: "FileCredentialStore",
        method: "saveCredentials",
        requestId,
        duration,
        configPath: this.configPath,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Get a credential by key
   * 
   * @param {string} key - Credential key
   * @returns {Promise<any>} - The credential value
   */
  async getCredential(key) {
    const requestId = ulid();
    
    logger.debug("Getting credential", {
      component: "FileCredentialStore",
      method: "getCredential",
      requestId,
      key,
      exists: this.credentials.hasOwnProperty(key)
    });
    
    return this.credentials[key];
  }

  /**
   * Set a credential
   * 
   * @param {string} key - Credential key
   * @param {any} value - Credential value
   * @param {boolean} save - Whether to save to file immediately
   * @returns {Promise<boolean>} - True if successful
   */
  async setCredential(key, value, save = true) {
    const requestId = ulid();
    
    logger.debug("Setting credential", {
      component: "FileCredentialStore",
      method: "setCredential",
      requestId,
      key,
      saveImmediately: save
    });
    
    this.credentials[key] = value;
    
    if (save) {
      return this.saveCredentials();
    }
    
    return true;
  }

  /**
   * Delete a credential
   * 
   * @param {string} key - Credential key
   * @param {boolean} save - Whether to save to file immediately
   * @returns {Promise<boolean>} - True if successful
   */
  async deleteCredential(key, save = true) {
    const requestId = ulid();
    
    logger.debug("Deleting credential", {
      component: "FileCredentialStore",
      method: "deleteCredential",
      requestId,
      key,
      exists: this.credentials.hasOwnProperty(key),
      saveImmediately: save
    });
    
    if (this.credentials.hasOwnProperty(key)) {
      delete this.credentials[key];
      
      if (save) {
        return this.saveCredentials();
      }
    }
    
    return true;
  }

  /**
   * Get a RODiT from file storage
   * 
   * @param {string} roditId - RODiT ID to retrieve
   * @returns {Promise<Object>} - The RODiT object
   */
  async get_rodit_fromfile(roditId) {
    const requestId = ulid();
    const startTime = Date.now();
    
    logger.debug("Getting RODiT from file", {
      component: "FileCredentialStore",
      method: "get_rodit_fromfile",
      requestId,
      roditId
    });
    
    try {
      // Ensure we're initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Get the RODiT from credentials
      const roditKey = `rodit_${roditId}`;
      const rodit = await this.getCredential(roditKey);
      
      if (!rodit) {
        logger.warn("RODiT not found in file store", {
          component: "FileCredentialStore",
          method: "get_rodit_fromfile",
          requestId,
          roditId
        });
        
        throw new Error(`RODiT ${roditId} not found in file store`);
      }
      
      const duration = Date.now() - startTime;
      logger.info("Retrieved RODiT from file store", {
        component: "FileCredentialStore",
        method: "get_rodit_fromfile",
        requestId,
        duration,
        roditId
      });
      
      return rodit;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Failed to get RODiT from file", {
        component: "FileCredentialStore",
        method: "get_rodit_fromfile",
        requestId,
        duration,
        roditId,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }

  /**
   * Store a RODiT in file storage
   * 
   * @param {string} roditId - RODiT ID
   * @param {Object} roditData - RODiT data to store
   * @returns {Promise<boolean>} - True if successful
   */
  async store_rodit_tofile(roditId, roditData) {
    const requestId = ulid();
    const startTime = Date.now();
    
    logger.debug("Storing RODiT to file", {
      component: "FileCredentialStore",
      method: "store_rodit_tofile",
      requestId,
      roditId
    });
    
    try {
      // Ensure we're initialized
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Store the RODiT in credentials
      const roditKey = `rodit_${roditId}`;
      await this.setCredential(roditKey, roditData);
      
      const duration = Date.now() - startTime;
      logger.info("Stored RODiT to file", {
        component: "FileCredentialStore",
        method: "store_rodit_tofile",
        requestId,
        duration,
        roditId
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Failed to store RODiT to file", {
        component: "FileCredentialStore",
        method: "store_rodit_tofile",
        requestId,
        duration,
        roditId,
        error: error.message,
        stack: error.stack
      });
      
      throw error;
    }
  }
}

/**
 * Set up RODiT credentials from file
 * 
 * @param {Object} config - Configuration object to update with credentials
 * @returns {Promise<Object>} - Updated configuration object with RODiT credentials
 */
async function setupRoditCredentialsFromFile(config) {
  const requestId = ulid();
  const logContext = {
    component: "FileCredentialStore",
    method: "setupRoditCredentialsFromFile",
    requestId
  };

  try {
    // Initialize the store if not already initialized
    await fileCredentialStore.initialize();
    
    // Check if credentials file exists
    const credentialPath = fileCredentialStore.configPath;
    const fileExists = await fs.access(credentialPath)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      logger.warn("NEAR credentials file not found", {
        ...logContext,
        path: credentialPath
      });
      return config;
    }
    
    // Read the credentials file directly to get the exact format
    const fileContent = await fs.readFile(credentialPath, 'utf8');
    const credentials = JSON.parse(fileContent);
    
    logger.info("NEAR credentials loaded from file", {
      ...logContext,
      accountId: credentials.account_id || credentials.implicit_account_id
    });
    
    // Use the shared validation function to process credentials
    const validatedCredentials = validateAndExtractCredentials(credentials);
    
    // Get the account ID from the credentials
    const accountId = validatedCredentials.account_id;
    
    // Load the token metadata from the blockchain
    const { nearorg_rpc_tokensfromaccountid } = require('../blockchain/blockchainservice');
    
    logger.debug("Loading RODiT metadata from blockchain", {
      ...logContext,
      accountId
    });
    
    // Fetch the RODiT token from the blockchain using the account ID
    const roditToken = await nearorg_rpc_tokensfromaccountid(accountId);
    
    if (!roditToken || !roditToken.metadata || !roditToken.metadata.subjectuniqueidentifier_url) {
      throw new Error('Failed to load token metadata from blockchain');
    }
    
    // Log the token metadata from blockchain
    logger.debug("RODiT token metadata from blockchain", {
      ...logContext,
      tokenId: roditToken.token_id,
      metadataKeys: Object.keys(roditToken.metadata),
      subjectuniqueidentifier_url: roditToken.metadata.subjectuniqueidentifier_url
    });
    
    // Set up RODiT credentials in the config object with metadata from blockchain
    config.own_rodit = {
      token_id: roditToken.token_id,
      metadata: roditToken.metadata
    };
    
    // Log the final config structure
    logger.debug("Final config structure after setting own_rodit", {
      ...logContext,
      configKeys: Object.keys(config),
      hasOwnRodit: !!config.own_rodit,
      ownRoditKeys: config.own_rodit ? Object.keys(config.own_rodit) : [],
      hasMetadata: config.own_rodit ? !!config.own_rodit.metadata : false,
      metadataKeys: config.own_rodit && config.own_rodit.metadata ? Object.keys(config.own_rodit.metadata) : []
    });
    
    // Store the string versions for compatibility
    config.own_rodit_bytes_private_key = validatedCredentials.private_key;
    config.own_rodit_bytes_public_key = validatedCredentials.public_key;
    
    // The API endpoint configuration should be handled by the ClientStateManager, not here
    
    // Don't convert keys to Uint8Array in the credential store layer
    // This will be done in the client layer when needed
    
    return config;
  } catch (error) {
    logger.error("Failed to setup RODiT credentials from file", {
      component: "FileCredentialStore",
      method: "setupRoditCredentialsFromFile",
      error: error.message
    });
    throw error;
  }
}

// Create and export a singleton instance
const fileCredentialStore = new FileCredentialStore();

/**
 * Get RODiT credentials from file
 * Similar interface to get_rodit_fromvault for easy switching
 * 
 * @param {Object} _unused1 - Unused parameter (for interface compatibility)
 * @param {string} configPath - Path to credentials file
 * @param {string} credentialType - Type of credentials
 * @returns {Promise<Object>} - RODiT credentials
 */
async function get_rodit_fromfile(_unused1, configPath, credentialType) {
  const requestId = ulid();
  const logContext = {
    component: "FileCredentialStore",
    method: "get_rodit_fromfile",
    requestId
  };

  try {
    // If configPath is not provided, use the one from fileCredentialStore
    const effectiveConfigPath = configPath || fileCredentialStore.configPath;
    
    // Validate parameters
    validateCredentialParameters(effectiveConfigPath, credentialType);
    
    // Initialize the store if not already initialized
    await fileCredentialStore.initialize();
    
    // Check if credentials file exists
    const credentialPath = fileCredentialStore.configPath;
    const fileExists = await fs.access(credentialPath)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      logger.error("NEAR credentials file not found", {
        ...logContext,
        path: credentialPath
      });
      throw new Error(`Error 049: Credentials file not found at ${credentialPath}`);
    }
    
    // Read the credentials file directly to get the exact format
    const fileContent = await fs.readFile(credentialPath, 'utf8');
    const credentials = JSON.parse(fileContent);
    
    // Use the shared validation function to process credentials
    const validatedCredentials = validateAndExtractCredentials(credentials);
    
    // Get the account ID from the credentials
    const accountId = validatedCredentials.account_id;
    
    // Load the token metadata from the blockchain
    const { nearorg_rpc_tokensfromaccountid } = require('../blockchain/blockchainservice');
    
    logger.debug("Loading RODiT metadata from blockchain in get_rodit_fromfile", {
      ...logContext,
      accountId
    });
    
    try {
      // Fetch the RODiT token from the blockchain using the account ID
      const roditToken = await nearorg_rpc_tokensfromaccountid(accountId);
      
      if (!roditToken || !roditToken.metadata || !roditToken.metadata.subjectuniqueidentifier_url) {
        logger.warn("Failed to load complete token metadata from blockchain", {
          ...logContext,
          accountId,
          hasToken: !!roditToken,
          hasMetadata: roditToken ? !!roditToken.metadata : false
        });
      } else {
        // Include the token metadata in the returned credentials
        validatedCredentials.own_rodit = {
          token_id: roditToken.token_id,
          metadata: roditToken.metadata
        };
        
        logger.debug("Added RODiT token metadata to credentials", {
          ...logContext,
          tokenId: roditToken.token_id,
          metadataKeys: Object.keys(roditToken.metadata)
        });
        
        // Log the full metadata object for debugging
        logger.debug("Full RODiT metadata in get_rodit_fromfile", {
          ...logContext,
          metadata: JSON.stringify(roditToken.metadata),
          subjectuniqueidentifier_url: roditToken.metadata.subjectuniqueidentifier_url
        });
      }
    } catch (error) {
      logger.warn("Error fetching RODiT token metadata from blockchain", {
        ...logContext,
        accountId,
        error: error.message
      });
      // Continue without the token metadata
    }
    
    // Return credentials with token metadata if available
    return validatedCredentials;
  } catch (error) {
    logger.error("Failed to get RODiT credentials from file", {
      ...logContext,
      error: error.message
    });
    throw error;
  }
}

/**
 * Initialize the file credential store
 * Similar interface to initializeProductionVault for easy switching
 * 
 * @returns {Promise<Object>} - Initialized store
 */
async function initializeFileStore() {
  return fileCredentialStore.initialize();
}

/**
 * Store a RODiT in file storage
 * Similar interface to store_rodit_tovault for easy switching
 * 
 * @param {Object} _unused1 - Unused parameter (for interface compatibility)
 * @param {string} roditId - RODiT ID
 * @param {Object} roditData - RODiT data to store
 * @returns {Promise<boolean>} - True if successful
 */
async function store_rodit_tofile(_unused1, roditId, roditData) {
  const requestId = ulid();
  const logContext = {
    component: "FileCredentialStore",
    method: "store_rodit_tofile",
    requestId,
    roditId
  };

  try {
    // Initialize the store if not already initialized
    await fileCredentialStore.initialize();
    
    // Store the RODiT using the instance method
    return await fileCredentialStore.store_rodit_tofile(roditId, roditData);
  } catch (error) {
    logger.error("Failed to store RODiT to file", {
      ...logContext,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  ...fileCredentialStore,
  setupRoditCredentialsFromFile,
  get_rodit_fromfile,
  initializeFileStore,
  store_rodit_tofile
};
