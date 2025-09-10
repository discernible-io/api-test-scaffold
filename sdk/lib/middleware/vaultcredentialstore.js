const config = require("../../services/config");
const bs58 = require("bs58");
const { ulid } = require("ulid");
const logger = require("../../services/logger");
const { createLogContext, logErrorWithMetrics } = logger;

logger.debugWithContext("Loading vaultcredentialstore.js module", createLogContext(
  "ModuleLoader",
  "moduleInitialization",
  {
    module: "vaultcredentialstore.js",
    loadedAt: new Date().toISOString()
  }
));

class ProductionVaultManager {
  constructor() {
    this.vault = require("node-vault")();
    this.vault.endpoint = config.get("VAULT_ENDPOINT");
    this.vault.apiVersion = "v1";
    this.roleId = config.get("VAULT_ROLE_ID");
    this.secretId = config.get("VAULT_SECRET_ID");
    this.renewalInterval = 60 * 60 * 1000; // 1 hour in milliseconds
    this.vaultInitialized = false;
    this.vaultPath = null;
    this.credentials = {};
  }

  async getProductionVaultToken() {
    const requestId = ulid();
    const startTime = Date.now();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "getProductionVaultToken",
      { requestId }
    );
    
    logger.infoWithContext("Attempting Vault authentication", {
      ...baseContext,
      result: 'call',
      reason: 'Vault authentication requested'
    });
    
    try {
      const result = await this.vault.approleLogin({
        role_id: this.roleId,
        secret_id: this.secretId,
      });
      
      logger.infoWithContext("Vault authentication successful", {
        ...baseContext,
        duration: Date.now() - startTime,
        result: 'success',
        reason: 'Vault authentication succeeded'
      });
      logger.metric("vault_authentication_duration_ms", Date.now() - startTime, {
        component: "CredentialManager",
        result: 'success',
        reason: 'Vault authentication succeeded'
      });
      
      return result.auth.client_token;
    } catch (error) {
      logger.metric("vault_authentication_duration_ms", Date.now() - startTime, {
        component: "CredentialManager",
        result: 'failure',
        reason: error.message || 'Vault authentication failed'
      });
      logErrorWithMetrics(
        "Error authenticating with Vault", 
        {
          ...baseContext,
          duration: Date.now() - startTime,
          result: 'failure',
          reason: error.message || 'Vault authentication failed'
        },
        error,
        "vault_authentication_error",
        { error_type: "auth_failure" }
      );
      throw new Error("Error 108: Vault authentication failed");
    }
  }

  async initialize() {
    const requestId = ulid();
    const startTime = Date.now();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "initialize",
      { requestId }
    );

    logger.infoWithContext("Starting vault initialization", {
      ...baseContext,
      result: 'call',
      reason: 'Vault initialization requested'
    });

    if (this.vaultInitialized) {
      logger.infoWithContext("Vault already initialized", {
        ...baseContext,
        duration: Date.now() - startTime,
        result: 'success',
        reason: 'Vault was already initialized'
      });
      return this.vault;
    }

    try {
      const token = await this.getProductionVaultToken();
      this.vault.token = token;
      
      logger.infoWithContext("Checking Vault health status", {
        ...baseContext,
        result: 'call',
        reason: 'Vault health status check requested'
      });
      
      const health = await this.vault.health();
      if (!health.initialized) {
        const error = new Error("Error 109: Vault is not initialized");
        logger.metric("vault_initialization_duration_ms", Date.now() - startTime, {
          component: "CredentialManager",
          result: 'failure',
          reason: error.message || 'Vault is not initialized'
        });
        logErrorWithMetrics(
          "Vault is not initialized", 
          {
            ...baseContext,
            result: 'failure',
            reason: error.message || 'Vault is not initialized'
          },
          error,
          "vault_initialization_error",
          { error_type: "not_initialized" }
        );
        throw error;
      }
      if (health.sealed) {
        const error = new Error("Error 110: Vault is sealed");
        logger.metric("vault_initialization_duration_ms", Date.now() - startTime, {
          component: "CredentialManager",
          result: 'failure',
          reason: error.message || 'Vault is sealed'
        });
        logErrorWithMetrics(
          "Vault is sealed", 
          {
            ...baseContext,
            result: 'failure',
            reason: error.message || 'Vault is sealed'
          },
          error,
          "vault_initialization_error",
          { error_type: "sealed" }
        );
        throw error;
      }

      try {
        // Check if config is available and has the required path
        if (config && typeof config.get === 'function') {
          this.vaultPath = config.get("VAULT_RODIT_KEYVALUE_PATH");
          logger.infoWithContext("Retrieved vault path from config", {
            ...baseContext,
            vaultPath: this.vaultPath,
            result: 'success',
            reason: 'Vault path retrieved from config'
          });
        } else {
          const error = new Error("Config object is not properly initialized");
          logger.metric("vault_initialization_duration_ms", Date.now() - startTime, {
            component: "CredentialManager",
            result: 'failure',
            reason: error.message || 'Vault initialization failed - configuration error'
          });
          logErrorWithMetrics(
            "Vault initialization failed - configuration error", 
            {
              ...baseContext,
              result: 'failure',
              reason: error.message || 'Vault initialization failed - configuration error'
            },
            error,
            "vault_initialization_error",
            { error_type: "config_initialization_error" }
          );
          throw error;
        }
      } catch (configError) {
        // Reset the vaultInitialized flag since initialization failed
        this.vaultInitialized = false;
        logger.metric("vault_initialization_duration_ms", Date.now() - startTime, {
          component: "CredentialManager",
          result: 'failure',
          reason: configError.message || 'Vault initialization failed - configuration error'
        });
        logErrorWithMetrics(
          "Vault initialization failed - configuration error", 
          {
            ...baseContext,
            result: 'failure',
            reason: configError.message || 'Vault initialization failed - configuration error'
          },
          configError,
          "vault_initialization_error",
          { error_type: "config_access_error" }
        );
        
        // Rethrow the error to prevent continuing with invalid configuration
        throw configError;
      }

      this.vaultInitialized = true;

      logger.infoWithContext("Vault initialization flags set", {
        ...baseContext,
        vaultInitialized: this.vaultInitialized,
        vaultPath: this.vaultPath,
        result: 'success',
        reason: 'Vault initialization flags set'
      });

      const duration = Date.now() - startTime;
      logger.infoWithContext("Vault initialized successfully", {
        ...baseContext,
        duration,
        result: 'success',
        reason: 'Vault initialized successfully'
      });
      // Add metrics for successful initialization
      logger.metric("vault_initialization_duration_ms", duration, {
        component: "CredentialManager",
        result: 'success',
        reason: 'Vault initialized successfully'
      });

      return this.vault;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.metric("vault_initialization_duration_ms", duration, {
        component: "CredentialManager",
        result: 'failure',
        reason: error.message || 'Vault initialization failed'
      });
      logErrorWithMetrics(
        "Vault initialization failed", 
        {
          ...baseContext,
          duration,
          result: 'failure',
          reason: error.message || 'Vault initialization failed'
        },
        error,
        "vault_initialization_error",
        { error_type: "initialization_failure" }
      );
      // Emit metrics for Grafana dashboards
      logger.metric("vault_initialization_duration_ms", duration, {
        success: false,
        component: "CredentialManager",
        errorType: error.code || "UNKNOWN_ERROR"
      });
      logger.metric("vault_initialization_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        component: "CredentialManager"
      });

      throw error;
    }
  }

  async setupTokenRenewal() {
    const requestId = ulid();
    const startTime = Date.now();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "setupTokenRenewal",
      { requestId }
    );
    
    logger.debugWithContext("Starting token renewal setup", baseContext);
    
    try {
      // Get token info to determine TTL
      const tokenInfo = await this.vault.tokenLookupSelf();
      const ttlSeconds = tokenInfo.data.ttl;
      
      // Calculate renewal time (renew at 80% of TTL)
      const renewalTimeMs = (ttlSeconds * 0.8) * 1000;
      
      logger.infoWithContext("Setting up token renewal", {
        ...baseContext,
        ttlSeconds,
        renewalIntervalMs: renewalTimeMs || this.renewalInterval,
        nextRenewalAt: new Date(Date.now() + (renewalTimeMs || this.renewalInterval)).toISOString(),
        duration: Date.now() - startTime
      });
      
      // Use calculated renewal time or fall back to default
      const interval = renewalTimeMs || this.renewalInterval;
      
      setInterval(async () => {
        const renewalRequestId = ulid();
        const renewalStartTime = Date.now();
        
        // Create a context for the renewal operation
        const renewalContext = createLogContext(
          "CredentialManager",
          "tokenRenewal",
          { requestId: renewalRequestId }
        );
        
        logger.debugWithContext("Attempting to renew Vault token", renewalContext);
        
        try {
          // Use proper token renewal instead of re-authenticating
          const renewResponse = await this.vault.tokenRenew();
          
          logger.infoWithContext("Successfully renewed Vault token", {
            ...renewalContext,
            newTtl: renewResponse.auth?.lease_duration || "unknown",
            duration: Date.now() - renewalStartTime
          });
          
          // Add metrics for successful renewal
          logger.metric("vault_token_renewal_duration_ms", Date.now() - renewalStartTime, {
            success: true,
            component: "CredentialManager"
          });
        } catch (error) {
          logErrorWithMetrics(
            "Error renewing Vault token, attempting re-authentication", 
            {
              ...renewalContext,
              duration: Date.now() - renewalStartTime
            },
            error,
            "vault_token_renewal_error",
            { error_type: "renewal_failure" }
          );
          
          try {
            // Fall back to re-authentication if renewal fails
            const token = await this.getProductionVaultToken();
            this.vault.token = token;
            
            logger.infoWithContext("Successfully re-authenticated with Vault", {
              ...renewalContext,
              duration: Date.now() - renewalStartTime
            });
            
            // Add metrics for successful re-authentication
            logger.metric("vault_token_reauthentication_duration_ms", Date.now() - renewalStartTime, {
              success: true,
              component: "CredentialManager"
            });
          } catch (reAuthError) {
            logErrorWithMetrics(
              "Failed to re-authenticate with Vault", 
              {
                ...renewalContext,
                duration: Date.now() - renewalStartTime
              },
              reAuthError,
              "vault_token_reauthentication_error",
              { error_type: "reauthentication_failure" }
            );
          }
        }
      }, interval);
      
      return true;
    } catch (error) {
      logErrorWithMetrics(
        "Error setting up token renewal", 
        {
          ...baseContext,
          duration: Date.now() - startTime
        },
        error,
        "vault_token_renewal_setup_error",
        { error_type: "setup_failure" }
      );
      return false;
    }
  }

  async getRoditFromVault(vaultPath, secretKey) {
    const requestId = ulid();
    const startTime = Date.now();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "getRoditFromVault",
      { 
        requestId,
        vaultPath,
        secretKey 
      }
    );
    
    this.validateVaultParameters(vaultPath, secretKey);

    try {
      logger.debugWithContext("Retrieving data from Vault", {
        ...baseContext,
        path: `secret/data/${vaultPath}`,
        endpoint: this.vault.endpoint,
        hasToken: !!this.vault.token
      });
      
      const result = await this.vault.read(`secret/data/${vaultPath}`);
      const secretData = result.data.data[secretKey];

      if (!secretData) {
        const error = new Error(
          `Error 048: No data found for ${secretKey} at secret/data/${vaultPath}`
        );
        
        logErrorWithMetrics(
          "No data found in Vault path", 
          baseContext,
          error,
          "vault_data_retrieval_error",
          { error_type: "data_not_found" }
        );
        
        throw error;
      }

      logger.debugWithContext("Successfully retrieved data from Vault", {
        ...baseContext,
        duration: Date.now() - startTime
      });
      
      const parsedData = this.parseSecretData(secretData, secretKey);
      return this.validateAndExtractCredentials(parsedData);
    } catch (error) {
      logErrorWithMetrics(
        "Error retrieving Rodit config from Vault", 
        {
          ...baseContext,
          duration: Date.now() - startTime,
          errorDetails: error.response?.data || error.response || "No details available",
          statusCode: error.response?.statusCode
        },
        error,
        "vault_data_retrieval_error",
        { error_type: "retrieval_failure" }
      );
      throw error;
    }
  }

  validateVaultParameters(vaultPath, secretKey) {
    const requestId = ulid();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "validateVaultParameters",
      { 
        requestId,
        vaultPath,
        secretKey 
      }
    );
    
    logger.debugWithContext("Validating Vault parameters", baseContext);
    
    if (!this.vault || typeof this.vault.read !== "function") {
      const error = new Error("Error 051: Invalid vault object");
      logErrorWithMetrics(
        "Invalid vault object", 
        baseContext,
        error,
        "vault_parameter_validation_error",
        { error_type: "invalid_vault" }
      );
      throw error;
    }
    if (!vaultPath || typeof vaultPath !== "string") {
      const error = new Error("Error 052: Invalid VAULT_RODIT_KEYVALUE_PATH");
      logErrorWithMetrics(
        "Invalid vault path", 
        baseContext,
        error,
        "vault_parameter_validation_error",
        { error_type: "invalid_path" }
      );
      throw error;
    }
    if (!secretKey || typeof secretKey !== "string") {
      const error = new Error("Error 047: Invalid or missing secretKey parameter");
      logErrorWithMetrics(
        "Invalid secret key", 
        baseContext,
        error,
        "vault_parameter_validation_error",
        { error_type: "invalid_key" }
      );
      throw error;
    }
    
    logger.debugWithContext("Vault parameters validated successfully", baseContext);
  }

  parseSecretData(secretData, secretKey) {
    const requestId = ulid();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "parseSecretData",
      { 
        requestId,
        secretKey,
        dataType: typeof secretData
      }
    );
    
    logger.debugWithContext("Parsing secret data", baseContext);
    
    if (typeof secretData === "string") {
      try {
        const parsedData = JSON.parse(secretData);
        logger.debugWithContext("Successfully parsed secret data", baseContext);
        return parsedData;
      } catch (parseError) {
        const error = new Error(`Error 046: Invalid JSON format in ${secretKey}`);
        logErrorWithMetrics(
          "Failed to parse secret data", 
          baseContext,
          parseError,
          "vault_data_parsing_error",
          { error_type: "invalid_json" }
        );
        throw error;
      }
    }
    
    logger.debugWithContext("Secret data already in object format", baseContext);
    return secretData;
  }

  validateAndExtractCredentials(parsedData) {
    const requestId = ulid();
    const startTime = Date.now();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "validateAndExtractCredentials",
      { requestId }
    );
    
    logger.debugWithContext("Validating credential data", baseContext);
    
    // Bind methods to preserve 'this' context
    const stripEd25519Prefix = this.stripEd25519Prefix.bind(this);
    const publicKeyToImplicitId = this.publicKeyToImplicitId.bind(this);
  
    if (parsedData.implicit_account_id) {
      const { implicit_account_id, private_key, public_key } = parsedData;
      
      if (!implicit_account_id || typeof implicit_account_id !== "string") {
        throw new Error("Error 244: Invalid or missing implicit_account_id value");
      }
      
      if (!private_key || typeof private_key !== "string") {
        throw new Error("Error 043: Invalid or missing private_key value");
      }
      
      // Log private key format before processing
      logger.debugWithContext("Processing private key from vault", {
        ...baseContext,
        privateKeyFormat: "string",
        privateKeyLength: private_key.length,
        hasPrefix: private_key.startsWith('ed25519:')
      });
  
      if (public_key) {
        // Try both hex and base58 formats for comparison
        const calculatedImplicitIdHex = publicKeyToImplicitId(public_key, 'hex');
        const calculatedImplicitIdBase58 = publicKeyToImplicitId(public_key, 'base58');
        
        // Add very detailed logging to help diagnose the mismatch
        logger.debugWithContext("Comparing implicit IDs with multiple formats", {
          ...baseContext,
          storedImplicitId: implicit_account_id,
          calculatedImplicitIdHex,
          calculatedImplicitIdBase58,
          publicKeyLength: public_key.length,
          publicKeyFirstChars: public_key.substring(0, 10) + '...',
          hasPrefix: public_key.startsWith('ed25519:'),
          matchHex: implicit_account_id === calculatedImplicitIdHex,
          matchBase58: implicit_account_id === calculatedImplicitIdBase58,
          storedIdLength: implicit_account_id.length,
          hexIdLength: calculatedImplicitIdHex.length,
          // Add more debug info about the key and IDs
          storedIdIsHex: /^[0-9a-f]+$/i.test(implicit_account_id),
          calculatedHexIsHex: /^[0-9a-f]+$/i.test(calculatedImplicitIdHex)
        });
        
        // Check if the stored ID matches either format
        const matchesHex = implicit_account_id === calculatedImplicitIdHex;
        const matchesBase58 = implicit_account_id === calculatedImplicitIdBase58;
        
        if (!matchesHex && !matchesBase58) {
          // If neither format matches, log a warning and throw the error
          logger.warnWithContext(
            "Implicit account ID mismatch detected", 
            {
              ...baseContext,
              storedImplicitId: implicit_account_id,
              calculatedImplicitIdHex,
              calculatedImplicitIdBase58
            }
          );
          throw new Error("Error 246: implicit_account_id does not match public_key");
        } else {
          // If one format matches, log which one matched
          logger.infoWithContext(
            "Implicit account ID matched successfully", 
            {
              ...baseContext,
              matchFormat: matchesHex ? 'hex' : 'base58'
            }
          );
        }
      }
  
      // Convert the private key string to Uint8Array using bs58
      const privateKeyStr = stripEd25519Prefix(private_key);
      const signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
      
      // Log the conversion result
      logger.debugWithContext("Converted private key to Uint8Array", {
        ...baseContext,
        strippedKeyLength: privateKeyStr.length,
        bytesKeyLength: signing_bytes_key.length,
        isUint8Array: signing_bytes_key instanceof Uint8Array,
        // DEV ONLY - Show first few bytes
        keyFirstBytes: Array.from(signing_bytes_key.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')
      });
      
      return {
        account_id: implicit_account_id, // Use implicit_account_id as account_id
        implicit_account_id,
        private_key: privateKeyStr,
        signing_bytes_key // Add the Uint8Array version of the private key
      };
    }
  
    const { account_id, public_key, private_key } = parsedData;
    
    if (!account_id || typeof account_id !== "string") {
      throw new Error("Error 244: Invalid or missing account_id value");
    }
    
    if (!public_key || typeof public_key !== "string") {
      throw new Error("Error 245: Invalid or missing public_key value");
    }
    
    if (!private_key || typeof private_key !== "string") {
      throw new Error("Error 043: Invalid or missing private_key value");
    }

    // Convert the private key string to Uint8Array using bs58
    const privateKeyStr = stripEd25519Prefix(private_key);
    const signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
    
    // Log the conversion result
    logger.debugWithContext("Converted private key to Uint8Array (standard account)", {
      ...baseContext,
      strippedKeyLength: privateKeyStr.length,
      bytesKeyLength: signing_bytes_key.length,
      isUint8Array: signing_bytes_key instanceof Uint8Array,
      // DEV ONLY - Show first few bytes
      keyFirstBytes: Array.from(signing_bytes_key.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')
    });
    
    return {
      account_id,
      implicit_account_id: publicKeyToImplicitId(public_key, 'hex'), // Use hex format consistently
      private_key: privateKeyStr,
      signing_bytes_key // Add the Uint8Array version of the private key
    };
  }

  stripEd25519Prefix(key) {
    const requestId = ulid();
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "stripEd25519Prefix",
      { 
        requestId,
        keyType: typeof key,
        hasPrefix: key && typeof key === 'string' && key.startsWith('ed25519:')
      }
    );
    
      logger.debugWithContext("Stripping ed25519 prefix from key", baseContext);
    
    if (!key || typeof key !== 'string') {
      const error = new Error("Error 053: Invalid key format");
      logErrorWithMetrics(
        "Invalid key format for prefix stripping", 
        baseContext,
        error,
        "key_processing_error",
        { error_type: "invalid_key_format" }
      );
      throw error;
    }
    
    return key.replace("ed25519:", "");
  }
  
  publicKeyToImplicitId(publicKey, outputFormat = 'hex') {
    const requestId = ulid();
    // When packaged as @rodit/rodit-auth-be, utils lives at package root: ../../utils
    const utils = require('../../utils');
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "publicKeyToImplicitId",
      { 
        requestId,
        keyType: typeof publicKey,
        outputFormat
      }
    );
    
    logger.debugWithContext("Converting public key to implicit ID", baseContext);
    
    if (!publicKey || typeof publicKey !== 'string') {
      const error = new Error("Error 054: Invalid public key format");
      logErrorWithMetrics(
        "Invalid public key format", 
        baseContext,
        error,
        "key_processing_error",
        { error_type: "invalid_public_key_format" }
      );
      throw error;
    }
    
    try {
      // Use the shared implementation from utils.js
      const implicit_id = utils.publicKeyToImplicitId(publicKey, outputFormat);
      
      logger.debugWithContext("Successfully converted public key to implicit ID", {
        ...baseContext,
        outputFormat,
        idLength: implicit_id.length
      });
      
      return implicit_id;
    } catch (error) {
      logErrorWithMetrics(
        "Error converting public key to implicit ID", 
        baseContext,
        error,
        "key_processing_error",
        { error_type: "conversion_error" }
      );
      throw error;
    }
  }

  async getCredentials(type) {
    const requestId = ulid();
    const startTime = Date.now();
    const maxRetries = 2; // Maximum number of retry attempts
    let retryCount = 0;
    let lastError = null;
    
    // Create a base context for this method
    const baseContext = createLogContext(
      "CredentialManager",
      "getCredentials",
      { 
        requestId,
        credentialType: type
      }
    );

    logger.debugWithContext("Retrieving credentials", baseContext);

    // Use cached credentials if available
    if (this.credentials[type]) {
      logger.debugWithContext("Using cached credentials", baseContext);
      return this.credentials[type];
    }

    // Make sure vault is initialized
    if (!this.vaultInitialized) {
      logger.debugWithContext("Vault not initialized, initializing now", baseContext);
      await this.initialize();
    }

    // Retry logic for vault operations
    while (retryCount <= maxRetries) {
      try {
        // Make the accountType consistent with the type parameter
        const accountType = `account_${type}`;
        const vaultPath = `${this.vaultPath}/${type}`;

        logger.debugWithContext("Fetching credentials from vault", {
          ...baseContext,
          vaultPath,
          attempt: retryCount + 1,
          maxAttempts: maxRetries + 1
        });

        const vaultData = await this.getRoditFromVault(
          vaultPath,
          accountType
        );

        // Add detailed logging about the vault data received
        logger.debugWithContext("Vault data received", {
          ...baseContext,
          hasVaultData: !!vaultData,
          dataKeys: vaultData ? Object.keys(vaultData) : [],
          hasPrivateKey: vaultData && !!vaultData.private_key
        });

        // Safely check for private_key before using it
        if (!vaultData || !vaultData.private_key || typeof vaultData.private_key !== "string") {
          const error = new Error(`Invalid or missing private_key for ${type}`);
          logErrorWithMetrics(
            "Invalid private key format", 
            baseContext,
            error,
            "credential_retrieval_error",
            { error_type: "invalid_private_key" }
          );
          throw error;
        }

        // Cache the credentials for future use
        this.credentials[type] = vaultData;
        
        const duration = Date.now() - startTime;
        logger.infoWithContext("Successfully retrieved credentials", {
          ...baseContext,
          duration,
          accountId: vaultData.account_id // Safe to log account ID
        });

        // Emit metrics for Grafana dashboards
        logger.metric("credential_retrieval_duration_ms", duration, {
          success: true,
          credentialType: type,
          component: "CredentialManager"
        });

        return vaultData;
      } catch (error) {
        lastError = error;
        
        // Log the error but don't throw yet if we have retries left
        const isRetrying = retryCount < maxRetries;
        const duration = Date.now() - startTime;
        
        if (isRetrying) {
          logger.warnWithContext(`Retryable error retrieving credentials`, {
            ...baseContext,
            duration,
            errorMessage: error.message,
            errorCode: error.code || "UNKNOWN_ERROR",
            attempt: retryCount + 1,
            willRetry: true
          });
          
          // Emit metrics for Grafana dashboards
          logger.metric("credential_retrieval_duration_ms", duration, {
            success: false,
            credentialType: type,
            errorType: error.code || "UNKNOWN_ERROR",
            component: "CredentialManager",
            retryAttempt: retryCount
          });
          
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          continue;
        }
        
        // If we've exhausted retries, log and throw the last error
        logErrorWithMetrics(
          "Failed to retrieve credentials after all retry attempts", 
          {
            ...baseContext,
            duration,
            attempts: retryCount + 1,
            maxAttempts: maxRetries + 1
          },
          lastError,
          "credential_retrieval_error",
          { error_type: "max_retries_exceeded" }
        );
        
        // Emit metrics for Grafana dashboards
        logger.metric("credential_retrieval_errors_total", 1, {
          credentialType: type,
          errorType: error.code || "UNKNOWN_ERROR",
          component: "CredentialManager"
        });
        
        throw lastError;
      }
    }
  }
}

const vaultManager = new ProductionVaultManager();

module.exports = {
  initializeProductionCredentialStore: () => vaultManager.initialize(),
  get_rodit_fromvault: (vault, path, secretKey) =>
    vaultManager.getRoditFromVault(path, secretKey),
  setupTokenRenewal: () => vaultManager.setupTokenRenewal(),
  getCredentials: (type) => vaultManager.getCredentials(type),
  vault: vaultManager.vault,
};
