const config = require("config");
const vault = require("node-vault")();

async function getProductionVaultToken() {
  try {
    const VAULT_ROLE_ID = config.get("VAULT_ROLE_ID");
    const VAULT_SECRET_ID = config.get("VAULT_SECRET_ID");
    const VAULT_ENDPOINT = config.get("VAULT_ENDPOINT");
    
    vault.endpoint = VAULT_ENDPOINT;
    vault.apiVersion = 'v1';
    
    const result = await vault.approleLogin({
      role_id: VAULT_ROLE_ID,
      secret_id: VAULT_SECRET_ID
    });
    return result.auth.client_token;
  } catch (error) {
    console.error("Error authenticating with Vault:", error);
    throw new Error("Error 108: Vault authentication failed");
  }
}

async function initializeProductionVault() {
  try {
    const token = await getProductionVaultToken();
    vault.token = token;

    const health = await vault.health();
    if (!health.initialized) {
      throw new Error("Error 109: Vault is not initialized");
    }
    if (health.sealed) {
      throw new Error("Error 110: Vault is sealed");
    }

    return vault;
  } catch (error) {
    console.error("Error initializing production Vault:", error);
    throw error;
  }
}

async function setupTokenRenewal(vault) {
  try {
    // Use a more reasonable renewal interval - 1 hour
    const RENEWAL_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds

    setInterval(async () => {
      try {
        const token = await getProductionVaultToken();
        vault.token = token;
      } catch (error) {
        console.error("Error renewing Vault token:", error);
      }
    }, RENEWAL_INTERVAL);
    
  } catch (error) {
    console.error("Error setting up token renewal:", error);
  }
}

async function get_rodit_fromvault(vault, VAULT_RODIT_KEYVALUE_PATH, secretKey) {
  if (!vault || typeof vault.read !== 'function') {
    throw new Error("Error 051: Invalid vault object");
  }
  if (!VAULT_RODIT_KEYVALUE_PATH || typeof VAULT_RODIT_KEYVALUE_PATH !== "string") {
    throw new Error("Error 052: Invalid VAULT_RODIT_KEYVALUE_PATH");
  }
  if (!secretKey || typeof secretKey !== "string") {
    throw new Error("Error 047: Invalid or missing secretKey parameter");
  }

  try {
    // Add debug logging
    const result = await vault.read(`secret/data/${VAULT_RODIT_KEYVALUE_PATH}`);
    
    const secretData = result.data.data[secretKey];
    if (!secretData) {
      throw new Error(
        `Error 048: No data found for ${secretKey} at secret/data/${VAULT_RODIT_KEYVALUE_PATH}`
      );
    }

    let parsedData;
    if (typeof secretData === 'string') {
      try {
        parsedData = JSON.parse(secretData);
      } catch (parseError) {
        throw new Error(`Error 046: Invalid JSON format in ${secretKey}`);
      }
    } else {
      parsedData = secretData;
    }

    const { implicit_account_id, private_key } = parsedData;

    if (!implicit_account_id || typeof implicit_account_id !== "string") {
      throw new Error("Error 244: Invalid or missing account_id value");
    }
    if (!private_key || typeof private_key !== "string") {
      throw new Error("Error 043: Invalid or missing private_key value");
    }

    return { implicit_account_id, private_key };
  } catch (error) {
    console.error("Error retrieving Rodit config from Vault:", error);
    throw error;
  }
}

module.exports = {
  initializeProductionVault,
  get_rodit_fromvault,
  setupTokenRenewal,
  vault
};