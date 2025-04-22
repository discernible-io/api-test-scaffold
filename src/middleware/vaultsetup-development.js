const config = require("config");
const fs = require("fs").promises; // Adding missing import
const { CONSTANTS } = require("../middleware/rodit");
const logger = require("../../config/logger");

class VaultManager {
  constructor() {
    this.endpoint = config.get("VAULT_ENDPOINT");
    this.token = config.get("DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN");
    this.vault = require("node-vault")({
      apiVersion: "v1",
      endpoint: this.endpoint,
      token: this.token,
    });
    
    // Add request ID for tracing in Grafana
    this.requestId = require('crypto').randomUUID();
  }

  async initializeDevelopmentVault() {
    const startTime = Date.now();
    try {
      logger.info("Initializing development vault", { 
        component: "VaultManager",
        method: "initializeDevelopmentVault", 
        requestId: this.requestId 
      });
      
      await this.setupVaultToken();
      await this.ensureVaultUnsealed();
      
      const duration = Date.now() - startTime;
      logger.info("Vault is initialized and unsealed", { 
        component: "VaultManager", 
        method: "initializeDevelopmentVault", 
        duration,
        requestId: this.requestId 
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Error initializing or unsealing Vault", { 
        component: "VaultManager", 
        method: "initializeDevelopmentVault", 
        error: error.message, 
        errorCode: "006",
        stack: error.stack,
        duration,
        requestId: this.requestId 
      });
      throw error;
    }
  }

  async setupVaultToken() {
    const startTime = Date.now();
    try {
      if (this.token) {
        logger.info("Using existing vault token", { 
          component: "VaultManager", 
          method: "setupVaultToken",
          requestId: this.requestId 
        });
        this.vault.token = this.token;
        return;
      }

      const initStatus = await this.vault.initialized();
      if (!initStatus.initialized) {
        logger.info("Initializing Vault...", { 
          component: "VaultManager", 
          method: "setupVaultToken",
          requestId: this.requestId 
        });
        
        const result = await this.vault.init({
          secret_shares: 1,
          secret_threshold: 1,
        });
        process.env.VAULT_ROOT_TOKEN = result.root_token;
        process.env.VAULT_UNSEAL_KEY = result.keys[0];
      }
      this.vault.token = process.env.VAULT_ROOT_TOKEN;
      
      const duration = Date.now() - startTime;
      logger.debug("Vault token setup completed", { 
        component: "VaultManager", 
        method: "setupVaultToken", 
        duration,
        initialized: initStatus.initialized,
        requestId: this.requestId 
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Failed to setup vault token", { 
        component: "VaultManager", 
        method: "setupVaultToken", 
        error: error.message,
        stack: error.stack,
        duration,
        requestId: this.requestId 
      });
      throw error;
    }
  }

  async ensureVaultUnsealed() {
    const startTime = Date.now();
    try {
      const sealStatus = await this.vault.status();
      if (sealStatus.sealed) {
        logger.info("Unsealing Vault...", { 
          component: "VaultManager", 
          method: "ensureVaultUnsealed",
          requestId: this.requestId 
        });
        
        if (!process.env.VAULT_UNSEAL_KEY) {
          throw new Error("Vault is sealed and no unseal key is available");
        }
        await this.vault.unseal({
          secret_shares: 1,
          key: process.env.VAULT_UNSEAL_KEY,
        });
      }
      
      const duration = Date.now() - startTime;
      logger.debug("Vault unseal check completed", { 
        component: "VaultManager", 
        method: "ensureVaultUnsealed", 
        wasSealed: sealStatus.sealed,
        duration,
        requestId: this.requestId 
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Failed to unseal vault", { 
        component: "VaultManager", 
        method: "ensureVaultUnsealed", 
        error: error.message,
        stack: error.stack,
        duration,
        requestId: this.requestId 
      });
      throw error;
    }
  }

  async validateBlockchainNetwork(smartContractUrl, blockchainNetwork) {
    const startTime = Date.now();
    try {
      const urlExtension = smartContractUrl.split(".").pop();
      const isTestnet = blockchainNetwork === ".testnet" && urlExtension !== "testnet";
      const isMainnet = blockchainNetwork === "." && urlExtension !== "near";
      
      if (isTestnet || isMainnet) {
        const errorMsg = `Mismatch: URL extension "${urlExtension}" does not match the blockchain network "${blockchainNetwork}".`;
        logger.error("Blockchain network validation failed", {
          component: "VaultManager",
          method: "validateBlockchainNetwork",
          urlExtension,
          blockchainNetwork,
          error: errorMsg,
          errorCode: "045",
          requestId: this.requestId
        });
        throw new Error(`Error 045: ${errorMsg}`);
      }
      
      const duration = Date.now() - startTime;
      logger.debug("Blockchain network validation successful", {
        component: "VaultManager",
        method: "validateBlockchainNetwork",
        urlExtension,
        blockchainNetwork,
        duration,
        requestId: this.requestId
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      if (!error.message.includes("Error 045")) {
        logger.error("Blockchain network validation error", {
          component: "VaultManager",
          method: "validateBlockchainNetwork",
          error: error.message,
          stack: error.stack,
          duration,
          requestId: this.requestId
        });
      }
      throw error;
    }
  }

  async getRoditFromFile(configuration_file_path) {
    const startTime = Date.now();
    try {
      logger.info("Getting Rodit config from file", {
        component: "VaultManager",
        method: "getRoditFromFile",
        configPath: configuration_file_path,
        requestId: this.requestId
      });
      
      await this.validateBlockchainNetwork(
        CONSTANTS.SMART_CONTRACT,
        CONSTANTS.BLOCKCHAIN_NETWORK
      );

      const configoptions = await fs.readFile(configuration_file_path, "utf8");
      const pathaccountidfile = configoptions.trim();
      const accountidfile = await fs.readFile(pathaccountidfile, "utf8");
      const options = JSON.parse(accountidfile);

      const result = this.validateAndExtractCredentials(options);
      
      const duration = Date.now() - startTime;
      logger.debug("Rodit config successfully retrieved from file", {
        component: "VaultManager",
        method: "getRoditFromFile",
        accountId: result.account_id,
        duration,
        requestId: this.requestId
      });
      
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Error preparing Rodit config from file", {
        component: "VaultManager",
        method: "getRoditFromFile",
        error: error.message,
        stack: error.stack,
        configPath: configuration_file_path,
        duration,
        requestId: this.requestId
      });
      throw error;
    }
  }

  validateAndExtractCredentials(options) {
    const startTime = Date.now();
    try {
      const { account_id, implicit_account_id, private_key } = options;

      if (!account_id || typeof account_id !== "string") {
        throw new Error("Error 144: Invalid or missing account_id value");
      }

      if (!implicit_account_id || typeof implicit_account_id !== "string") {
        throw new Error("Error 144: Invalid or missing implicit_account_id value");
      }

      if (!private_key || typeof private_key !== "string") {
        throw new Error("Error 043: Invalid private_key value");
      }

      logger.info("Credentials validation successful", {
        component: "VaultManager",
        method: "validateAndExtractCredentials",
        accountId: account_id,
        implicitAccountId: implicit_account_id,
        hasPrivateKey: !!private_key,
        requestId: this.requestId
      });
      
      const duration = Date.now() - startTime;
      logger.debug("Credentials extracted successfully", {
        component: "VaultManager",
        method: "validateAndExtractCredentials",
        duration,
        requestId: this.requestId
      });
      
      return { account_id, implicit_account_id, private_key };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Credentials validation failed", {
        component: "VaultManager",
        method: "validateAndExtractCredentials",
        error: error.message,
        errorCode: error.message.match(/Error (\d+)/)?.[1],
        stack: error.stack,
        duration,
        requestId: this.requestId
      });
      throw error;
    }
  }

  async getRoditFromVault(vaultPath, secretKey) {
    const startTime = Date.now();
    try {
      logger.info("Getting Rodit config from vault", {
        component: "VaultManager",
        method: "getRoditFromVault",
        vaultPath,
        secretKey,
        requestId: this.requestId
      });
      
      this.validateVaultParameters(vaultPath, secretKey);

      const result = await this.vault.read(`secret/data/${vaultPath}`);
      this.validateVaultResult(result, secretKey, vaultPath);

      const parsedData = this.parseVaultData(result.data.data[secretKey], secretKey);
      const credentials = this.validateAndExtractCredentials(parsedData);
      
      const duration = Date.now() - startTime;
      logger.debug("Rodit config successfully retrieved from vault", {
        component: "VaultManager",
        method: "getRoditFromVault",
        vaultPath,
        accountId: credentials.account_id,
        duration,
        requestId: this.requestId
      });
      
      return credentials;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Error preparing Rodit config from vault", {
        component: "VaultManager",
        method: "getRoditFromVault",
        error: error.message,
        errorCode: error.message.match(/Error (\d+)/)?.[1],
        stack: error.stack,
        vaultPath,
        secretKey,
        duration,
        requestId: this.requestId
      });
      throw error;
    }
  }

  validateVaultParameters(vaultPath, secretKey) {
    if (!this.vault || typeof this.vault.read !== 'function') {
      throw new Error("Error 051: Invalid vault object");
    }
    if (!vaultPath || typeof vaultPath !== "string") {
      throw new Error("Error 052: Invalid VAULT_RODIT_KEYVALUE_PATH");
    }
    if (!secretKey || typeof secretKey !== "string") {
      throw new Error("Error 047: Invalid or missing secretKey parameter");
    }
    
    logger.debug("Vault parameters validated", {
      component: "VaultManager",
      method: "validateVaultParameters",
      vaultPath,
      hasSecretKey: !!secretKey,
      requestId: this.requestId
    });
  }

  validateVaultResult(result, secretKey, vaultPath) {
    if (!result?.data?.data?.[secretKey]) {
      const errorMsg = `Error 048: No data found for ${secretKey} at secret/data/${vaultPath}`;
      logger.error("Vault result validation failed", {
        component: "VaultManager",
        method: "validateVaultResult",
        secretKey,
        vaultPath,
        error: errorMsg,
        errorCode: "048",
        requestId: this.requestId
      });
      throw new Error(errorMsg);
    }
    
    logger.debug("Vault result validated", {
      component: "VaultManager",
      method: "validateVaultResult",
      secretKey,
      vaultPath,
      requestId: this.requestId
    });
  }

  parseVaultData(data, secretKey) {
    try {
      const parsed = JSON.parse(data);
      logger.debug("Vault data parsed successfully", {
        component: "VaultManager",
        method: "parseVaultData",
        secretKey,
        requestId: this.requestId
      });
      return parsed;
    } catch (parseError) {
      const errorMsg = `Error 046: Invalid JSON format in ${secretKey}`;
      logger.error("Failed to parse vault data", {
        component: "VaultManager",
        method: "parseVaultData",
        error: errorMsg,
        originalError: parseError.message,
        stack: parseError.stack,
        secretKey,
        requestId: this.requestId
      });
      throw new Error(errorMsg);
    }
  }
}

// Create singleton instance
const vaultManager = new VaultManager();

module.exports = {
  initializeDevelopmentVault: () => vaultManager.initializeDevelopmentVault(),
  get_rodit_fromvault: (vault, path, secretKey) => vaultManager.getRoditFromVault(path, secretKey),
  get_rodit_fromfile: (path) => vaultManager.getRoditFromFile(path),
  vault: vaultManager.vault,
};