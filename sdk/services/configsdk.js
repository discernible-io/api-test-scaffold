/**
 * Configuration management
 * Copyright (c) 2025 Discernible, Inc. All rights reserved.
 */

/*
 * SDK Config Wrapper with Fallback Defaults
 *
 * This module wraps the 'config' package to provide safe accessors that
 * gracefully fall back to baked-in defaults when config keys are missing.
 *
 * Exclusions: Vault keys (VAULT_*) and METHOD_PERMISSION_MAP are intentionally
 * NOT included in fallback defaults.
 */


// Attempt to load the 'config' package if present in the host app
let nodeConfig = null;
try {
  // Using require directly so consumer apps can bring their own 'config'
  // eslint-disable-next-line import/no-extraneous-dependencies
  nodeConfig = require("config");
} catch (_) {
  nodeConfig = null;
}

// Deep utilities (no external deps)
function deepGet(obj, keyPath) {
  if (!obj || !keyPath) return undefined;
  const parts = keyPath.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
      cur = cur[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

function isPlainObject(val) {
  return val && typeof val === "object" && !Array.isArray(val);
}

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...(target || {}) };
  if (isPlainObject(source)) {
    for (const [k, v] of Object.entries(source)) {
      if (isPlainObject(v)) {
        out[k] = deepMerge(out[k] || {}, v);
      } else if (Array.isArray(v)) {
        out[k] = Array.isArray(out[k]) ? [...out[k], ...v] : [...v];
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

// Baked-in fallback defaults sourced from config/default.json (excluding Vault and METHOD_PERMISSION_MAP)
const FALLBACK_DEFAULTS = {
  API_VERSION: "0.0.0",
  RODIT_NEAR_CREDENTIALS_SOURCE: "env",
  SECURITY_OPTIONS: {
    LAPSED_LIFETIME_PROPORTION_4RENEWAL_ELIGIBILITY: "0.80",
    THRESHOLD_VALIDATION_TYPE: "0.10",
    DURATIONRAMP: "0.85",
    SERVERORCLIENT: "SERVER-INITIATED",
    SILENT_LOGIN_FAILURES: false,
    RELAXED_SESSION_VALIDATION: true,
    LOGIN_MODE: "partner", // Options: "partner" (default), "promiscuous", "p2p"
  },
  // Default to env-based credential store; host apps can override with RODIT_NEAR_CREDENTIALS_SOURCE env
  credentials: {
    filePath: "./.near-credentials/credentials-not-set.json"
  },
  API_DEFAULT_OPTIONS: {
    ISO639: "es",
    ISO3166: "ES",
    ISO15924: "215",
    TIMESTAMP_MAX_AGE: 300,
    TIMEOPTIONS: {
      tzname: "Europe/Madrid",
      tzoffset: "+01:00",
      datetimeformat: "2023-04-15T14:30:00-05:00",
    },
  },
  NEAR_RPC_URL: "https://rpc.mainnet.fastnear.com",
  NEAR_CONTRACT_ID: "rodit-org.near",
  SERVICE_NAME: "service-name-not-set",
  NODE_ENV: "production", // Environment: production, development, test
  LOG_LEVEL: "info", // Logging verbosity: error, warn, info, debug, trace
  SIGNPORTAL_API_URL: "https://signportal.api-not-set.example.com",
  // Session storage configuration
  SESSION_STORAGE_TYPE: "memory",
  // Session cleanup configuration
  SESSION_CLEANUP_INTERVAL: 500000, // Milliseconds
  SESSION_TOKEN_RETENTION_PERIOD: 5000000,  // Seconds
  NEAR_RPC_CACHE_TTL: 5000, // Milliseconds
  // Session validation cache TTL (milliseconds) - trades security for performance
  // Lower values = more secure but more storage lookups
  // Higher values = faster but longer window after logout where token may still work
  // Set to 0 to disable caching (always check session state)
  SESSION_VALIDATION_CACHE_TTL: 5000, // 5 seconds default
  // Webhook TLS verification configuration
  // Set to true to skip TLS certificate verification for webhook destinations
  // This is safe when mutual authentication via digital signatures is in place
  WEBHOOK_TLS_SKIP_VERIFY: false, // Default to strict TLS verification
  // Default empty permission map so consumers can opt-into permissions as needed
  METHOD_PERMISSION_MAP: {},
};

function has(pathStr) {
  if (nodeConfig && typeof nodeConfig.has === "function") {
    try {
      if (nodeConfig.has(pathStr)) return true;
    } catch (_) {}
  }
  return deepGet(FALLBACK_DEFAULTS, pathStr) !== undefined;
}

/**
 * Get configuration value with fallback support
 * @param {string} pathStr - Configuration key path (e.g., 'API_DEFAULT_OPTIONS.LOG_DIR')
 * @param {*} defaultValue - Optional default value if key is missing
 * @returns {*} Configuration value
 */
function get(pathStr, defaultValue) {
  // Priority 1: Check environment variables directly
  // This ensures GitHub Actions env vars always take precedence
  const envVarName = pathStr.toUpperCase().replace(/\./g, '_');
  const envValue = process.env[envVarName];
  if (envValue !== undefined) {
    // Parse numeric strings to numbers if they look like numbers
    if (/^\d+$/.test(envValue)) {
      return parseInt(envValue, 10);
    }
    // Parse boolean strings
    if (envValue === 'true') return true;
    if (envValue === 'false') return false;
    return envValue;
  }
  
  // Priority 2: Try to get from host config (which may have its own env var mappings)
  let hostValue;
  let hostHasValue = false;
  
  if (nodeConfig) {
    try {
      hostValue = nodeConfig.get(pathStr);
      hostHasValue = true;
    } catch (err) {
      // Host config doesn't have this key, continue to fallback
    }
  }
  
  // If host has the value, return it
  if (hostHasValue) {
    return hostValue;
  }
  
  // Priority 3: Try SDK fallback defaults
  const fallbackValue = deepGet(FALLBACK_DEFAULTS, pathStr);
  if (fallbackValue !== undefined) {
    return fallbackValue;
  }
  
  // Priority 4: If default value provided, return it
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  
  // Throw error similar to config package
  const err = new Error(`Configuration property '${pathStr}' is not defined`);
  err.code = 'CONFIG_PROPERTY_MISSING';
  throw err;
}

function getAllMerged() {
  // Returns a merged view: node config (if any) overlaid onto fallbacks
  let merged = { ...FALLBACK_DEFAULTS };
  if (nodeConfig && typeof nodeConfig.util?.toObject === "function") {
    try {
      const asObject = nodeConfig.util.toObject();
      merged = deepMerge(FALLBACK_DEFAULTS, asObject);
    } catch (_) {}
  }
  return merged;
}

/**
 * Validation rules for critical configuration
 */
const VALIDATION_RULES = {
  'NEAR_RPC_URL': {
    required: true,
    type: 'string',
    validate: (value, logger) => {
      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return 'NEAR_RPC_URL must be a valid HTTP/HTTPS URL';
      }
      // Warn if using public endpoint
      if (value.includes('rpc.mainnet.near.org')) {
        logger && logger.warn('⚠️  Using public NEAR RPC endpoint - expect rate limiting!', {
          rpcUrl: value,
          recommendation: 'Use a dedicated RPC provider for production'
        });
      }
      return null;
    }
  },
  'SECURITY_OPTIONS.LOGIN_MODE': {
    required: true,
    type: 'string',
    validate: (value) => {
      const validModes = ['partner', 'promiscuous', 'p2p'];
      if (!validModes.includes(value)) {
        return `LOGIN_MODE must be one of: ${validModes.join(', ')}`;
      }
      return null;
    }
  },
  'LOG_LEVEL': {
    required: false,
    type: 'string',
    validate: (value) => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      if (value && !validLevels.includes(value)) {
        return `LOG_LEVEL must be one of: ${validLevels.join(', ')}`;
      }
      return null;
    }
  },
  'NEAR_RPC_TIMEOUT': {
    required: false,
    type: 'number',
    validate: (value) => {
      if (value && (value < 1000 || value > 60000)) {
        return 'NEAR_RPC_TIMEOUT should be between 1000-60000ms';
      }
      return null;
    }
  },
  'NEAR_CONTRACT_ID': {
    required: true,
    type: 'string',
    validate: (value) => {
      if (!value || value.length === 0) {
        return 'NEAR_CONTRACT_ID cannot be empty';
      }
      return null;
    }
  }
};

/**
 * Validate configuration against defined rules
 * @param {Object} logger - Optional logger instance for warnings
 * @returns {boolean} True if validation passes
 * @throws {Error} If validation fails
 */
function validate(logger) {
  const errors = [];
  const warnings = [];

  logger && logger.info('🔍 Validating configuration...');

  for (const [key, rules] of Object.entries(VALIDATION_RULES)) {
    let value;
    try {
      value = get(key);
    } catch (err) {
      if (rules.required) {
        errors.push(`Missing required config: ${key}`);
      }
      continue;
    }

    // Type check
    if (rules.type && typeof value !== rules.type) {
      errors.push(`${key} must be of type ${rules.type}, got ${typeof value}`);
      continue;
    }

    // Custom validation
    if (rules.validate) {
      const validationError = rules.validate(value, logger);
      if (validationError) {
        errors.push(`${key}: ${validationError}`);
      }
    }

    logger && logger.debug(`✓ ${key}: ${value}`);
  }

  if (errors.length > 0) {
    logger && logger.error('❌ Configuration validation failed:', { errors });
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  if (warnings.length > 0) {
    logger && logger.warn('⚠️  Configuration warnings:', { warnings });
  }

  logger && logger.info('✅ Configuration validation passed');
  return true;
}

module.exports = {
  has,
  get,
  getAllMerged,
  validate,
  FALLBACK_DEFAULTS,
  VALIDATION_RULES,
};
