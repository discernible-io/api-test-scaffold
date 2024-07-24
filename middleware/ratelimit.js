const rateLimit = require("express-rate-limit");

function ratelimitmw(maxrequests, maxrqwindow) {
  return rateLimit({
    windowMs: maxrqwindow * 60 * 1000, // Convert minutes to milliseconds
    max: maxrequests,
    message: `You have exceeded your ${maxrequests} requests per ${maxrqwindow} minute(s) limit.`,
    headers: true,
  });
}
module.exports = ratelimitmw;