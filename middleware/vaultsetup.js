const config = require("config");
const VAULT_ENDPOINT = config.get("VAULT_ENDPOINT");
const DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN = config.get(
  "DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN"
);
const vault = require("node-vault")({
  apiVersion: "v1",
  endpoint: VAULT_ENDPOINT,
  token: DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN,
});

async function initializeAndUnsealVault() {
  try {
    // Use existing DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN if available
    if (DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN) {
      console.debug(
        "Using existing DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN"
      );
      vault.token = DO_NOT_LOG_NEVER_COMMIT_VALUEOF_VAULT_TOKEN;
    } else {
      // Check if Vault is initialized
      const initStatus = await vault.initialized();
      if (!initStatus.initialized) {
        console.debug("Initializing Vault...");
        const result = await vault.init({
          secret_shares: 1,
          secret_threshold: 1,
        });
        // Save root token and unseal keys securely (use a secure method in production)
        process.env.VAULT_ROOT_TOKEN = result.root_token;
        process.env.VAULT_UNSEAL_KEY = result.keys[0];
      }
      vault.token = process.env.VAULT_ROOT_TOKEN;
    }

    // Check if Vault is sealed
    const sealStatus = await vault.status();
    if (sealStatus.sealed) {
      console.debug("Unsealing Vault...");
      if (!process.env.VAULT_UNSEAL_KEY) {
        throw new Error("Vault is sealed and no unseal key is available");
      }
      await vault.unseal({
        secret_shares: 1,
        key: process.env.VAULT_UNSEAL_KEY,
      });
    }

    console.debug("Vault is initialized and unsealed");
  } catch (error) {
    console.error("Error initializing or unsealing Vault:", error);
    throw error;
  }
}

async function get_rodit_fromfile(configuration_file_path) {
  try {
    const smartContractUrl = CONSTANTS.SMART_CONTRACT;
    // Extract the extension from the SMART_CONTRACT URL
    const urlExtension = smartContractUrl.split(".").pop();
    // Check if there's a mismatch
    if (
      (CONSTANTS.BLOCKCHAIN_NETWORK === ".testnet" &&
        urlExtension !== "testnet") ||
      (CONSTANTS.BLOCKCHAIN_NETWORK === "." && urlExtension !== "near")
    ) {
      throw new Error(
        `Error 045: Mismatch: URL extension "${urlExtension}" does not match the blockchain network "${blockchainNetwork}".`
      );
    }

    // Read the configuration file to get the path of the JSON file
    const configoptions = await fs.readFile(configuration_file_path, "utf8");
    const pathaccountidfile = configoptions.trim(); // Assuming the file contains just the path

    // Now read the JSON file using the path we got from the configuration file
    const accountidfile = await fs.readFile(pathaccountidfile, "utf8");
    const options = JSON.parse(accountidfile);

    const own_rodit_hex_accountid = options.implicit_account_id;
    if (typeof own_rodit_hex_accountid !== "string") {
      throw new Error("Error 044: Invalid or missing account_id value");
    }

    console.debug("Info: Own Account ID:", own_rodit_hex_accountid);

    let own_string_private_key = options.private_key;
    if (typeof own_string_private_key !== "string") {
      throw new Error("Error 043: Invalid private_key value");
    }
    // Return the prepared data
    return { own_rodit_hex_accountid, own_string_private_key };
  } catch (error) {
    console.error("Error preparing Rodit config:", error);
    throw error;
  }
}

async function get_rodit_fromvault(vault, VAULT_RODIT_KEYVALUE_PATH) {
  try {
    // Read the secret from the vault
    const result = await vault.read(`secret/data/${VAULT_RODIT_KEYVALUE_PATH}`);

    if (!result.data.data.account_client) {
      throw new Error(
        `No data found at secret/data/${VAULT_RODIT_KEYVALUE_PATH}`
      );
    }

    // Parse the JSON string
    const parsedData = JSON.parse(result.data.data.account_client);

    // Extract the implicit_account_id and private_key
    const own_rodit_hex_accountid = parsedData.implicit_account_id;
    const own_string_private_key = parsedData.private_key;

    // Validate the account ID and private key
    if (
      !own_rodit_hex_accountid ||
      typeof own_rodit_hex_accountid !== "string"
    ) {
      throw new Error("Error 044: Invalid or missing account_id value");
    }
    if (!own_string_private_key || typeof own_string_private_key !== "string") {
      throw new Error("Error 043: Invalid or missing private_key value");
    }

    // Return the prepared data
    return { own_rodit_hex_accountid, own_string_private_key };
  } catch (error) {
    console.error("Error preparing Rodit config:", error);
    throw error;
  }
}

module.exports = {
  initializeAndUnsealVault,
  get_rodit_fromvault,
  get_rodit_fromfile,
  vault,
};
