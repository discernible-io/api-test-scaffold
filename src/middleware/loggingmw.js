const { ulid } = require("ulid");
const logger = require("../../config/logger");

const loggingmw = (req, res, next) => {
 const start = Date.now();

 // Capture the original end function
 const originalEnd = res.end;

 // Override the end function
 res.end = function (chunk, encoding) {
  // Call the original end function
  originalEnd.call(this, chunk, encoding);

  // Now log after the response has been sent
  const duration = Date.now() - start;
  logger.info({
   method: req.method,
   clientIP: req.ip, // Address ID
   roditID: req.user ? req.user.id : "unauthenticated", // Credential ID / Credential Directory
   url: req.originalUrl,
   service: req.logService || "rodit-servertestapi-api", // Source ID / Source Directory
   action: req.logAction || "unspecified", // Type of event / Request type
   // payload with information necessary to perform the request
   resource: res.itemid, // Resource ID / Resource Directory
   status: res.statusCode, // Request result (success, failure, error, source error)
   resulttext: res.statusReason, // ResultText with reason for the Result
   eventID: ulid(),
   timestamp: new Date().toISOString(), // DateTime
   duration,
   // Signature
   // Hash or linked hash
  });
 };

 next();
};

module.exports = loggingmw;
