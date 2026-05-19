/**
 * Paths for local NEAR credential files used by integration tests.
 * Runtime signing credentials come from NEAR_CREDENTIALS_JSON_B64 (see configuration-standard.md).
 */

const fs = require("fs");
const path = require("path");
const config = require("../../sdk/services/configsdk");

const PRIMARY_CREDENTIALS_FILENAME =
  "886496db00b9342b960809e59359a98a1e506b96c89b1586867f59bc9b2b4ba5.json";

const MAINNET_CREDENTIALS_DIR = path.join(
  __dirname,
  "../../.near-credentials/mainnet"
);

function getPrimaryCredentialsPath() {
  return path.join(MAINNET_CREDENTIALS_DIR, PRIMARY_CREDENTIALS_FILENAME);
}

function getSubagentCredentialsPath() {
  if (config.has("NEAR_TEST_SUBAGENT_CREDENTIALS_FILE_PATH")) {
    return config.get("NEAR_TEST_SUBAGENT_CREDENTIALS_FILE_PATH");
  }
  return null;
}

function credentialsFileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (_) {
    return false;
  }
}

module.exports = {
  PRIMARY_CREDENTIALS_FILENAME,
  MAINNET_CREDENTIALS_DIR,
  getPrimaryCredentialsPath,
  getSubagentCredentialsPath,
  credentialsFileExists,
};
