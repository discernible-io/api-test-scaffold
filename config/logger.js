const winston = require("winston");
const path = require("path");
const config = require("config");
const fs = require('fs');
const LOG_DIR = config.get("LOG_DIR");

fs.mkdirSync(LOG_DIR, { recursive: true });

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  defaultMeta: { service: "rodit-api-client" },
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'cgcerror.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join(LOG_DIR, 'cgccombined.log') }),
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
