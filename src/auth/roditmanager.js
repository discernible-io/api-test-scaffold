// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

/**
 * RODiT Manager Service
 * Responsible for managing RODiT configurations, credentials, and vault interactions
 */

const bs58 = require("bs58");
const { ulid } = require("ulid");
const config = require("config");
const logger = require("../../config/logger");
const {
  initializeProductionVault,
  get_rodit_fromvault,
  setupTokenRenewal,
  vault,
} = require("../middleware/vaultsetup-production");
const {
  nearorg_rpc_state,
  nearorg_rpc_tokensfromaccountid,
  CONSTANTS,
} = require("../blockchain/blockchainservice");
const stateManager = require("../blockchain/statemanager");


logger.debug("Loading roditmanager.js module", {
  component: "ModuleLoader",
  module: "roditmanager.js",
  loadedAt: new Date().toISOString()
});
/**
 * RoditManager class
 * Singleton class for managing RODiT configurations and credentials
 */
class RoditManager {
  constructor() {
    const instanceId = ulid();

    logger.debug("RoditManager constructor called", {
      component: "RoditManager",
      instanceId,
      hasExistingInstance: !!RoditManager.instance,
      existingInstanceId: RoditManager.instance ? RoditManager.instance._instanceId : null
    });
    if (RoditManager.instance) {
      logger.debug("Returning existing RoditManager instance", {
        component: "RoditManager",
        instanceId: RoditManager.instance._instanceId
      });
      return RoditManager.instance;
    }

    this._instanceId = instanceId; // Store the instance ID
    logger.debug("Creating new RoditManager instance", {
      component: "RoditManager",
      instanceId: this._instanceId
    });

    this.stateManager = stateManager;
    this.vaultInitialized = false;
    this.vaultPath = null;
    this.credentials = {
      portal: null,
      sanctum: null,
      server: null,
      client: null,
    };

    RoditManager.instance = this;
  }

async initializeVault() {
  const requestId = ulid();
  const startTime = Date.now();

  logger.debug("Starting vault initialization", {
    component: "RoditManager",
    method: "initializeVault",
    requestId,
    instanceId: this._instanceId,
    vaultInitialized: this.vaultInitialized
  });

  if (this.vaultInitialized) {
    logger.debug("Vault already initialized", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId
    });
    return vault;
  }

  try {
    logger.debug("Calling initializeProductionVault", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId
    });
    
    const vaultInstance = await initializeProductionVault();
    
    logger.debug("initializeProductionVault returned", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId,
      hasVaultInstance: !!vaultInstance,
      hasToken: !!(vaultInstance && vaultInstance.token)
    });
    
    logger.debug("Setting up token renewal", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId
    });
    
    await setupTokenRenewal(vaultInstance);
    
    logger.debug("Token renewal setup complete", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId
    });
    
    this.vaultInitialized = true;
    
    try {
      // Check if config is available and has the required path
      if (config && typeof config.get === 'function') {
        this.vaultPath = config.get("VAULT_RODIT_KEYVALUE_PATH");
        logger.debug("Retrieved vault path from config", {
          component: "RoditManager",
          method: "initializeVault",
          requestId,
          vaultPath: this.vaultPath
        });
      } else {
        const error = new Error("Config object is not properly initialized");
        logger.error("Vault initialization failed - configuration error", {
          component: "RoditManager",
          method: "initializeVault",
          requestId,
          errorMessage: error.message,
          errorCode: "CONFIG_INITIALIZATION_ERROR"
        });
        throw error;
      }
    } catch (configError) {
      // Reset the vaultInitialized flag since initialization failed
      this.vaultInitialized = false;
      
      logger.error("Vault initialization failed - configuration error", {
        component: "RoditManager",
        method: "initializeVault",
        requestId,
        errorMessage: configError.message,
        errorCode: "CONFIG_ACCESS_ERROR",
        stack: configError.stack
      });
      
      // Rethrow the error to prevent continuing with invalid configuration
      throw configError;
    }

    logger.debug("Vault initialization flags set", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId,
      vaultInitialized: this.vaultInitialized,
      vaultPath: this.vaultPath
    });

    const duration = Date.now() - startTime;
    logger.info("Vault initialized successfully", {
      component: "RoditManager",
      method: "initializeVault",
      requestId,
      instanceId: this._instanceId,
      duration,
      status: "success"
    });

    return vaultInstance;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Vault initialization failed", {
        component: "RoditManager",
        method: "initializeVault",
        requestId,
        duration,
        status: "error",
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
      });

      // Emit metrics for Grafana dashboards
      logger.metric("vault_initialization_duration_ms", duration, {
        success: false,
        component: "RoditManager",
        errorType: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("vault_initialization_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        component: "RoditManager",
      });

      throw error;
    }
  }

  async getCredentials(type) {
    const requestId = ulid();
    const startTime = Date.now();
    const maxRetries = 2; // Maximum number of retry attempts
    let retryCount = 0;
    let lastError = null;

    logger.debug("Retrieving credentials", {
      component: "RoditManager",
      method: "getCredentials",
      requestId,
      credentialType: type,
    });

    // Use cached credentials if available
    if (this.credentials[type]) {
      logger.debug("Using cached credentials", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
      });
      return this.credentials[type];
    }

    // Make sure vault is initialized
    if (!this.vaultInitialized) {
      logger.debug("Vault not initialized, initializing now", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
      });
      await this.initializeVault();
    }

    // Retry logic for vault operations
    while (retryCount <= maxRetries) {
      try {
        // Make the accountType consistent with the type parameter
        const accountType = `account_${type}`;
        const vaultPath = `${this.vaultPath}/${type}`;

        logger.debug("Fetching credentials from vault", {
          component: "RoditManager",
          method: "getCredentials",
          requestId,
          credentialType: type,
          vaultPath,
          attempt: retryCount + 1,
          maxAttempts: maxRetries + 1
        });

        const vaultData = await get_rodit_fromvault(
          vault,
          vaultPath,
          accountType
        );

        // Add detailed logging about the vault data received
        logger.debug("Vault data received", {
          component: "RoditManager",
          method: "getCredentials",
          requestId,
          credentialType: type,
          hasVaultData: !!vaultData,
          dataKeys: vaultData ? Object.keys(vaultData) : [],
          hasPrivateKey: vaultData && !!vaultData.private_key
        });

        // Safely check for private_key before using it
        if (!vaultData || !vaultData.private_key || typeof vaultData.private_key !== "string") {
          const error = new Error(`Invalid or missing private_key for ${type}`);
          logger.warn("Invalid private key format", {
            component: "RoditManager",
            method: "getCredentials",
            requestId,
            credentialType: type,
            privateKeyType: vaultData ? typeof vaultData.private_key : 'undefined',
            attempt: retryCount + 1
          });
          
          // Store error for potential retry
          lastError = error;
          
          // If we've reached max retries, throw the error
          if (retryCount >= maxRetries) {
            throw error;
          }
          
          // Otherwise retry
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          continue;
        }

        const privateKeyStr = vaultData.private_key.startsWith("ed25519:")
          ? vaultData.private_key.replace("ed25519:", "")
          : vaultData.private_key;

        vaultData.signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
        this.credentials[type] = vaultData;

        const duration = Date.now() - startTime;
        logger.info("Credentials retrieved successfully", {
          component: "RoditManager",
          method: "getCredentials",
          requestId,
          credentialType: type,
          duration,
          accountId: vaultData.account_id, // Safe to log account ID
          attempt: retryCount + 1
        });

        // Emit metrics for Grafana dashboards
        logger.metric("credential_retrieval_duration_ms", duration, {
          success: true,
          credentialType: type,
          component: "RoditManager"
        });

        return vaultData;
      } catch (error) {
        lastError = error;
        
        // Log the error but don't throw yet if we have retries left
        const isRetrying = retryCount < maxRetries;
        const logLevel = isRetrying ? "warn" : "error";
        const duration = Date.now() - startTime;
        
        logger[logLevel](`${isRetrying ? "Retryable error" : "Failed"} retrieving credentials`, {
          component: "RoditManager",
          method: "getCredentials",
          requestId,
          credentialType: type,
          duration,
          errorMessage: error.message,
          errorCode: error.code || "UNKNOWN_ERROR",
          stack: error.stack,
          attempt: retryCount + 1,
          willRetry: isRetrying
        });
        
        // Emit metrics for Grafana dashboards
        logger.metric("credential_retrieval_duration_ms", duration, {
          success: false,
          credentialType: type,
          errorType: error.code || "UNKNOWN_ERROR",
          component: "RoditManager",
          retryAttempt: retryCount
        });
        
        if (isRetrying) {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          continue;
        }
        
        // If we've exhausted retries, throw the last error
        logger.metric("credential_retrieval_errors_total", 1, {
          credentialType: type,
          errorType: error.code || "UNKNOWN_ERROR",
          component: "RoditManager"
        });
        
        throw lastError;
      }
    }
  }

  async initializeRoditConfig(type) {
    const requestId = ulid();
    const startTime = Date.now();

    logger.info("Starting RODiT config initialization", {
      component: "RoditManager",
      method: "initializeRoditConfig",
      requestId,
      configType: type,
    });

    try {
      logger.debug("Getting credentials", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "fetchCredentials",
      });

      const credentials = await this.getCredentials(type);

      if (!credentials) {
        logger.error("Failed to retrieve credentials", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "credentialCheck",
        });
        throw new Error(`Credentials not available for ${type}`);
      }

      const { account_id, implicit_account_id } = credentials;
      logger.info("Using account for initialization", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        accountId: account_id,
        step: "accountSetup",
      });

      logger.debug("Checking account state on blockchain", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        accountId: account_id,
        step: "blockchainCheck",
      });

      const accountState = await nearorg_rpc_state(
        account_id
      );

      if (!accountState) {
        logger.warn("Account has no balance in network", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          accountId: account_id,
          step: "blockchainCheck",
        });
      } else {
        logger.info("Account state verified on blockchain", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          accountId: account_id,
          step: "blockchainCheck",
        });
      }

      logger.debug("Fetching RODiT tokens for account", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        accountId: account_id,
        step: "tokenFetch",
      });

      const own_rodit = await nearorg_rpc_tokensfromaccountid(
        account_id
      );

      // Check if we have a real RODiT token
      if (!own_rodit || !own_rodit.token_id) {
        logger.warn(
          "No RODiT instances found, proceeding with partial initialization",
          {
            component: "RoditManager",
            method: "initializeRoditConfig",
            requestId,
            accountId: account_id,
            step: "tokenCheck",
          }
        );

        // Create a minimal configuration for signroot
        const minimalConfig = {
          own_rodit: {
            token_id: "",
            owner_id: account_id,
            metadata: {
              subjectuniqueidentifier_url: "localhost", // Fallback value
              serviceprovider_id: "",
              not_after: "2030-01-01",
              not_before: "2020-01-01",
            },
          },
          own_rodit_bytes_private_key: credentials.signing_bytes_key,
          apiendpoint: "localhost:" + config.get("SERVERPORT"),
          port: config.get("SERVERPORT"),
          iso639: config.get("API_OPTIONS.ISO639"),
          iso3166: config.get("API_OPTIONS.ISO3166"),
          iso15924: config.get("API_OPTIONS.ISO15924"),
          timeoptions: config.get("API_OPTIONS.TIMEOPTIONS"),
        };

        const configCopy = JSON.parse(
          JSON.stringify({
            ...minimalConfig,
            // Exclude sensitive data
            own_rodit_bytes_private_key: "*** REDACTED ***",
          })
        );

        logger.info(
          "Created minimal config object for partial initialization",
          {
            component: "RoditManager",
            method: "initializeRoditConfig",
            requestId,
            configType: type,
            configObject: configCopy,
            step: "minimalConfig",
          }
        );

        logger.debug("Storing minimal configuration in state manager", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "storeConfig",
        });

        await this.stateManager.setConfigOwnRodit(minimalConfig);

        logger.debug("Converting implicit account ID to base64url", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "keyConversion",
        });

        logger.debug("Setting session base64url JWK public key", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          step: "setSessionKey",
        });

        await this.stateManager.setOwnBase64urlJwkPublicKey(
          session_base64url_jwk_public_key
        );

        const duration = Date.now() - startTime;
        logger.info("Partial RODiT configuration completed", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          duration,
          configLevel: "partial",
          step: "complete",
        });

        // Emit metrics for Grafana dashboards
        logger.metric("rodit_initialization_duration_ms", duration, {
          success: true,
          configType: type,
          configLevel: "partial",
          component: "RoditManager",
        });

        return minimalConfig;
      }

      logger.info("Successfully retrieved RODiT token", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        tokenId: own_rodit.token_id,
        step: "tokenRetrieved",
      });

      const SERVERPORT = config.get("SERVERPORT");

      if (
        !own_rodit.metadata ||
        !own_rodit.metadata.subjectuniqueidentifier_url
      ) {
        logger.error("Missing required metadata in RODiT", {
          component: "RoditManager",
          method: "initializeRoditConfig",
          requestId,
          configType: type,
          missingField: "subjectuniqueidentifier_url",
          step: "metadataCheck",
        });

        throw new Error(
          "Missing required metadata: subjectuniqueidentifier_url"
        );
      }

      const apiendpoint =
        own_rodit.metadata.subjectuniqueidentifier_url + ":" + SERVERPORT;

      logger.debug("Constructed API endpoint", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        apiEndpoint: apiendpoint,
        step: "apiEndpointCreation",
      });

      logger.info("Building full configuration object", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "fullConfigCreation",
      });

      const configObject = {
        own_rodit,
        own_rodit_bytes_private_key: credentials.signing_bytes_key,
        apiendpoint,
        port: SERVERPORT,
        iso639: config.get("API_OPTIONS.ISO639"),
        iso3166: config.get("API_OPTIONS.ISO3166"),
        iso15924: config.get("API_OPTIONS.ISO15924"),
        timeoptions: config.get("API_OPTIONS.TIMEOPTIONS"),
      };

      const configCopy = JSON.parse(
        JSON.stringify({
          ...configObject,
          // Exclude sensitive data
          own_rodit_bytes_private_key: "*** REDACTED ***",
        })
      );

      logger.info("Created full config object", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        configObject: configCopy,
        step: "fullConfig",
      });

      logger.debug("Storing configuration in state manager", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "storeConfig",
      });

      await this.stateManager.setConfigOwnRodit(configObject);

      logger.info("Configuration stored successfully", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "configStored",
      });

      logger.debug("Converting implicit account ID to base64url", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "keyConversion",
      });

      const session_base64url_jwk_public_key = Buffer.from(
        implicit_account_id,
        "hex"
      ).toString("base64url");

      logger.debug("Setting session base64url JWK public key", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        step: "setSessionKey",
      });

      // Set the client's own public key from the implicit account ID
      await this.stateManager.setOwnBase64urlJwkPublicKey(
        session_base64url_jwk_public_key
      );
      
      // Note: The server's public key should be set separately when it's received
      // during the handshake or authentication process

      const duration = Date.now() - startTime;
      logger.info("RODiT configuration completed", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        duration,
        configLevel: "full",
        step: "complete",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_initialization_duration_ms", duration, {
        success: true,
        configType: type,
        configLevel: "full",
        component: "RoditManager",
      });

      return configObject;
    } catch (error) {
      const duration = Date.now() - startTime;

      logger.error("Error initializing RODiT config", {
        component: "RoditManager",
        method: "initializeRoditConfig",
        requestId,
        configType: type,
        duration,
        errorMessage: error.message,
        errorCode: error.code || "UNKNOWN_ERROR",
        stack: error.stack,
        step: error.step || "unknown",
      });

      // Emit metrics for Grafana dashboards
      logger.metric("rodit_initialization_duration_ms", duration, {
        success: false,
        configType: type,
        component: "RoditManager",
        errorType: error.code || "UNKNOWN_ERROR",
      });
      logger.metric("rodit_initialization_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        configType: type,
        component: "RoditManager",
        step: error.step || "unknown",
      });

      throw error;
    }
  }
}

// Create and export a singleton instance
const roditManager = new RoditManager();

// Export the singleton instance directly to avoid any issues with destructuring
module.exports = roditManager;
