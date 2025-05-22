const { decodeJwt } = require("jose");
const logger = require("../../config/logger");
const crypto = require("crypto");

class PermissionValidator {
  constructor() {
    this.methodPermissionMap = {
      create: ["entityAndProperties"],
      destroy: ["entityAndProperties"],
      read: ["entityAndProperties", "entityOnly"],
      update: ["entityAndProperties", "entityOnly"],
      list: ["entityAndProperties", "entityOnly"],
      list_all: ["entityAndProperties", "entityOnly"],
      sessions: ["entityAndProperties"],
      delete: ["entityAndProperties"],
      cleanup: ["entityAndProperties"],
      logout: ["entityAndProperties"],
    };
  }

  getPermissionScope(rateValue) {
    if (rateValue.startsWith("+")) {
      return "entityAndProperties";
    } else if (rateValue.startsWith("-")) {
      return "propertiesOnly";
    }
    return "entityOnly";
  }

  isMethodAllowed(method, permissionScope) {
    const startTime = Date.now();

    if (!this.methodPermissionMap[method]) {
      logger.error("Unknown method type detected", {
        component: "PermissionValidator",
        method: "isMethodAllowed",
        requestedMethod: method,
        error: `Unknown method type: ${method}`,
        duration: Date.now() - startTime,
      });
      return false;
    }

    const isAllowed =
      this.methodPermissionMap[method].includes(permissionScope);

    logger.debug("Method permission check completed", {
      component: "PermissionValidator",
      method: "isMethodAllowed",
      requestedMethod: method,
      permissionScope,
      isAllowed,
      duration: Date.now() - startTime,
    });

    return isAllowed;
  }

  findMatchingEntity(entities, fullPath, requestId) {
    const startTime = Date.now();

    // Handle entities as an object with name and methods
    const entity = entities.name;
    const methods = entities.methods;
    
    // Log available methods for debugging
    logger.debug("Checking permission for path", {
      component: "PermissionValidator",
      method: "findMatchingEntity",
      requestId,
      fullPath,
      availableMethods: Object.keys(methods),
    });

    // Check for an exact match in the methods
    if (methods.hasOwnProperty(fullPath)) {
      const rateValue = methods[fullPath];
      // Extract the operation name (last part of the path)
      const operation = fullPath.split("/").pop();

      logger.info("Processing permission request", {
        component: "PermissionValidator",
        method: "findMatchingEntity",
        fullPath,
        requestedMethod: operation,
        entity,
        requestId,
      });

      const permissionScope = this.getPermissionScope(rateValue);
      const isPermitted = this.isMethodAllowed(operation, permissionScope);

      logger.debug("Permission check result", {
        component: "PermissionValidator",
        method: "findMatchingEntity",
        fullPath,
        requestedMethod: operation,
        entity,
        permissionScope,
        rateValue,
        isPermitted,
        duration: Date.now() - startTime,
        requestId,
      });

      if (isPermitted) {
        return {
          isPermitted: true,
          commentsRate: rateValue,
          permissionScope,
        };
      }
    }
    
    // For session routes, map them to specific operations
    // This is a fallback for when the exact path is not in methods
    // Ideally, these paths should be added to the methods object in the token
    const sessionRouteMappings = {
      '/api/sessions': 'sessions',
      '/api/sessions/logout': 'logout',
      '/api/sessions/cleanup': 'cleanup',
      '/api/sessions/close': 'delete'  // Static path for session termination
    };
    
    if (sessionRouteMappings[fullPath]) {
      const operation = sessionRouteMappings[fullPath];
      const rateValue = '+sessions'; // Default permission value
      
      logger.info("Processing session permission request", {
        component: "PermissionValidator",
        method: "findMatchingEntity",
        fullPath,
        requestedMethod: operation,
        entity: 'sessions',
        requestId,
      });
      
      const permissionScope = this.getPermissionScope(rateValue);
      const isPermitted = this.isMethodAllowed(operation, permissionScope);
      
      logger.debug("Session permission check result", {
        component: "PermissionValidator",
        method: "findMatchingEntity",
        fullPath,
        requestedMethod: operation,
        entity: 'sessions',
        permissionScope,
        rateValue,
        isPermitted,
        duration: Date.now() - startTime,
        requestId,
      });
      
      if (isPermitted) {
        return {
          isPermitted: true,
          commentsRate: rateValue,
          permissionScope,
        };
      }
    }

    logger.warn("No matching permission found", {
      component: "PermissionValidator",
      method: "findMatchingEntity",
      fullPath,
      duration: Date.now() - startTime,
      requestId,
    });

    return {
      isPermitted: false,
      commentsRate: null,
      permissionScope: null,
    };
  }

  async validate(req) {
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    const startTime = Date.now();

    const token = req.header("Authorization");
    if (!token) {
      logger.warn("Authorization token missing", {
        component: "PermissionValidator",
        method: "validate",
        path: req.path,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        duration: Date.now() - startTime,
        requestId,
      });

      return {
        isValid: false,
        status: 401,
        message: "Access denied. No token provided.",
      };
    }

    try {
      const decodedToken = decodeJwt(token);

      logger.info("Endpoint access attempt", {
        component: "PermissionValidator",
        method: "validate",
        endpoint: req.path,
        userId: decodedToken.sub || "unknown",
        requestId,
      });

      let permissionedRoutes;
      try {
        if (typeof decodedToken.rodit_permissionedroutes === 'string') {
          permissionedRoutes = JSON.parse(decodedToken.rodit_permissionedroutes);
        } else {
          permissionedRoutes = decodedToken.rodit_permissionedroutes;
        }
      } catch (error) {
        logger.error("Failed to parse permissioned routes", {
          component: "PermissionValidator",
          method: "validate",
          requestId,
          error: error.message,
          permissionedRoutesType: typeof decodedToken.rodit_permissionedroutes,
          permissionedRoutesValue: decodedToken.rodit_permissionedroutes ? 
            decodedToken.rodit_permissionedroutes.substring(0, 200) : "undefined",
        });
        throw error;
      }

      // Add debug logging for permission routes content
      logger.debug("Permission routes content", {
        component: "PermissionValidator",
        method: "validate",
        permissionedRoutes: JSON.stringify(permissionedRoutes),
        entitiesType: typeof permissionedRoutes.entities,
        requestId,
      });

      // Use entities directly, assuming it's an object
      const entities = permissionedRoutes.entities;
      
      // Construct the full path for permission checking
      // This must exactly match what's defined in the RODiT token
      const fullPath = req.baseUrl + req.path;
      
      logger.debug("Validating permission for full path", {
        component: "PermissionValidator", 
        method: "validate",
        requestId,
        baseUrl: req.baseUrl,
        path: req.path,
        fullPath,
      });
      
      const { isPermitted, commentsRate, permissionScope } =
        this.findMatchingEntity(entities, fullPath, requestId);

      if (!isPermitted) {
        logger.warn("Permission denied", {
          component: "PermissionValidator",
          method: "validate",
          path: req.path,
          fullPath,
          userId: decodedToken.sub || "unknown",
          duration: Date.now() - startTime,
          requestId,
        });

        return {
          isValid: false,
          status: 403,
          message: "Permission denied",
        };
      }

      logger.info("Authorization successful", {
        component: "PermissionValidator",
        method: "validate",
        path: req.path,
        fullPath,
        userId: decodedToken.sub || "unknown",
        permissionScope,
        rateValue: commentsRate,
        duration: Date.now() - startTime,
        requestId,
      });

      return {
        isValid: true,
        commentsRate,
        permissionScope,
      };
    } catch (error) {
      logger.error("Permission check failed", {
        component: "PermissionValidator",
        method: "validate",
        path: req.path,
        error: error.message,
        errorCode: "112",
        stack: error.stack,
        duration: Date.now() - startTime,
        requestId,
      });

      return {
        isValid: false,
        status: 400,
        message: "Error 119: Invalid token or permissions.",
      };
    }
  }
}

const permissionValidator = new PermissionValidator();

/**
 * @swagger
 * /authorize:
 *   get:
 *     summary: Authorize user and check JWT token fields
 *     description: Verify the JWT token and check specific fields before granting access
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Authorization successful
 *       401:
 *         description: Unauthorized - Invalid token or missing required fields
 */
async function validatepermissions(req, res, next) {
  const startTime = Date.now();
  const requestId = req.headers["x-request-id"] || crypto.randomUUID();

  if (!req.headers["x-request-id"]) {
    req.headers["x-request-id"] = requestId;
  }

  logger.debug("Permission validation started", {
    component: "validatepermissions",
    method: "middleware",
    path: req.path,
    baseUrl: req.baseUrl,
    fullPath: req.baseUrl + req.path,
    requestId,
  });

  const result = await permissionValidator.validate(req);

  if (!result.isValid) {
    logger.warn("Permission validation failed", {
      component: "validatepermissions",
      method: "middleware",
      path: req.path,
      status: result.status,
      message: result.message,
      duration: Date.now() - startTime,
      requestId,
    });

    return res.status(result.status).json({ message: result.message });
  }

  if (result.commentsRate) {
    req.commentsRate = result.commentsRate;
    req.permissionScope = result.permissionScope;
  }

  logger.debug("Permission validation successful", {
    component: "validatepermissions",
    method: "middleware",
    path: req.path,
    permissionScope: result.permissionScope,
    duration: Date.now() - startTime,
    requestId,
  });

  next();
}

module.exports = validatepermissions;