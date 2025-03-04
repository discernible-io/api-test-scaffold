const winston = require("winston");
const path = require("path");
const config = require("config");
const fs = require('fs');
const LOG_DIR = config.get("API_OPTIONS.LOG_DIR");

fs.mkdirSync(LOG_DIR, { recursive: true });

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),  defaultMeta: { service: "clienttestapi-api" },
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'clienttestapiserror.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'clienttestapicombined.log') }),
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
