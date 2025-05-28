// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

/**
 * RODiT Manager Service
 * Responsible for managing RODiT configurations, credentials, and file-based storage
 */

const bs58 = require("bs58");
const { ulid } = require("ulid");
const config = require("config");
const logger = require("../../config/logger");
const fs = require('fs').promises;
const {
  nearorg_rpc_state,
  nearorg_rpc_tokensfromaccountid
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
    this.credentials = {
      portal: null,
      sanctum: null,
      server: null,
      client: null,
    };

    RoditManager.instance = this;
  }

/**
 * Initialize credentials - simplified for file-based approach
 * @returns {Promise<null>} No return value needed
 */
async initializeCredentialsStore() {
  const requestId = ulid();
  const startTime = Date.now();

  logger.info("Using file-based credentials, vault initialization skipped", {
    component: "RoditManager",
    method: "initializeCredentialsStore",
    requestId,
    instanceId: this._instanceId
  });
  
  // No need to initialize vault for file-based credentials
  const duration = Date.now() - startTime;
  logger.info("File credential initialization complete", {
    component: "RoditManager",
    method: "initializeCredentialsStore",
    requestId,
    instanceId: this._instanceId,
    duration,
    status: "success"
  });
  
  return null;
}

  /**
   * Get credentials for the specified type
   * @param {string} type - Credential type (client, server, etc.)
   * @returns {Promise<Object>} Credentials object
   */
  async getCredentials(type) {
    const requestId = ulid();
    const startTime = Date.now();
    
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
    
    try {
      // Get file path from configuration
      const credentials = config.get("credentials");
      const filePath = credentials.filePath;
      
      logger.debug("Loading credentials from file", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        filePath
      });
      
      // Read and parse the file
      const fileContent = await fs.readFile(filePath, 'utf8');
      const fileCredentials = JSON.parse(fileContent);
      
      // Fetch token metadata from blockchain using account ID
      const accountId = fileCredentials.account_id;
      
      logger.debug("Fetching RODiT token metadata from blockchain", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        accountId
      });
      
      const roditToken = await nearorg_rpc_tokensfromaccountid(accountId);
      
      // Validate token metadata
      if (!roditToken || !roditToken.metadata || !roditToken.metadata.subjectuniqueidentifier_url) {
        const error = new Error("Failed to load complete token metadata from blockchain");
        logger.error("Missing required token metadata", {
          component: "RoditManager",
          method: "getCredentials",
          requestId,
          hasToken: !!roditToken,
          hasMetadata: roditToken ? !!roditToken.metadata : false,
          hasEndpoint: roditToken && roditToken.metadata ? !!roditToken.metadata.subjectuniqueidentifier_url : false
        });
        throw error;
      }
      
      // Prepare credentials in the expected format
      const credentialData = {
        private_key: fileCredentials.private_key,
        public_key: fileCredentials.public_key,
        account_id: accountId,
        token_id: roditToken.token_id,
        config_own_rodit: {
          token_id: roditToken.token_id,
          metadata: roditToken.metadata
        }
      };

      // Process private key format
      const privateKeyStr = credentialData.private_key.startsWith("ed25519:")
        ? credentialData.private_key.replace("ed25519:", "")
        : credentialData.private_key;

      // Create signing key bytes
      credentialData.signing_bytes_key = new Uint8Array(bs58.decode(privateKeyStr));
      
      // Cache the credentials
      this.credentials[type] = credentialData;

      const duration = Date.now() - startTime;
      logger.info("Credentials retrieved successfully from file", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        duration
      });

      // Emit metrics for Grafana dashboards
      logger.metric("credentials_retrieval_duration_ms", duration, {
        success: true,
        component: "RoditManager",
        credentialType: type,
        source: "file"
      });

      return credentialData;
    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error("Failed to retrieve credentials from file", {
        component: "RoditManager",
        method: "getCredentials",
        requestId,
        credentialType: type,
        duration,
        error: error.message,
        stack: error.stack
      });

      // Emit metrics for Grafana dashboards
      logger.metric("credentials_retrieval_duration_ms", duration, {
        success: false,
        component: "RoditManager",
        credentialType: type,
        source: "file"
      });
      logger.metric("credentials_retrieval_errors_total", 1, {
        errorType: error.code || "UNKNOWN_ERROR",
        component: "RoditManager",
        credentialType: type
      });

      throw error;
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
