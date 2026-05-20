/**
 * @deprecated File-based credential paths — use near-test-credentials.js (env / testing.env).
 * Kept for module names referenced in docs; resolves paths only for optional legacy file fallback.
 */

const path = require("path");
const {
  primaryCredentialsAvailable,
  peerCredentialsAvailable,
  loadPrimaryNearCredentials,
  loadPeerNearCredentials,
} = require("./near-test-credentials");

const PRIMARY_CREDENTIALS_FILENAME =
  "886496db00b9342b960809e59359a98a1e506b96c89b1586867f59bc9b2b4ba5.json";

const MAINNET_CREDENTIALS_DIR = path.join(
  __dirname,
  "../../.near-credentials/mainnet"
);

function getPrimaryCredentialsPath() {
  return path.join(MAINNET_CREDENTIALS_DIR, PRIMARY_CREDENTIALS_FILENAME);
}

/** @deprecated Use peerCredentialsAvailable() and NEAR_TEST_PEER_CREDENTIALS_JSON_B64 */
function getSubagentCredentialsPath() {
  return process.env.NEAR_TEST_SUBAGENT_CREDENTIALS_FILE_PATH || null;
}

function credentialsFileExists(filePath) {
  return false;
}

function credentialsAvailableViaEnv() {
  return primaryCredentialsAvailable();
}

function peerCredentialsAvailableViaTestingEnv() {
  return peerCredentialsAvailable();
}

module.exports = {
  PRIMARY_CREDENTIALS_FILENAME,
  MAINNET_CREDENTIALS_DIR,
  getPrimaryCredentialsPath,
  getSubagentCredentialsPath,
  credentialsFileExists,
  credentialsAvailableViaEnv,
  peerCredentialsAvailableViaTestingEnv,
  loadPrimaryNearCredentials,
  loadPeerNearCredentials,
};
