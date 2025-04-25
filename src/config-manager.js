// config-manager.js
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

/**
 * Configuration Manager
 * Handles loading, updating, and persisting test configuration
 */
class ConfigManager {
  constructor(configPath) {
    this.configPath = configPath || process.env.CONFIG_PATH || path.resolve(__dirname, '../config/test-config.json');
    this.config = null;
  }
  
  /**
   * Load configuration from file
   */
  async loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = await fs.promises.readFile(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
        logger.infoWithContext('Configuration loaded successfully', {
          component: 'ConfigManager',
          operation: 'loadConfig',
          configPath: this.configPath
        });
        return this.config;
      } else {
        // If no config file exists, create a default one
        this.config = this.getDefaultConfig();
        await this.saveConfig();
        logger.infoWithContext('Default configuration created', {
          component: 'ConfigManager',
          operation: 'loadConfig',
          configPath: this.configPath
        });
        return this.config;
      }
    } catch (error) {
      logger.errorWithContext('Error loading configuration', {
        component: 'ConfigManager',
        operation: 'loadConfig',
        configPath: this.configPath,
        error: error.message
      }, error);
      
      // Fall back to default config if loading fails
      this.config = this.getDefaultConfig();
      return this.config;
    }
  }
  
  /**
   * Get current configuration or load if not loaded
   */
  async getConfig() {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }
  
  /**
   * Update specific configuration properties
   */
  async updateConfig(updates) {
    try {
      if (!this.config) {
        await this.loadConfig();
      }
      
      // Deep merge updates into current config
      this.config = this.deepMerge(this.config, updates);
      
      // Save updated config to file
      await this.saveConfig();
      
      logger.infoWithContext('Configuration updated successfully', {
        component: 'ConfigManager',
        operation: 'updateConfig',
        configPath: this.configPath,
        updatedKeys: Object.keys(updates)
      });
      
      return this.config;
    } catch (error) {
      logger.errorWithContext('Error updating configuration', {
        component: 'ConfigManager',
        operation: 'updateConfig',
        configPath: this.configPath,
        error: error.message
      }, error);
      
      throw error;
    }
  }
  
  /**
   * Save current configuration to file
   */
  async saveConfig() {
    try {
      // Ensure directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        await fs.promises.mkdir(configDir, { recursive: true });
      }
      
      // Write config to file
      await fs.promises.writeFile(
        this.configPath,
        JSON.stringify(this.config, null, 2),
        'utf8'
      );
      
      logger.debugWithContext('Configuration saved to file', {
        component: 'ConfigManager',
        operation: 'saveConfig',
        configPath: this.configPath
      });
      
      return true;
    } catch (error) {
      logger.errorWithContext('Error saving configuration', {
        component: 'ConfigManager',
        operation: 'saveConfig',
        configPath: this.configPath,
        error: error.message
      }, error);
      
      throw error;
    }
  }
  
  /**
   * Get default configuration values
   */
  getDefaultConfig() {
    return {
      "API_OPTIONS": {
        "ISO639": "es",
        "ISO3166": "ES",
        "ISO15924": "215",
        "TIMEOPTIONS": {
          "tzname": "Europe/Madrid",
          "tzoffset": "+01:00",
          "datetimeformat": "2023-04-15T14:30:00-05:00"
        },
        "TOKENRENEWALOPTIONS": {
          "MIN_RENEWAL_PERCENTAGE": "0.75",
          "THRESHOLD_VALIDATION_TYPE": "0.75",
          "DURATIONRAMP": "0.9",
          "SERVERORCLIENT": "SERVER-INITIATED"
        },
        "LOG_DIR": "/app/logs",
        "TEST_CLIENT_DURATION": "5",  // 5 minutes by default
        "TEST_INTERVAL": "1",         // 1 minute by default
        "MAX_REQUESTS": 100,
        "MAXRQ_WINDOW": 100,
        "ENABLED_TEST_SUITES": [
          "authentication",
          "permissions",
          "rateLimits",
          "security",
          "performance"
        ],
        "EXCLUDED_TESTS": []  // Tests to skip
      },
      "APISERVICEOPTIONS": {
        "scaccountid": "10975-cableguard-org.testnet",
        "serviceprovider_id": "10975-cableguard-org.testnet",
        "openapijsonurl": "https://api.aparejos.net/api-docs",
        "notbefore": "2024-08-24",
        "maxrequests": "0",
        "maxrqwindow": "0",
        "webhookcidr": "0.0.0.0/0",
        "allowedcidr": "0.0.0.0/0",
        "allowediso3166list": { "allow": ["WLD"] },
        "jwtduration": 3600,
        "subjectuniqueidentifier_url": "https://api.aparejos.net",
        "webhookurl": "https://dev-webhook.aparejos.net",
        "userselecteddn": "CN=Backend,OU=Engineering,O=Rodit Inc,L=San Enrique,ST=Cadiz,C=ES",
        "fee": "1"
      }
    };
  }
  
  /**
   * Deep merge two objects
   */
  deepMerge(target, source) {
    // Create a fresh copy to avoid modifying original
    const output = {...target};
    
    // If both are objects, merge properties
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          // If property exists and is an object, recurse
          if (key in target && this.isObject(target[key])) {
            output[key] = this.deepMerge(target[key], source[key]);
          } else {
            // Otherwise just copy the source property
            output[key] = {...source[key]};
          }
        } else {
          // For non-objects, simply override the target property
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }
  
  /**
   * Check if value is an object
   */
  isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
  }
}

// Create singleton instance
const configManager = new ConfigManager();

module.exports = configManager;