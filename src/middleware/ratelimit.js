/**
 * Rate limiting middleware for API protection
 * Updated to work with express-rate-limit v7.x
 */
const rateLimit = require('express-rate-limit');
const logger = require('../../config/logger');

/**
 * Creates a rate limiting middleware with the specified configuration
 * 
 * @param {number} maxRequests - Maximum number of requests allowed per window
 * @param {number} windowMinutes - Time window in minutes for rate limiting
 * @returns {Function} - Express middleware function
 */
function ratelimitmw(maxRequests = 100, windowMinutes = 15) {
  logger.info('Rate limiting enabled', {
    maxRequests,
    windowMinutes
  });

  const limiter = rateLimit({
    // Define window in milliseconds (converting from minutes)
    windowMs: windowMinutes * 60 * 1000,
    
    // Maximum number of requests per window
    max: maxRequests,
    
    // Return rate limit info in the headers
    standardHeaders: true,
    
    // Disable X-RateLimit-* headers
    legacyHeaders: false,
    
    // Handler for when the rate limit is exceeded
    handler: (req, res, next, options) => {
      // Log rate limit exceeded events
      logger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userId: req.user ? req.user.id : 'anonymous',
        maxRequests: options.max,
        windowMinutes: options.windowMs / (60 * 1000)
      });
      
      // Send error response
      res.status(options.statusCode).json({
        error: 'RateLimitExceeded',
        message: options.message,
        maxRequests: options.max,
        windowMinutes: options.windowMs / (60 * 1000)
      });
    },
    
    // Skip rate limiting for certain requests (optional)
    skip: (req, res) => {
      // Example: Skip rate limiting for health check endpoints
      return req.path === '/health' || req.path === '/metrics';
    }
  });

  return limiter;
}

module.exports = ratelimitmw;