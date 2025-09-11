/**
 * File-based credential storage system
 * Alternative to Vault for storing RODiT credentials
 * 
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

const fs = require('fs').promises;
const bs58 = require("bs58");
const path = require("path");
const crypto = require('crypto');
const { ulid } = require("ulid");
const config = require('../../services/config');
const logger = require("../../services/logger");
const { createLogContext, logErrorWithMetrics } = logger;
const { validateAndExtractCredentials, validateCredentialParameters } = require("../../utils");

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
    
    const baseContext = createLogContext(
      "FileCredentialStore",
      "initialize",
      {
        requestId,
        hasConfigPath: !!options.configPath,
        hasEncryptionKey: !!options.encryptionKey,
        initialized: this.initialized
      }
    );

    logger.debugWithContext("Initializing file credential store", baseContext);

    if (this.initialized) {
      logger.debugWithContext("File credential store already initialized", baseContext);
      return this;
    }

    try {
      // Get configuration path from environment or config
      this.configPath = config.get('NEAR_CREDENTIALS_FILE_PATH');
      
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });

      // Set encryption key if provided
      if (options.encryptionKey) {
        this.encryptionKey = options.encryptionKey;
        logger.debugWithContext("Encryption key set for credential store", baseContext);
      }

      // Check if credentials file exists and load it
      try {
        // Check file existence and permissions
        let fileExists = false;
        let fileStats = null;
        
        try {
          fileStats = await fs.stat(this.configPath);
          fileExists = true;
          
          logger.debugWithContext("Checking file permissions", {
            ...baseContext,
            filePath: this.configPath,
            isFile: fileStats.isFile(),
            isDirectory: fileStats.isDirectory(),
            mode: fileStats.mode.toString(8),
            uid: fileStats.uid,
            gid: fileStats.gid,
            size: fileStats.size
          });
          
          // Check read permissions
          await fs.access(this.configPath, fs.constants.R_OK);
          logger.debugWithContext("File is readable", {
            ...baseContext,
            filePath: this.configPath
          });
        } catch (accessError) {
          logger.warnWithContext("File access check failed", {
            ...baseContext,
            filePath: this.configPath,
            error: accessError.message,
            code: accessError.code,
            errno: accessError.errno,
            syscall: accessError.syscall
          });
          fileExists = false;
        }

        if (fileExists) {
          logger.debugWithContext("Reading credentials file", {
            ...baseContext,
            filePath: this.configPath
          });
          
          const fileContent = await fs.readFile(this.configPath, 'utf8');
          
          if (fileContent.trim()) {
            const parsedContent = JSON.parse(fileContent);
            
            // Decrypt if necessary
            if (this.encryptionKey && parsedContent.encrypted) {
              this.credentials = this.decryptCredentials(parsedContent.data);
              logger.debugWithContext("Decrypted credentials from file", baseContext);
            } else {
              this.credentials = parsedContent;
            }
            
            logger.infoWithContext("Loaded credentials from file", {
              ...baseContext,
              configPath: this.configPath,
              credentialCount: Object.keys(this.credentials).length,
              fileStats: fileStats ? {
                size: fileStats.size,
                mtime: fileStats.mtime,
                mode: fileStats.mode.toString(8),
                uid: fileStats.uid,
                gid: fileStats.gid
              } : null
            });
          } else {
            logger.infoWithContext("Credentials file exists but is empty", {
              ...baseContext,
              configPath: this.configPath
            });
            this.credentials = {};
          }
        } else {
          logger.infoWithContext("Credentials file does not exist, will be created when needed", {
            ...baseContext,
            configPath: this.configPath
          });
          this.credentials = {};
        }
      } catch (fileError) {
        logErrorWithMetrics(
          "Failed to load credentials file, creating new one",
          {
            ...baseContext,
            configPath: this.configPath
          },
          fileError,
          "credential_store_file_error",
          {
            result: "error",
            reason: "file_access_error"
          }
        );
        this.credentials = {};
      }

      this.initialized = true;
      
      const duration = Date.now() - startTime;
      logger.infoWithContext("File credential store initialized successfully", {
        ...baseContext,
        duration,
        configPath: this.configPath,
        credentialCount: Object.keys(this.credentials).length
      });
      
      // Add metric for successful initialization
      logger.metric("credential_store_operations", duration, {
        operation: "initialize",
        result: "success"
      });
      
      return this;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Failed to initialize file credential store",
        {
          ...baseContext,
          duration
        },
        error,
        "credential_store_error",
        {
          operation: "initialize",
          result: "error",
          duration
        }
      );
      
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
    
    const baseContext = createLogContext(
      "FileCredentialStore",
      "saveCredentials",
      {
        requestId,
        configPath: this.configPath,
        credentialCount: Object.keys(this.credentials).length
      }
    );

    logger.debugWithContext("Saving credentials to file", baseContext);

    try {
      // Prepare data for saving
      let dataToSave;
      
      if (this.encryptionKey) {
        dataToSave = {
          encrypted: true,
          data: this.encryptCredentials(this.credentials)
        };
        logger.debugWithContext("Encrypting credentials before saving", baseContext);
      } else {
        dataToSave = this.credentials;
      }
      
      // Write to file
      await fs.writeFile(this.configPath, JSON.stringify(dataToSave, null, 2), 'utf8');
      
      const duration = Date.now() - startTime;
      logger.infoWithContext("Credentials saved to file successfully", {
        ...baseContext,
        duration,
        encrypted: !!this.encryptionKey
      });
      
      // Add metric for successful save operation
      logger.metric("credential_store_operations", duration, {
        operation: "save",
        result: "success",
        encrypted: !!this.encryptionKey
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Failed to save credentials to file",
        {
          ...baseContext,
          duration
        },
        error,
        "credential_store_error",
        {
          operation: "save",
          result: "error",
          reason: "file_write_error",
          duration
        }
      );
      
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
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "FileCredentialStore",
      "getCredential",
      {
        requestId,
        key,
        exists: this.credentials.hasOwnProperty(key)
      }
    );
    
    logger.debugWithContext("Getting credential", baseContext);
    
    try {
      const credential = this.credentials[key];
      
      const duration = Date.now() - startTime;
      logger.debugWithContext("Retrieved credential", {
        ...baseContext,
        duration,
        found: !!credential
      });
      
      // Add metric for credential retrieval
      logger.metric("credential_store_operations", duration, {
        operation: "get",
        result: credential ? "success" : "not_found"
      });
      
      return credential;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Error retrieving credential",
        {
          ...baseContext,
          duration
        },
        error,
        "credential_store_error",
        {
          operation: "get",
          result: "error",
          duration
        }
      );
      
      throw error;
    }
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
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "FileCredentialStore",
      "setCredential",
      {
        requestId,
        key,
        save
      }
    );
    
    logger.debugWithContext("Setting credential", baseContext);

    try {
      this.credentials[key] = value;

      if (save) {
        logger.debugWithContext("Saving credential to file", baseContext);
        await this.saveCredentials();
      }

      const duration = Date.now() - startTime;
      logger.infoWithContext("Credential set successfully", {
        ...baseContext,
        duration
      });
      
      // Add metric for credential setting
      logger.metric("credential_store_operations", duration, {
        operation: "set",
        result: "success",
        saved: save
      });
      
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Error setting credential",
        {
          ...baseContext,
          duration
        },
        error,
        "credential_store_error",
        {
          operation: "set",
          result: "error",
          saved: false,
          duration
        }
      );
      
      throw error;
    }
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
async function setupRoditCredentialsFromFile(config_own_rodit) {
  const requestId = ulid();
  const startTime = Date.now();
  
  const baseContext = createLogContext(
    "FileCredentialStore",
    "setupRoditCredentialsFromFile",
    {
      requestId
    }
  );

  logger.debugWithContext("Setting up RODiT credentials from file", baseContext);

  try {
    // Initialize the store if not already initialized
    logger.debugWithContext("Initializing credential store", baseContext);
    await fileCredentialStore.initialize();
    
    // Check if credentials file exists
    const credentialPath = fileCredentialStore.configPath;
    const fileExists = await fs.access(credentialPath)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      const duration = Date.now() - startTime;
      
      logger.warnWithContext("NEAR credentials file not found", {
        ...baseContext,
        duration,
        path: credentialPath
      });
      
      // Add metric for missing credentials file
      logger.metric("credential_store_operations", duration, {
        operation: "setup_rodit",
        result: "error",
        reason: "file_not_found"
      });
      
      return config_own_rodit;
    }
    
    // Read the credentials file directly to get the exact format
    const fileContent = await fs.readFile(credentialPath, 'utf8');
    const credentials = JSON.parse(fileContent);
    
    logger.infoWithContext("NEAR credentials loaded from file", {
      ...baseContext,
      accountId: credentials.account_id || credentials.implicit_account_id
    });
    
    // Extract the credentials
    const { privateKey, publicKey, accountId } = validateAndExtractCredentials(credentials);
    
    if (!privateKey || !publicKey || !accountId) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Invalid NEAR credentials format",
        {
          ...baseContext,
          duration,
          hasPrivateKey: !!privateKey,
          hasPublicKey: !!publicKey,
          hasAccountId: !!accountId
        },
        new Error("Invalid NEAR credentials format"),
        "credential_store_error",
        {
          operation: "setup_rodit",
          result: "error",
          reason: "invalid_format",
          duration
        }
      );
      
      throw new Error("Invalid NEAR credentials format");
    }
    
    // Update the configuration with the credentials
    config_own_rodit = config_own_rodit || {};
    // Load the token metadata from the blockchain
    const { nearorg_rpc_tokensfromaccountid } = require('../blockchain/blockchainservice');
    
    logger.debugWithContext("Loading RODiT metadata from blockchain", {
      ...baseContext,
      accountId
    });
    
    // Fetch the RODiT token from the blockchain using the account ID
    const roditToken = await nearorg_rpc_tokensfromaccountid(accountId);
    
    if (!roditToken || !roditToken.metadata || !roditToken.metadata.subjectuniqueidentifier_url) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "Failed to load token metadata from blockchain",
        {
          ...baseContext,
          duration,
          accountId
        },
        new Error("Failed to load token metadata from blockchain"),
        "credential_store_error",
        {
          operation: "setup_rodit",
          result: "error",
          reason: "missing_metadata",
          duration
        }
      );
      
      throw new Error('Failed to load token metadata from blockchain');
    }
    
    // Log the token metadata from blockchain
    logger.debugWithContext("RODiT token metadata from blockchain", {
      ...baseContext,
      tokenId: roditToken.token_id,
      metadataKeys: Object.keys(roditToken.metadata),
      subjectuniqueidentifier_url: roditToken.metadata.subjectuniqueidentifier_url
    });
    
    // Set up RODiT credentials in the config object with metadata from blockchain
    // Using config_own_rodit structure for consistency with ClientStateManager
    config_own_rodit.own_rodit = {
      token_id: roditToken.token_id,
      metadata: roditToken.metadata,
      account_id: accountId
    };
    
    // Log the final config structure
    logger.debugWithContext("Final config structure after setting config_own_rodit", {
      ...baseContext,
      hasConfigOwnRodit: !!config_own_rodit.own_rodit,
      configOwnRoditKeys: config_own_rodit.own_rodit ? Object.keys(config_own_rodit.own_rodit) : [],
      hasMetadata: config_own_rodit.own_rodit ? !!config_own_rodit.own_rodit.metadata : false
    });
    
    const duration = Date.now() - startTime;
    logger.infoWithContext("RODiT credentials set up successfully", {
      ...baseContext,
      duration,
      accountId
    });
    
    // Add metric for successful setup
    logger.metric("credential_store_operations", duration, {
      operation: "setup_rodit",
      result: "success"
    });
    
    return config_own_rodit;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Failed to setup RODiT credentials from file",
      {
        ...baseContext,
        duration
      },
      error,
      "credential_store_error",
      {
        operation: "setup_rodit",
        result: "error",
        reason: "unexpected",
        duration
      }
    );
    
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
  const startTime = Date.now();
  
  const baseContext = createLogContext(
    "FileCredentialStore",
    "get_rodit_fromfile",
    {
      requestId,
      credentialType
    }
  );

  logger.debugWithContext("Getting RODiT credentials from file", baseContext);

  try {
    // If configPath is not provided, use the one from fileCredentialStore
    const effectiveConfigPath = configPath || fileCredentialStore.configPath;
    
    // Validate parameters
    logger.debugWithContext("Validating credential parameters", {
      ...baseContext,
      configPath: effectiveConfigPath
    });
    
    validateCredentialParameters(effectiveConfigPath, credentialType);
    
    // Initialize the store if not already initialized
    logger.debugWithContext("Initializing credential store", baseContext);
    await fileCredentialStore.initialize();
    
    // Check if credentials file exists
    const credentialPath = fileCredentialStore.configPath;
    const fileExists = await fs.access(credentialPath)
      .then(() => true)
      .catch(() => false);
    
    if (!fileExists) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        "NEAR credentials file not found",
        {
          ...baseContext,
          duration,
          path: credentialPath
        },
        new Error(`Error 049: Credentials file not found at ${credentialPath}`),
        "credential_store_error",
        {
          operation: "get_rodit",
          result: "error",
          reason: "file_not_found",
          duration
        }
      );
      
      throw new Error(`Error 049: Credentials file not found at ${credentialPath}`);
    }
    
    // Read the credentials file directly to get the exact format
    logger.debugWithContext("Reading credentials file", {
      ...baseContext,
      path: credentialPath
    });
    
    const fileContent = await fs.readFile(credentialPath, 'utf8');
    const fileCredentials = JSON.parse(fileContent);
    
    // Use the shared validation function to process credentials
    logger.debugWithContext("Validating credential structure", baseContext);
    const validatedCredentials = validateAndExtractCredentials(fileCredentials);
    
    // Get the account ID from the credentials
    const accountId = validatedCredentials.account_id;
    
    // Log the validated credential structure for debugging
    logger.debugWithContext("Validated credential structure", {
      ...baseContext,
      hasAccountId: !!validatedCredentials.account_id,
      hasPrivateKey: !!validatedCredentials.private_key,
      hasPublicKey: !!validatedCredentials.public_key,
      hasImplicitId: !!validatedCredentials.implicit_account_id
    });
    
    // Load the token metadata from the blockchain
    const { nearorg_rpc_tokensfromaccountid } = require('../blockchain/blockchainservice');
    
    logger.debugWithContext("Fetching RODiT token metadata from blockchain", {
      ...baseContext,
      accountId,
      hasImplicitId: !!validatedCredentials.implicit_account_id
    });
    
    // Fetch the RODiT token from the blockchain using the account ID
    const roditToken = await nearorg_rpc_tokensfromaccountid(accountId);
    
    // Validate token metadata
    if (!roditToken || !roditToken.metadata || !roditToken.metadata.subjectuniqueidentifier_url) {
      logger.warnWithContext("Failed to load complete token metadata from blockchain", {
        ...baseContext,
        accountId,
        hasToken: !!roditToken,
        hasMetadata: roditToken ? !!roditToken.metadata : false,
        hasEndpoint: roditToken && roditToken.metadata ? !!roditToken.metadata.subjectuniqueidentifier_url : false
      });
      
      // Add metric for incomplete token metadata
      logger.metric("credential_store_operations", Date.now() - startTime, {
        operation: "get_rodit",
        result: "warning",
        reason: "incomplete_metadata"
      });
    }
    
    // Prepare credentials in the expected format
    logger.debugWithContext("Preparing credential data structure", baseContext);
    
    const credentialData = {
      private_key: fileCredentials.private_key,
      public_key: fileCredentials.public_key,
      account_id: accountId,
      implicit_account_id: validatedCredentials.implicit_account_id,
      token_id: roditToken ? roditToken.token_id : null,
      config_own_rodit: roditToken ? {
        token_id: roditToken.token_id,
        metadata: roditToken.metadata
      } : null
    };

    // Process private key format
    const privateKeyStr = credentialData.private_key.startsWith("ed25519:")
      ? credentialData.private_key.replace("ed25519:", "")
      : credentialData.private_key;

    // Create signing key bytes
    credentialData.signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
    
    const duration = Date.now() - startTime;
    logger.infoWithContext("Credentials retrieved successfully from file", {
      ...baseContext,
      duration,
      hasSigningKey: !!credentialData.signing_bytes_key
    });

    // Emit metrics for Grafana dashboards
    logger.metric("credential_store_operations", duration, {
      operation: "get_rodit",
      result: "success",
      credentialType,
      source: "file"
    });

    return credentialData;
  } catch (error) {
    const duration = Date.now() - startTime;
    
    logErrorWithMetrics(
      "Failed to get RODiT credentials from file",
      {
        ...baseContext,
        duration
      },
      error,
      "credential_store_error",
      {
        operation: "get_rodit",
        result: "error",
        credentialType,
        source: "file",
        duration
      }
    );
    
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
  // Match vaultcredentialstore.js interface
  initializeProductionCredentialStore: async () => {
    const requestId = ulid();
    
    const baseContext = createLogContext(
      'FileCredentialStore',
      'initializeProductionCredentialStore',
      { requestId }
    );
    
    logger.debugWithContext('Initializing file credential store for production', baseContext);
    
    try {
      // Get the credentials file path from config
      const credentialsFilePath = config.get('NEAR_CREDENTIALS_FILE_PATH');
      
      if (!credentialsFilePath) {
        throw new Error('NEAR_CREDENTIALS_FILE_PATH is not set in config');
      }
      
      // Initialize the store with the credentials file path
      const store = await fileCredentialStore.initialize({
        configPath: credentialsFilePath
      });
      
      logger.debugWithContext('Successfully initialized file credential store', {
        ...baseContext,
        configPath: credentialsFilePath
      });
      
      return store;
    } catch (error) {
      logger.error('Failed to initialize file credential store', {
        ...baseContext,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  },
  setupTokenRenewal: async (store) => {
    // No-op for file store, but maintain interface compatibility
    const requestId = ulid();
    
    const baseContext = createLogContext(
      'FileCredentialStore',
      'setupTokenRenewal',
      { requestId }
    );
    
    logger.debugWithContext('Token renewal not needed for file-based credentials', baseContext);
    
    // Add metric for token renewal check
    logger.metric("credential_store_operations", 0, {
      operation: "token_renewal",
      result: "skipped",
      store_type: "file"
    });
    
    return true;
  },
  getCredentials: async (type) => {
    // Get credentials from file store
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      'FileCredentialStore',
      'getCredentials',
      { 
        requestId,
        credentialType: type 
      }
    );
    
    logger.debugWithContext('Getting credentials from file store', baseContext);
    
    try {
      // Initialize the file credential store if not already initialized
      const store = await fileCredentialStore.initialize();
      
      // Get the credentials from the file store
      const credentials = await store.getCredential('rodit');
      
      if (!credentials) {
        const errorMsg = `No credentials found in file store. Checked path: ${store.configPath}`;
        logger.errorWithContext(errorMsg, baseContext);
        throw new Error(errorMsg);
      }
      const filePath = credentials.filePath;
      
      logger.debugWithContext('Retrieving credentials from file', {
        ...baseContext,
        filePath
      });
      
      const result = await get_rodit_fromfile(null, filePath, type);
      
      const duration = Date.now() - startTime;
      logger.infoWithContext('Successfully retrieved credentials', {
        ...baseContext,
        duration
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logErrorWithMetrics(
        'Failed to get credentials',
        {
          ...baseContext,
          duration
        },
        error,
        'credential_store_error',
        {
          operation: 'get_credentials',
          result: 'error',
          credentialType: type,
          duration
        }
      );
      
      throw error;
    }
  },
  vault: null, // No vault for file store, but maintain interface compatibility
  
  // Original exports
  ...fileCredentialStore,
  setupRoditCredentialsFromFile,
  get_rodit_fromfile,
  initializeFileStore,
  store_rodit_tofile
};
