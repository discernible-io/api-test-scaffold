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
      throw new Error("Error 144: Invalid or missing account_id value");
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

async function get_rodit_fromvault(vault, VAULT_RODIT_KEYVALUE_PATH, secretKey) {
  // Validate input parameters
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
    // Read the secret from the vault
    const result = await vault.read(`secret/data/${VAULT_RODIT_KEYVALUE_PATH}`);

    // Check if the specified secret exists
    if (!result?.data?.data?.[secretKey]) {
      throw new Error(
        `Error 048: No data found for ${secretKey} at secret/data/${VAULT_RODIT_KEYVALUE_PATH}`
      );
    }

    // Parse the JSON string
    let parsedData;
    try {
      parsedData = JSON.parse(result.data.data[secretKey]);
    } catch (parseError) {
      throw new Error(`Error 046: Invalid JSON format in ${secretKey}`);
    }

    // Extract and validate the implicit_account_id and private_key
    let { implicit_account_id, private_key } = parsedData;

    if (!implicit_account_id || typeof implicit_account_id !== "string") {
      throw new Error("Error 244: Invalid or missing account_id value");
    }

    if (!private_key || typeof private_key !== "string") {
      throw new Error("Error 043: Invalid or missing private_key value");
    }

    // Process private key if needed
    // const processedPrivateKey = private_key.startsWith("ed25519:") 
    //  ? private_key.slice(8) 
    //  : private_key;

return { implicit_account_id: implicit_account_id, private_key: private_key };
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
