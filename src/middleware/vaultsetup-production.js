const config = require("config");
const bs58 = require("bs58");
const logger = require("../../config/logger");

class ProductionVaultManager {
  constructor() {
    this.vault = require("node-vault")();
    this.vault.endpoint = config.get("VAULT_ENDPOINT");
    this.vault.apiVersion = "v1";
    this.roleId = config.get("VAULT_ROLE_PORTALID");
    this.secretId = config.get("VAULT_SECRET_PORTALID");
    this.renewalInterval = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  async getProductionVaultToken() {
    try {
      const result = await this.vault.approleLogin({
        role_id: this.roleId,
        secret_id: this.secretId,
      });
      return result.auth.client_token;
    } catch (error) {
      logger.error("Error authenticating with Vault:", error);
      throw new Error("Error 108: Vault authentication failed");
    }
  }

  async initialize() {
    try {
      const token = await this.getProductionVaultToken();
      this.vault.token = token;

      const health = await this.vault.health();
      if (!health.initialized) {
        throw new Error("Error 109: Vault is not initialized");
      }
      if (health.sealed) {
        throw new Error("Error 110: Vault is sealed");
      }

      return this.vault;
    } catch (error) {
      logger.error("Error initializing production Vault:", error);
      throw error;
    }
  }

  async setupTokenRenewal() {
    try {
      setInterval(async () => {
        try {
          const token = await this.getProductionVaultToken();
          this.vault.token = token;
        } catch (error) {
          logger.error("Error renewing Vault token:", error);
        }
      }, this.renewalInterval);
    } catch (error) {
      logger.error("Error setting up token renewal:", error);
    }
  }

  async getRoditFromVault(vaultPath, secretKey) {
    this.validateVaultParameters(vaultPath, secretKey);

    try {
      const result = await this.vault.read(`secret/data/${vaultPath}`);
      const secretData = result.data.data[secretKey];

      if (!secretData) {
        throw new Error(
          `Error 048: No data found for ${secretKey} at secret/data/${vaultPath}`
        );
      }

      const parsedData = this.parseSecretData(secretData, secretKey);
      return this.validateAndExtractCredentials(parsedData);
    } catch (error) {
      logger.error("Error retrieving Rodit config from Vault:", error);
      throw error;
    }
  }

  validateVaultParameters(vaultPath, secretKey) {
    if (!this.vault || typeof this.vault.read !== "function") {
      throw new Error("Error 051: Invalid vault object");
    }
    if (!vaultPath || typeof vaultPath !== "string") {
      throw new Error("Error 052: Invalid VAULT_RODIT_KEYVALUE_PATH");
    }
    if (!secretKey || typeof secretKey !== "string") {
      throw new Error("Error 047: Invalid or missing secretKey parameter");
    }
  }

  parseSecretData(secretData, secretKey) {
    if (typeof secretData === "string") {
      try {
        return JSON.parse(secretData);
      } catch (parseError) {
        throw new Error(`Error 046: Invalid JSON format in ${secretKey}`);
      }
    }
    return secretData;
  }

  validateAndExtractCredentials(parsedData) {
    logger.error("parsedData", parsedData);
    
    const stripEd25519Prefix = (key) => key.replace("ed25519:", "");
    
    const publicKeyToImplicitId = (publicKey) => {
      const publicKeyBase58 = stripEd25519Prefix(publicKey);
      const publicKeyBytes = bs58.decode(publicKeyBase58);
      return Buffer.from(publicKeyBytes.buffer).toString('hex');
    };
  
    if (parsedData.implicit_account_id) {
      const { implicit_account_id, private_key, public_key } = parsedData;
      
      if (!implicit_account_id || typeof implicit_account_id !== "string") {
        throw new Error("Error 244: Invalid or missing implicit_account_id value");
      }
      
      if (!private_key || typeof private_key !== "string") {
        throw new Error("Error 043: Invalid or missing private_key value");
      }
  
      if (public_key) {
        const calculatedImplicitId = publicKeyToImplicitId(public_key);
        if (implicit_account_id !== calculatedImplicitId) {
          throw new Error("Error 246: implicit_account_id does not match public_key");
        }
      }
  
      return {
        account_id: implicit_account_id, // Use implicit_account_id as account_id
        implicit_account_id,
        private_key: stripEd25519Prefix(private_key)
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
  
    return {
      account_id,
      implicit_account_id: publicKeyToImplicitId(public_key),
      private_key: stripEd25519Prefix(private_key)
    };
  }
}

const vaultManager = new ProductionVaultManager();

module.exports = {
  initializeProductionVault: () => vaultManager.initialize(),
  get_rodit_fromvault: (vault, path, secretKey) =>
    vaultManager.getRoditFromVault(path, secretKey),
  setupTokenRenewal: () => vaultManager.setupTokenRenewal(),
  vault: vaultManager.vault,
};
