/**
 * Load test-only secrets from secrets/testing.env (sibling of secrets.env).
 * Not wired through SDK config — used for a second NEAR key pair (peer / subagent HOLA).
 */

const fs = require("fs");
const path = require("path");

function resolveSecretsDirectory() {
  if (process.env.CLIENTTEST_SECRETS_DIR) {
    return process.env.CLIENTTEST_SECRETS_DIR;
  }

  const candidates = [
    path.join(process.cwd(), "secrets"),
    path.join(__dirname, "../../secrets"),
    path.join(__dirname, "../../../secrets"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "secrets.env"))) {
      return dir;
    }
  }

  return candidates[0];
}

/**
 * Parse a dotenv-style file into process.env (does not override existing keys).
 * @returns {{ loaded: boolean, path: string|null, keys: string[] }}
 */
function loadTestingEnvFile() {
  const secretsDir = resolveSecretsDirectory();
  const testingEnvPath = path.join(secretsDir, "testing.env");

  if (!fs.existsSync(testingEnvPath)) {
    return { loaded: false, path: testingEnvPath, keys: [] };
  }

  const content = fs.readFileSync(testingEnvPath, "utf8");
  const keys = [];

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
      keys.push(key);
    }
  }

  return { loaded: true, path: testingEnvPath, keys };
}

module.exports = {
  resolveSecretsDirectory,
  loadTestingEnvFile,
};
