const winston = require("winston");
const path = require("path");
const config = require("config");
const fs = require('fs');
// You'll need to add this package to your dependencies
require('winston-daily-rotate-file');
const LOG_DIR = config.get("API_OPTIONS.LOG_DIR");
fs.mkdirSync(LOG_DIR, { recursive: true });

// Create rotating file transports
const errorRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'clienttestapiserror-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '7d',
  level: 'error'
});

const combinedRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOG_DIR, 'clienttestapicombined-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '7d'
});

// Create logger with rotating transports
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "clienttestapi-api" },
  transports: [
    new winston.transports.Console(),
    errorRotateTransport,
    combinedRotateTransport
  ],
});

if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

module.exports = logger;