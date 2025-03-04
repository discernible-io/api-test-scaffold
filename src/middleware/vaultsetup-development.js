const config = require("config");
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
  }

  async initializeDevelopmentVault() {
    try {
      await this.setupVaultToken();
      await this.ensureVaultUnsealed();
      logger.error("Info: Vault is initialized and unsealed");
    } catch (error) {
      logger.error("Error 006: initializing or unsealing Vault:", error);
      throw error;
    }
  }

  async setupVaultToken() {
    if (this.token) {
      logger.error("Info: Using existing DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN");
      this.vault.token = this.token;
      return;
    }

    const initStatus = await this.vault.initialized();
    if (!initStatus.initialized) {
      logger.error("Info: Initializing Vault...");
      const result = await this.vault.init({
        secret_shares: 1,
        secret_threshold: 1,
      });
      process.env.VAULT_ROOT_TOKEN = result.root_token;
      process.env.VAULT_UNSEAL_KEY = result.keys[0];
    }
    this.vault.token = process.env.VAULT_ROOT_TOKEN;
  }

  async ensureVaultUnsealed() {
    const sealStatus = await this.vault.status();
    if (sealStatus.sealed) {
      logger.error("Info: Unsealing Vault...");
      if (!process.env.VAULT_UNSEAL_KEY) {
        throw new Error("Vault is sealed and no unseal key is available");
      }
      await this.vault.unseal({
        secret_shares: 1,
        key: process.env.VAULT_UNSEAL_KEY,
      });
    }
  }

  async validateBlockchainNetwork(smartContractUrl, blockchainNetwork) {
    const urlExtension = smartContractUrl.split(".").pop();
    const isTestnet = blockchainNetwork === ".testnet" && urlExtension !== "testnet";
    const isMainnet = blockchainNetwork === "." && urlExtension !== "near";
    
    if (isTestnet || isMainnet) {
      throw new Error(
        `Error 045: Mismatch: URL extension "${urlExtension}" does not match the blockchain network "${blockchainNetwork}".`
      );
    }
  }

  async getRoditFromFile(configuration_file_path) {
    try {
      await this.validateBlockchainNetwork(
        CONSTANTS.SMART_CONTRACT,
        CONSTANTS.BLOCKCHAIN_NETWORK
      );

      const configoptions = await fs.readFile(configuration_file_path, "utf8");
      const pathaccountidfile = configoptions.trim();
      const accountidfile = await fs.readFile(pathaccountidfile, "utf8");
      const options = JSON.parse(accountidfile);

      return this.validateAndExtractCredentials(options);
    } catch (error) {
      logger.error("Error preparing Rodit config:", error);
      throw error;
    }
  }

  validateAndExtractCredentials(options) {
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

    logger.error("Info: Own Implicit Account ID:", implicit_account_id);
    // implicit_account_id public key and ID
    return { account_id, implicit_account_id, private_key };
  }

  async getRoditFromVault(vaultPath, secretKey) {
    this.validateVaultParameters(vaultPath, secretKey);

    try {
      const result = await this.vault.read(`secret/data/${vaultPath}`);
      this.validateVaultResult(result, secretKey, vaultPath);

      const parsedData = this.parseVaultData(result.data.data[secretKey], secretKey);
      return this.validateAndExtractCredentials(parsedData);
    } catch (error) {
      logger.error("Error preparing Rodit config:", error);
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
  }

  validateVaultResult(result, secretKey, vaultPath) {
    if (!result?.data?.data?.[secretKey]) {
      throw new Error(
        `Error 048: No data found for ${secretKey} at secret/data/${vaultPath}`
      );
    }
  }

  parseVaultData(data, secretKey) {
    try {
      return JSON.parse(data);
    } catch (parseError) {
      throw new Error(`Error 046: Invalid JSON format in ${secretKey}`);
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