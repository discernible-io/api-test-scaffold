/**
 * Request Validation Middleware
 * Validates Content-Type and input format BEFORE authentication
 * This improves security, performance, and user experience
 */

const { logger } = require("@rodit/rodit-auth-be");

/**
 * Validate Content-Type for POST/PUT requests
 * Rejects requests with invalid Content-Type before authentication
 */
function validateContentType(req, res, next) {
  // Only validate for POST, PUT, PATCH requests with body
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const contentType = req.get('Content-Type');
  
  // Allow application/json and application/json with charset
  if (!contentType || (!contentType.includes('application/json'))) {
    logger.warnWithContext("Invalid Content-Type", {
      component: "RequestValidation",
      method: req.method,
      path: req.path,
      contentType: contentType || 'missing',
      ip: req.ip
    });

    return res.status(415).json({
      error: "UnsupportedMediaType",
      message: "Content-Type must be application/json",
      received: contentType || null
    });
  }

  next();
}

/**
 * Validate tokenId parameter format
 * Checks if tokenId matches expected format before authentication
 */
function validateTokenIdParam(req, res, next) {
  const tokenId = req.params.tokenId;
  
  if (!tokenId) {
    return next(); // Let route handler deal with missing param
  }

  // TokenId must be exactly 12 lowercase letters a-z
  if (typeof tokenId !== 'string' || tokenId.length !== 12 || !/^[a-z]+$/.test(tokenId)) {
    logger.warnWithContext("Invalid tokenId format", {
      component: "RequestValidation",
      path: req.path,
      tokenId,
      ip: req.ip
    });

    return res.status(400).json({
      error: "InvalidTokenIdFormat",
      message: "tokenId must be exactly 12 lowercase letters a-z",
      tokenId
    });
  }

  next();
}

/**
 * Validate nonce parameter format (hex string)
 * Checks if nonce is valid hex before authentication
 */
function validateNonceParam(req, res, next) {
  const nonce = req.params.nonce || req.query.nonce || req.body?.nonce;
  
  if (!nonce) {
    return next(); // Let route handler deal with missing param
  }

  // Nonce should be a hex string
  if (typeof nonce !== 'string' || !/^[0-9a-fA-F]+$/.test(nonce)) {
    logger.warnWithContext("Invalid nonce format", {
      component: "RequestValidation",
      path: req.path,
      nonce: nonce.substring(0, 20), // Log only first 20 chars
      ip: req.ip
    });

    return res.status(400).json({
      error: "InvalidNonceFormat",
      message: "nonce must be a hexadecimal string",
      nonce: nonce.substring(0, 20)
    });
  }

  next();
}

/**
 * Validate request body is valid JSON
 * Catches JSON parse errors before authentication
 */
function validateJsonBody(req, res, next) {
  // Only validate for POST, PUT, PATCH requests
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  // Express json middleware already parsed it, but check if body exists
  if (req.body === undefined) {
    logger.warnWithContext("Missing request body", {
      component: "RequestValidation",
      method: req.method,
      path: req.path,
      ip: req.ip
    });

    return res.status(400).json({
      error: "InvalidRequest",
      message: "Request body is required"
    });
  }

  next();
}

/**
 * Validate limit query parameter
 * Ensures limit is a positive integer within acceptable range
 */
function validateLimitParam(req, res, next) {
  const limit = req.query.limit;
  
  if (!limit) {
    return next(); // Optional parameter
  }

  const limitNum = parseInt(limit, 10);
  
  if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
    logger.warnWithContext("Invalid limit parameter", {
      component: "RequestValidation",
      path: req.path,
      limit,
      ip: req.ip
    });

    return res.status(400).json({
      error: "InvalidParameter",
      message: "limit must be a positive integer between 1 and 1000",
      limit
    });
  }

  next();
}

module.exports = {
  validateContentType,
  validateTokenIdParam,
  validateNonceParam,
  validateJsonBody,
  validateLimitParam
};
