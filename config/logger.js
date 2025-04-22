const winston = require("winston");
const path = require("path");
const config = require("config");
const fs = require('fs');

// Configuration
const LOG_DIR = config.get("API_OPTIONS.LOG_DIR");
const SERVICE_NAME = "clienttest-api";

// Ensure log directory exists
fs.mkdirSync(LOG_DIR, { recursive: true });

// Custom format to standardize and enhance logs for Grafana
const grafanaFormat = winston.format.combine(
  // Convert errors to serializable objects with proper stack traces
  winston.format((info) => {
    // Handle Error objects
    if (info.error instanceof Error) {
      info.error = {
        message: info.error.message,
        stack: info.error.stack,
        name: info.error.name
      };
    }
    
    // Standardize log level names to uppercase
    if (info.level) {
      info.level = info.level.toUpperCase();
    }
    
    // Add standard fields if not present
    info.service_name = info.service_name || SERVICE_NAME;
    info.context = info.context || {};
    
    // Add hostname for better filtering
    info.hostname = require('os').hostname();
    
    return info;
  })(),
  
  // Add timestamp in ISO format for better time-based queries
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  
  // Convert to JSON with proper spacing
  winston.format.json()
);

// Create the logger
const logger = winston.createLogger({
  level: "debug", // Default level
  format: grafanaFormat,
  defaultMeta: { 
    service_name: SERVICE_NAME
  },
  levels: {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3
  },
  transports: [
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'signroditserror.log'),
      level: 'ERROR'
    }),
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'signroditcombined.log')
    }),
  ],
});

// Add console transport for non-production environments
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...rest }) => {
          // Extract error for better console display
          const errorStr = rest.error ? 
            `\n${JSON.stringify(rest.error, null, 2)}` : '';
          
          // Extract context for cleaner display
          const contextStr = rest.context && Object.keys(rest.context).length ? 
            `\n${JSON.stringify(rest.context, null, 2)}` : '';
          
          return `${timestamp} [${level}]: ${message}${errorStr}${contextStr}`;
        })
      )
    })
  );
}

// Add helper methods for consistent context logging
logger.logWithContext = (level, message, context = {}, error = null) => {
  logger.log({
    level,
    message,
    context,
    ...(error && { error })
  });
};

// Helper methods for each log level with context support
['error', 'warn', 'info', 'debug'].forEach(level => {
  logger[`${level}WithContext`] = (message, context = {}, error = null) => {
    logger.logWithContext(level, message, context, error);
  };
});

module.exports = logger;