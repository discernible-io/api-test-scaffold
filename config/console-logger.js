/**
 * Console Logger
 * A simple client-side friendly logger using console methods
 * 
 * Copyright (c) 2024 Ayayai, Inc. All rights reserved.
 */

const config = require('config');

// Default log level if not specified in config
const DEFAULT_LOG_LEVEL = 'info';

// Log levels and their numeric values (lower number = higher priority)
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Get log level from config or use default
let configLogLevel;
try {
  configLogLevel = config.get('LOG_LEVEL');
} catch (error) {
  configLogLevel = DEFAULT_LOG_LEVEL;
}

// Check if console logging is enabled in config
let enableConsoleLogging = true;
try {
  enableConsoleLogging = config.get('ENABLE_CONSOLE_LOGGING');
} catch (error) {
  // Default to true if not specified
  enableConsoleLogging = true;
}

// Current log level
const currentLogLevel = LOG_LEVELS[configLogLevel.toLowerCase()] !== undefined 
  ? LOG_LEVELS[configLogLevel.toLowerCase()] 
  : LOG_LEVELS[DEFAULT_LOG_LEVEL];

/**
 * Format a log message with context
 * 
 * @param {string} message - The log message
 * @param {Object} context - Additional context information
 * @returns {string} - Formatted log message
 */
function formatLogMessage(message, context = {}) {
  const timestamp = new Date().toISOString();
  
  // Format context as string if present
  let contextStr = '';
  if (context && Object.keys(context).length > 0) {
    try {
      contextStr = ` ${JSON.stringify(context)}`;
    } catch (error) {
      contextStr = ' [Context serialization error]';
    }
  }
  
  return `${timestamp} - ${message}${contextStr}`;
}

/**
 * Console logger implementation
 */
const logger = {
  /**
   * Log an error message
   * 
   * @param {string} message - Error message
   * @param {Object} context - Additional context
   */
  error(message, context) {
    if (!enableConsoleLogging) return;
    if (currentLogLevel >= LOG_LEVELS.error) {
      console.error(formatLogMessage(message, context));
      
      // If context contains an error object, log the stack trace
      if (context && context.error && context.error.stack) {
        console.error(context.error.stack);
      }
    }
  },
  
  /**
   * Log a warning message
   * 
   * @param {string} message - Warning message
   * @param {Object} context - Additional context
   */
  warn(message, context) {
    if (!enableConsoleLogging) return;
    if (currentLogLevel >= LOG_LEVELS.warn) {
      console.warn(formatLogMessage(message, context));
    }
  },
  
  /**
   * Log an info message
   * 
   * @param {string} message - Info message
   * @param {Object} context - Additional context
   */
  info(message, context) {
    if (!enableConsoleLogging) return;
    if (currentLogLevel >= LOG_LEVELS.info) {
      console.info(formatLogMessage(message, context));
    }
  },
  
  /**
   * Log a debug message
   * 
   * @param {string} message - Debug message
   * @param {Object} context - Additional context
   */
  debug(message, context) {
    if (!enableConsoleLogging) return;
    if (currentLogLevel >= LOG_LEVELS.debug) {
      console.debug(formatLogMessage(message, context));
    }
  },
  
  /**
   * Log a message with specified level
   * 
   * @param {Object} logData - Log data with level, message, and context
   */
  log(logData) {
    const { level, message, context } = logData;
    
    if (level && typeof this[level.toLowerCase()] === 'function') {
      this[level.toLowerCase()](message, context);
    } else {
      this.info(message, context);
    }
  },
  
  /**
   * Log with context helper methods
   */
  errorWithContext(message, context = {}, error = null) {
    if (error) {
      context.error = error;
    }
    this.error(message, context);
  },
  
  warnWithContext(message, context = {}) {
    this.warn(message, context);
  },
  
  infoWithContext(message, context = {}) {
    this.info(message, context);
  },
  
  debugWithContext(message, context = {}) {
    this.debug(message, context);
  },
  
  /**
   * Log a metric (simplified version for console)
   * 
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   * @param {Object} labels - Metric labels
   */
  metric(name, value, labels = {}) {
    if (!enableConsoleLogging) return;
    if (currentLogLevel >= LOG_LEVELS.debug) {
      console.debug(formatLogMessage(`METRIC: ${name}=${value}`, {
        metric_name: name,
        metric_value: value,
        metric_labels: labels
      }));
    }
  }
};

module.exports = logger;
