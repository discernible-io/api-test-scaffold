/**
 * RODiT SDK - Main Entry Point
 * 
 * This SDK provides a client interface for interacting with RODiT authentication and API services.
 * 
 * @module @cableguard/rodit-sdk
 * @version 1.0.0
 * @license MIT
 * 
 * @example
 * // Basic usage
 * const { RoditClient, utils } = require('@cableguard/rodit-sdk');
 * 
 * async function main() {
 *   // Create a new client
 *   const client = new RoditClient();
 *   
 *   // Initialize with credentials
 *   await client.init({
 *     credentialsPath: './path/to/credentials.json'
 *   });
 *   
 *   // Make API requests
 *   const response = await client.request('GET', '/api/endpoint');
 *   console.log(response);
 * }
 * 
 * main().catch(console.error);
 */

const RoditClient = require('../src/client/roditclient');
const { ensureProtocol } = require('../src/utils');

/**
 * Utility functions for working with RODiT services
 * @namespace utils
 */
const utils = {
  /**
   * Convert Unix timestamp to ISO date string
   * @memberof utils
   * @param {number|string} unixTime - Unix timestamp in seconds
   * @returns {Promise<string>} ISO 8601 formatted date string
   * @example
   * const dateStr = await utils.unixTimeToDateString(1617235200);
   * console.log(dateStr); // "2021-04-01T00:00:00.000Z"
   */
  unixTimeToDateString: async (unixTime) => {
    const timestamp = Number(unixTime);
    
    if (isNaN(timestamp)) {
      throw new Error('Invalid timestamp format: must be a number or numeric string');
    }
    
    return new Date(timestamp * 1000).toISOString();
  },
  
  /**
   * Convert date string to Unix timestamp
   * @memberof utils
   * @param {string} dateString - Date string (any valid Date string format)
   * @returns {Promise<number>} Unix timestamp in seconds
   * @example
   * const timestamp = await utils.dateStringToUnixTime('2021-04-01T00:00:00.000Z');
   * console.log(timestamp); // 1617235200
   */
  dateStringToUnixTime: async (dateString) => {
    if (typeof dateString !== 'string') {
      throw new Error('Date must be provided as a string');
    }
    
    const date = new Date(dateString);
    
    if (isNaN(date.getTime())) {
      throw new Error('Invalid date string format');
    }
    
    return Math.floor(date.getTime() / 1000);
  },

  /**
   * Validate RODiT configuration
   * @memberof utils
   * @param {Object} config - Configuration object to validate
   * @returns {Promise<{valid: boolean, errors: string[]}>} Validation result
   */
  validateConfig: async (config) => {
    const errors = [];
    
    if (!config) {
      return { valid: false, errors: ['Configuration is required'] };
    }
    
    // Add validation rules as needed
    if (!config.metadata) {
      errors.push('Missing required field: metadata');
    } else {
      if (!config.metadata.subjectuniqueidentifier_url) {
        errors.push('Missing required field: metadata.subjectuniqueidentifier_url');
      }
      if (!config.metadata.auth_endpoint) {
        errors.push('Missing required field: metadata.auth_endpoint');
      }
      if (!config.metadata.api_endpoint) {
        errors.push('Missing required field: metadata.api_endpoint');
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
};

// Export the main components
module.exports = {
  /** @type {typeof RoditClient} */
  RoditClient,
  
  /** @type {typeof ensureProtocol} */
  ensureProtocol,
  
  /** @type {typeof utils} */
  utils
};
