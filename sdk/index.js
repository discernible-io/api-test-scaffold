/**
 * RODiT SDK - Main Entry Point
 * 
 * This SDK provides a client interface for interacting with RODiT authentication and API services.
 * It supports token validation, permission checking, rate limiting, and webhook management.
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
 *   // Check token validity
 *   if (!client.isTokenValid()) {
 *     console.error('Token is not valid at the current time');
 *     return;
 *   }
 *   
 *   // Make API requests
 *   const response = await client.request('GET', '/api/endpoint');
 *   console.log(response);
 *   
 *   // Get token metadata
 *   const metadata = client.getTokenMetadata();
 *   console.log('Token valid until:', metadata.not_after);
 *   
 *   // Explore available API endpoints
 *   const endpoints = await client.getAvailableEndpoints();
 *   console.log('Available endpoints:', Object.keys(endpoints));
 * }
 * 
 * main().catch(console.error);
 */

const RoditClient = require('../src/client/roditclient');
const { ensureProtocol } = require('../src/utils');
const ipaddr = require('ipaddr.js');

/**
 * Utility functions for working with RODiT services
 * @namespace utils
 */
const utils = {

  /**
   * Validate RODiT token configuration
   * @memberof utils
   * @param {Object} config - RODiT token configuration object to validate
   * @returns {Promise<{valid: boolean, errors: string[]}>} Validation result with detailed error messages
   */
  validateRoditToken: async (config) => {
    const errors = [];
    
    if (!config) {
      return { valid: false, errors: ['Configuration is required'] };
    }
    
    // Add validation rules as needed
    if (!config.metadata) {
      errors.push('Missing required field: metadata');
    } else {
      // Required fields
      if (!config.metadata.subjectuniqueidentifier_url) {
        errors.push('Missing required field: metadata.subjectuniqueidentifier_url');
      }
      
      // Date validation
      if (config.metadata.not_before) {
        try {
          new Date(config.metadata.not_before);
        } catch (e) {
          errors.push('Invalid date format for metadata.not_before');
        }
      }
      
      if (config.metadata.not_after) {
        try {
          new Date(config.metadata.not_after);
        } catch (e) {
          errors.push('Invalid date format for metadata.not_after');
        }
      }
      
      // CIDR validation
      if (config.metadata.allowed_cidr && !utils.isValidCidr(config.metadata.allowed_cidr)) {
        errors.push('Invalid CIDR format for metadata.allowed_cidr');
      }
      
      if (config.metadata.webhook_cidr && !utils.isValidCidr(config.metadata.webhook_cidr)) {
        errors.push('Invalid CIDR format for metadata.webhook_cidr');
      }
      
      // URL validation
      if (config.metadata.subjectuniqueidentifier_url && !utils.isValidUrl(config.metadata.subjectuniqueidentifier_url)) {
        errors.push('Invalid URL format for metadata.subjectuniqueidentifier_url');
      }
      
      if (config.metadata.openapijson_url && !utils.isValidUrl(config.metadata.openapijson_url)) {
        errors.push('Invalid URL format for metadata.openapijson_url');
      }
      
      // JSON field validation
      if (config.metadata.allowed_iso3166list) {
        try {
          JSON.parse(config.metadata.allowed_iso3166list);
        } catch (e) {
          errors.push('Invalid JSON format for metadata.allowed_iso3166list');
        }
      }
      
      if (config.metadata.permissioned_routes) {
        try {
          JSON.parse(config.metadata.permissioned_routes);
        } catch (e) {
          errors.push('Invalid JSON format for metadata.permissioned_routes');
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  },
  
  /**
   * Check if a service subscription is currently active based on token validity dates
   * @memberof utils
   * @param {Object} metadata - Token metadata containing subscription period information
   * @returns {boolean} True if the subscription is currently active
   * @example
   * const isActive = utils.isSubscriptionActive({
   *   not_before: '2023-01-01',
   *   not_after: '2025-01-01'
   * });
   * console.log(isActive); // true or false depending on current date
   */
  isSubscriptionActive: (metadata) => {
    if (!metadata) {
      return false;
    }
    
    const now = new Date();
    let isValid = true;
    
    // Check not_before date if present
    if (metadata.not_before) {
      const notBefore = new Date(metadata.not_before);
      if (now < notBefore) {
        isValid = false;
      }
    }
    
    // Check not_after date if present
    if (metadata.not_after) {
      const notAfter = new Date(metadata.not_after);
      if (now > notAfter) {
        isValid = false;
      }
    }
    
    return isValid;
  },
  
  /**
   * Check if a client IP address is authorized to access the API
   * @memberof utils
   * @param {string} clientIp - Client IP address to check
   * @param {string} allowedCidr - Allowed CIDR range from token metadata
   * @returns {boolean} True if the client IP is authorized
   * @example
   * const isAuthorized = utils.isClientIpAuthorized('192.168.1.5', '192.168.1.0/24');
   * console.log(isAuthorized); // true
   */
  isClientIpAuthorized: (clientIp, allowedCidr) => {
    try {
      // Parse the CIDR notation
      const [range, bits] = allowedCidr.split('/');
      const ipAddr = ipaddr.parse(clientIp);
      const rangeAddr = ipaddr.parse(range);
      const mask = parseInt(bits, 10);
      
      if (ipAddr.kind() !== rangeAddr.kind()) {
        return false;
      }
      
      return ipAddr.match(rangeAddr, mask);
    } catch (e) {
      return false;
    }
  },
  
  /**
   * Validate IP range format in CIDR notation
   * @memberof utils
   * @param {string} cidrRange - CIDR notation to validate
   * @returns {boolean} True if the CIDR notation is valid
   * @example
   * const isValid = utils.isValidIpRange('192.168.1.0/24');
   * console.log(isValid); // true
   */
  isValidIpRange: (cidrRange) => {
    try {
      const [range, bits] = cidrRange.split('/');
      
      // Validate IP part
      ipaddr.parse(range);
      
      // Validate bits part
      const mask = parseInt(bits, 10);
      if (isNaN(mask) || mask < 0 || mask > 32) {
        return false;
      }
      
      return true;
    } catch (e) {
      return false;
    }
  },
  
  /**
   * Validate API endpoint URL format
   * @memberof utils
   * @param {string} endpointUrl - API endpoint URL to validate
   * @returns {boolean} True if the URL is valid and has proper protocol
   * @example
   * const isValid = utils.isValidEndpoint('https://example.com');
   * console.log(isValid); // true
   */
  isValidEndpoint: (endpointUrl) => {
    try {
      const urlObj = new URL(ensureProtocol(endpointUrl));
      return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
    } catch (e) {
      return false;
    }
  },
  
  /**
   * Parse token metadata JSON fields safely
   * @memberof utils
   * @param {string} metadataJson - JSON string from token metadata (e.g., permissioned_routes, allowed_iso3166list)
   * @param {*} defaultValue - Default value to return if parsing fails
   * @returns {*} Parsed object or default value
   * @example
   * const routes = utils.parseMetadataJson(token.metadata.permissioned_routes, {});
   * console.log(routes); // { entities: { ... } }
   */
  parseMetadataJson: (metadataJson, defaultValue = {}) => {
    try {
      return JSON.parse(metadataJson);
    } catch (e) {
      return defaultValue;
    }
  }
};

/**
 * Token metadata structure
 * @typedef {Object} TokenMetadata
 * @property {string} allowed_cidr - CIDR range for allowed client IP addresses. Defines the IP ranges from which the client is permitted to access the API.
 * @property {string} allowed_iso3166list - JSON string of allowed country codes. Specifies which countries the API can be used from, using ISO 3166 country codes.
 * @property {string} jwt_duration - JWT token duration in seconds. Defines how long authentication tokens remain valid.
 * @property {string} max_requests - Maximum number of requests allowed within the time window.
 * @property {string} maxrq_window - Time window for rate limiting in seconds. Works with max_requests to define rate limits.
 * @property {string} not_after - Token expiration date. Indicates when the service subscription ends or when the token becomes invalid.
 * @property {string} not_before - Token validity start date. Indicates when the service subscription begins or when the token becomes valid.
 * @property {string} openapijson_url - URL to OpenAPI specification. Provides API documentation and schema information.
 * @property {string} permissioned_routes - JSON string defining which API routes can be used and what rate limiting applies to them. Controls access to specific endpoints.
 * @property {string} serviceprovider_id - Service provider ID. Uniquely identifies the service provider.
 * @property {string} serviceprovider_signature - Service provider signature. Cryptographic signature to verify the token's authenticity.
 * @property {string} subjectuniqueidentifier_url - API endpoint URL. The base URL for all API requests.
 * @property {string} userselected_dn - User selected distinguished name. Contains identity information about the token owner.
 * @property {string} webhook_cidr - CIDR range for server IP addresses that are allowed to send webhooks to the client. Restricts webhook sources.
 * @property {string} webhook_url - Webhook URL. Endpoint where notifications will be sent.
 */

/**
 * Create a new RoditClient with enhanced features
 * @param {Object} [options] - Client options
 * @param {string} [options.credentialsPath] - Path to credentials file
 * @returns {RoditClient} New RoditClient instance
 */
function createClient(options = {}) {
  return new RoditClient(options);
}

// Export the main components
module.exports = {
  /** @type {typeof RoditClient} */
  RoditClient,
  
  /** @type {typeof ensureProtocol} */
  ensureProtocol,
  
  /** @type {typeof utils} */
  utils,
  
  /** @type {Function} */
  createClient
};
