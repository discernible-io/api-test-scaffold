const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const { logger, roditManager, errorResponse } = require("@rodit/rodit-auth-be");
const { createLogContext, logErrorWithMetrics } = logger;
const { calculateMintingFee, getMintingFeeAccount } = require("../utils/fee-calculator");
const { validateContentType, validateJsonBody } = require("../middleware/request-validation");
const { sendError } = errorResponse;

async function signPortalRodit(port, tamperproofedValues, mintingfee, mintingfeeaccount, roditClient) {
  const requestId = ulid();
  const startTime = Date.now();

  const baseContext = createLogContext({
    requestId,
    component: "SignPortal",
    method: "signPortalRodit",
    serviceProviderId: tamperproofedValues.serviceprovider_id,
    port
  });

  logger.debugWithContext("Sending signportal request", baseContext);

  const apiendpoint = roditClient.getPortalUrl(tamperproofedValues.serviceprovider_id, port);

  const signportalJwtToken = roditClient.getSignPortalJwtToken();
  const requestBody = {
    tamperproofedValues,
    mintingfee,
    mintingfeeaccount
  };

  const fetchUrl = `${apiendpoint}/api/portal/signportal`;

  const headers = {
    "Content-Type": "application/json",
    "X-Request-ID": requestId
  };

  if (signportalJwtToken) {
    headers["Authorization"] = `Bearer ${signportalJwtToken}`;
  }

  const apiCallContext = {
    ...baseContext,
    url: fetchUrl,
    headers: Object.keys(headers),
    bodySize: JSON.stringify(requestBody).length,
    hasToken: !!signportalJwtToken
  };

  logger.infoWithContext("Preparing SignPortal API call", apiCallContext);
  logger.debugWithContext("Request body details", {
    ...baseContext,
    bodyKeys: Object.keys(requestBody)
  });

  try {
    const result = await roditClient.fetchWithErrorHandlingSignPortal(fetchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });

    const duration = Date.now() - startTime;
    logger.infoWithContext("Raw response received from SignPortal", {
      ...baseContext,
      responseReceived: true,
      duration
    });

    if (result.error) {
      const errorDuration = Date.now() - startTime;

      logErrorWithMetrics(
        "SignPortal error response",
        {
          ...baseContext,
          errorCode: result.error,
          errorMessage: result.message,
          duration: errorDuration
        },
        new Error(`SignPortal error: ${result.error}: ${result.message}`),
        "signportal_error",
        {
          operation: "signPortalRodit",
          result: "error",
          duration: errorDuration
        }
      );

      throw new Error(`SignPortal error: ${result.error}: ${result.message}`);
    }

    const successDuration = Date.now() - startTime;
    logger.infoWithContext("SignPortal operation successful", {
      ...baseContext,
      tokenId: result.token_id,
      duration: successDuration
    });

    logger.metric("signportal_operations", successDuration, {
      operation: "signPortalRodit",
      result: "success"
    });

    return result;
  } catch (error) {
    const errorDuration = Date.now() - startTime;

    logErrorWithMetrics(
      "Error during signportal operation",
      {
        ...baseContext,
        errorMessage: error.message,
        duration: errorDuration
      },
      error,
      "signportal_error",
      {
        operation: "signPortalRodit",
        result: "error",
        duration: errorDuration
      }
    );

    throw error;
  }
}

router.use(express.json());
router.use(express.urlencoded({ extended: false }));

router.post("/signclient", validateContentType, validateJsonBody, async (req, res) => {
  const requestId = ulid();
  const startTime = Date.now();

  const baseContext = createLogContext({
    requestId,
    component: "SignClient",
    method: "handleSignClientRequest",
    endpoint: "/signclient",
    httpMethod: req.method,
    ip: req.ip,
    userAgent: req.get("User-Agent")
  });

  logger.infoWithContext("Received signclient request", baseContext);

  logger.debugWithContext("Request debugging info", {
    ...baseContext,
    hasBody: !!req.body,
    bodyType: typeof req.body,
    contentType: req.get("Content-Type"),
    contentLength: req.get("Content-Length")
  });

  try {
    if (!req.body) {
      logger.errorWithContext("Request body is undefined", {
        ...baseContext,
        cause: "Missing or malformed JSON in request",
        contentType: req.get("Content-Type"),
        contentLength: req.get("Content-Length")
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_BODY_INVALID",
        message: "Request body is missing or malformed",
        details: {
          expected: "JSON body with tobesignedValues and mintingfee",
          contentType: req.get("Content-Type")
        }
      });
    }

    const { tobesignedValues, mintingfee: clientMintingFee, token_id: callerTokenId, tier } = req.body;

    const validationContext = {
      ...baseContext,
      hasSignedValues: !!tobesignedValues,
      hasClientMintingFee: !!clientMintingFee,
      hasCallerTokenId: !!callerTokenId,
      hasTier: !!tier,
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    };

    if (!tobesignedValues) {
      logger.debugWithContext("Missing required field tobesignedValues", validationContext);

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_TOBESIGNED_MISSING",
        message: "Missing required field: tobesignedValues"
      });
    }

    if (!clientMintingFee) {
      logger.debugWithContext("Missing mintingfee in signclient request", validationContext);

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_FEE_MISSING",
        message: "Missing required field: mintingfee"
      });
    }

    // Validate token_id format if provided
    // Note: token_id is only used for enterprise/collectible tiers
    // For personal tier, token_id is generated by SignPortal and any provided value is ignored
    if (callerTokenId) {
      if (typeof callerTokenId !== 'string' || !/^[bcdfhjkmnpqrtvwxy]{12}$/.test(callerTokenId)) {
        logger.debugWithContext("Invalid token_id format", {
          ...validationContext,
          tokenIdType: typeof callerTokenId,
          tokenIdLength: callerTokenId?.length
        });

        return sendError(res, {
          statusCode: 400,
          requestId,
          code: "SIGNCLIENT_TOKEN_ID_INVALID",
          message: "Invalid token_id format - must be 12 characters from charset: bcdfhjkmnpqrtvwxy",
          details: {
            provided: callerTokenId,
            expected: "12 characters from safe charset (bcdfhjkmnpqrtvwxy)",
            pattern: "^[bcdfhjkmnpqrtvwxy]{12}$"
          }
        });
      }

      logger.infoWithContext("Caller provided token_id for signing", {
        ...baseContext,
        callerTokenId,
        tier: tier?.toLowerCase() || "not-specified"
      });
    }

    // Validate tier if provided
    if (tier) {
      const validTiers = ["personal", "enterprise", "collectible"];
      if (typeof tier !== 'string' || !validTiers.includes(tier.toLowerCase())) {
        logger.debugWithContext("Invalid tier value", {
          ...validationContext,
          tier,
          tierType: typeof tier
        });

        return sendError(res, {
          statusCode: 400,
          requestId,
          code: "SIGNCLIENT_TIER_INVALID",
          message: "Invalid tier - must be one of: personal, enterprise, collectible",
          details: {
            provided: tier,
            expected: "one of: personal, enterprise, collectible"
          }
        });
      }

      logger.infoWithContext("Caller provided tier for fee calculation", {
        ...baseContext,
        tier: tier.toLowerCase()
      });
    }

    if (!roditManager.vaultInitialized) {
      logger.infoWithContext("Initializing vault for signclient", baseContext);
      await roditManager.initializeCredentialsStore();
      await roditManager.initializeRoditConfig("server");
    }

    const roditClient = req.app.locals.roditClient;
    if (!roditClient) {
      throw new Error("RoditClient not available in app.locals");
    }

    const config_own_rodit = await roditClient.getConfigOwnRodit();
    if (!config_own_rodit) {
      logger.errorWithContext("Failed to get RODiT configuration", baseContext);
      throw new Error("Failed to initialize RODiT configuration");
    }

    const portalPort = 8443;

    const jwtContext = {
      ...baseContext,
      portalPort,
      hasExistingToken: !!roditClient.getSignPortalJwtToken()
    };

    if (!roditClient.getSignPortalJwtToken()) {
      logger.infoWithContext("Authenticating with SignPortal", jwtContext);

      const loginResult = await roditClient.login_portal(config_own_rodit, portalPort);

      if (!loginResult.jwt_token) {
        const errorDetails = loginResult.error || "Unknown error";
        const errorReason = loginResult.reason || "Connection to SignPortal failed";

        logger.errorWithContext("Failed to obtain JWT token: Authentication with SignPortal failed", {
          ...jwtContext,
          errorDetails,
          errorReason,
          impact: "Cannot proceed with client authentication flow"
        });

        throw new Error(`Failed to obtain JWT token from SignPortal: ${errorReason}`);
      }

      await roditClient.setSignPortalJwtToken(loginResult.jwt_token);
      logger.infoWithContext("Successfully authenticated with SignPortal", jwtContext);
    }

    const MAX_PERMISSIONS_JSON_LENGTH = 16384; // 16KB

    if (typeof tobesignedValues.permissioned_routes !== "string") {
      logger.debugWithContext("Invalid permissioned_routes type", {
        ...baseContext,
        type: typeof tobesignedValues.permissioned_routes
      });
      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_PERMISSIONS_FORMAT",
        message: "permissioned_routes must be a JSON string"
      });
    }

    if (tobesignedValues.permissioned_routes.length > MAX_PERMISSIONS_JSON_LENGTH) {
      logger.debugWithContext("permissioned_routes exceeds maximum size", {
        ...baseContext,
        length: tobesignedValues.permissioned_routes.length,
        maxLength: MAX_PERMISSIONS_JSON_LENGTH
      });
      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_PERMISSIONS_TOO_LARGE",
        message: `permissioned_routes must be less than ${MAX_PERMISSIONS_JSON_LENGTH} characters`,
        details: { actualLength: tobesignedValues.permissioned_routes.length }
      });
    }

    try {
      const requestedPermissions = JSON.parse(tobesignedValues.permissioned_routes);
      const configPermissions = JSON.parse(config_own_rodit.own_rodit.metadata.permissioned_routes);

      const requestedMethods = requestedPermissions?.entities?.methods || {};
      const configMethods = configPermissions?.entities?.methods || {};

      const invalidRoutes = [];
      const privilegedRoutes = [];
      
      for (const routeKey of Object.keys(requestedMethods)) {
        if (!Object.prototype.hasOwnProperty.call(configMethods, routeKey)) {
          invalidRoutes.push(routeKey);
          logger.debugWithContext("Invalid route permission requested", {
            ...baseContext,
            route: routeKey,
            permission: requestedMethods[routeKey],
            reason: "not_in_config"
          });
        }
      }

      // Extract method names from full paths and check privilege level
      const methodPermissionMap = require("@rodit/rodit-auth-be").config.get("METHOD_PERMISSION_MAP") || {};
      
      for (const routeKey of Object.keys(requestedMethods)) {
        // Extract method name from path (e.g., "/api/metrics/reset" -> "reset" or "metrics")
        const pathParts = routeKey.split("/").filter(p => p);
        
        for (const part of pathParts) {
          const methodConfig = methodPermissionMap[part];
          if (methodConfig && methodConfig.privilege === "privileged") {
            privilegedRoutes.push(routeKey);
            logger.debugWithContext("Privileged operation requested in client token", {
              ...baseContext,
              route: routeKey,
              method: part,
              privilege: "privileged",
              reason: "client_tokens_cannot_have_privileged_operations"
            });
            break;
          }
        }
      }

      if (invalidRoutes.length > 0) {
        const errorMessage = `Invalid permission(s) requested: ${invalidRoutes.join(", ")}`;
        logger.errorWithContext("Permission validation failed - rejecting signing request", {
          ...baseContext,
          invalidRoutes,
          requestedRouteCount: Object.keys(requestedMethods).length,
          configRouteCount: Object.keys(configMethods).length,
          error: errorMessage
        });

        return sendError(res, {
          statusCode: 400,
          requestId,
          code: "SIGNCLIENT_PERMISSIONS_INVALID",
          message: "Invalid permissions requested",
          details: {
            invalidRoutes,
            message: "One or more requested permissions are not available in the server's configuration",
            availableRoutes: Object.keys(configMethods)
          }
        });
      }

      if (privilegedRoutes.length > 0) {
        const errorMessage = `Privileged operation(s) cannot be granted to client tokens: ${privilegedRoutes.join(", ")}`;
        logger.errorWithContext("Privileged operations requested in client token - rejecting signing request", {
          ...baseContext,
          privilegedRoutes,
          requestedRouteCount: Object.keys(requestedMethods).length,
          error: errorMessage
        });

        return sendError(res, {
          statusCode: 403,
          requestId,
          code: "SIGNCLIENT_PRIVILEGED_OPERATIONS_DENIED",
          message: "Privileged operations cannot be granted to client tokens",
          details: {
            privilegedRoutes,
            message: "Client tokens can only be granted access to non-privileged operations",
            reason: "Privileged operations are reserved for server-to-server authentication"
          }
        });
      }

      logger.infoWithContext("All requested permissions are valid - proceeding with signing", {
        ...baseContext,
        validatedRouteCount: Object.keys(requestedMethods).length
      });
    } catch (error) {
      logger.errorWithContext("Failed to validate permissions - rejecting signing request", {
        ...baseContext,
        error: error.message,
        permissioned_routes: tobesignedValues.permissioned_routes
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_PERMISSIONS_PARSE_FAILED",
        message: "Invalid permission format",
        details: {
          message: "Could not parse requested permissions",
          parseError: error.message
        }
      });
    }

    let feeCalculation;
    try {
      feeCalculation = calculateMintingFee({
        maxRequests: tobesignedValues.max_requests,
        maxrqWindow: tobesignedValues.maxrq_window,
        expirationDate: tobesignedValues.not_after,
        numberofrodit: 1,
        tier: tier ? tier.toLowerCase() : null
      });

      const serverTotalFee = feeCalculation.perRoditNear;

      logger.infoWithContext("Calculated minting fee", {
        ...baseContext,
        serverTotalFee,
        clientTotalFee: clientMintingFee,
        perRoditNear: feeCalculation.perRoditNear,
        daysUntilExpiry: feeCalculation.daysUntilExpiry,
        feeMultiplier: feeCalculation.feeMultiplier,
        tier: feeCalculation.tier
      });

      logger.debugWithContext("Fee calculation breakdown", {
        ...baseContext,
        feeCalculation
      });
    } catch (error) {
      logger.errorWithContext("Failed to calculate minting fee", {
        ...baseContext,
        error: error.message,
        maxRequests: tobesignedValues.max_requests,
        maxrqWindow: tobesignedValues.maxrq_window,
        expirationDate: tobesignedValues.not_after
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_FEE_PARAMS_INVALID",
        message: "Invalid fee calculation parameters",
        details: error.message
      });
    }

    const serverFee = parseFloat(feeCalculation.perRoditNear);
    const clientFee = parseFloat(clientMintingFee);
    const feeTolerance = 0.000001;

    if (Math.abs(serverFee - clientFee) > feeTolerance) {
      logger.errorWithContext("Minting fee mismatch", {
        ...baseContext,
        serverFee,
        clientFee,
        difference: Math.abs(serverFee - clientFee),
        feeCalculation
      });

      return sendError(res, {
        statusCode: 400,
        requestId,
        code: "SIGNCLIENT_FEE_MISMATCH",
        message: "Minting fee mismatch",
        details: {
          message: "The minting fee provided does not match the server's calculation",
          clientFee: clientMintingFee,
          serverFee: feeCalculation.perRoditNear,
          feeCalculation
        }
      });
    }

    const mintingfee = feeCalculation.perRoditNear;
    const mintingfeeaccount = getMintingFeeAccount();

    // Parse allowed_iso3166list from JSON string to object for SignPortal
    let allowedIso3166List = config_own_rodit.own_rodit.metadata.allowed_iso3166list;
    if (allowedIso3166List && typeof allowedIso3166List === 'string') {
      try {
        allowedIso3166List = JSON.parse(allowedIso3166List);
      } catch (e) {
        logger.warnWithContext('Failed to parse allowed_iso3166list, passing as-is', {
          ...baseContext,
          error: e.message
        });
      }
    }

    // Only include token_id for enterprise/collectible tiers
    // For personal tier, SignPortal generates the token_id, so any provided value is ignored
    const tierLower = tier?.toLowerCase() || "personal";
    const shouldIncludeTokenId = callerTokenId && tierLower !== "personal";

    const tamperproofedValues = {
      openapijson_url: config_own_rodit.own_rodit.metadata.openapijson_url,
      not_after: tobesignedValues.not_after,
      not_before: config_own_rodit.own_rodit.metadata.not_before,
      max_requests: String(tobesignedValues.max_requests),
      maxrq_window: String(tobesignedValues.maxrq_window),
      webhook_cidr: config_own_rodit.own_rodit.metadata.webhook_cidr,
      allowed_cidr: config_own_rodit.own_rodit.metadata.allowed_cidr,
      allowed_iso3166list: allowedIso3166List,
      jwt_duration: config_own_rodit.own_rodit.metadata.jwt_duration,
      permissioned_routes: tobesignedValues.permissioned_routes,
      subjectuniqueidentifier_url: config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url,
      serviceprovider_id: config_own_rodit.own_rodit.metadata.serviceprovider_id,
      serviceprovider_signature: tobesignedValues.serviceprovider_signature,
      ...(shouldIncludeTokenId && { token_id: callerTokenId })
    };

    const tokenContext = {
      ...baseContext,
      serviceprovider_id: tamperproofedValues.serviceprovider_id,
      not_after: tamperproofedValues.not_after,
      not_before: tamperproofedValues.not_before,
      mintingfee,
      mintingfeeaccount
    };

    logger.debugWithContext("Prepared tamperproofed values for signing", tokenContext);

    logger.infoWithContext("Sending request to SignPortal", {
      ...baseContext,
      operation: "signPortalRodit"
    });

    const signResult = await signPortalRodit(
      portalPort,
      tamperproofedValues,
      mintingfee,
      mintingfeeaccount,
      roditClient
    );

    if (!signResult) {
      logger.errorWithContext("Sign operation failed with null result", baseContext);
      throw new Error("Sign operation failed");
    }

    const duration = Date.now() - startTime;
    const successContext = {
      ...baseContext,
      token_id: signResult.token_id,
      status: "success",
      duration,
      has_fee_signature: !!signResult.fee_signature_base64url
    };

    logger.infoWithContext("Successfully created new RODiT token", successContext);

    if (signResult.fee_signature_base64url) {
      logger.debugWithContext("Fee signature received from SignPortal", {
        ...baseContext,
        token_id: signResult.token_id,
        fee_signature_length: signResult.fee_signature_base64url.length
      });
    } else {
      logger.warnWithContext("No fee signature received from SignPortal", {
        ...baseContext,
        token_id: signResult.token_id
      });
    }

    logger.metric("signclient_operations", duration, {
      operation: "handleSignClientRequest",
      result: "success"
    });

    // Ensure fee data is included in response for all tiers so frontend can verify signature
    // SignPortal signs: { token_id, mintingfee, mintingfeeaccount }
    // Frontend needs these exact values to reconstruct and verify the fee_signature_base64url
    const responseWithFeeData = {
      ...signResult,
      // Include the exact fee data that was signed (for frontend verification)
      fee_data: {
        token_id: signResult.token_id,
        mintingfee: String(mintingfee),
        mintingfeeaccount: mintingfeeaccount
      }
    };

    logger.debugWithContext("Returning response with fee data for verification", {
      ...baseContext,
      token_id: signResult.token_id,
      has_fee_signature: !!signResult.fee_signature_base64url,
      has_fee_data: !!responseWithFeeData.fee_data,
      fee_data_keys: Object.keys(responseWithFeeData.fee_data || {}),
      mintingfee: responseWithFeeData.fee_data?.mintingfee,
      mintingfeeaccount: responseWithFeeData.fee_data?.mintingfeeaccount
    });

    res.status(201).json(responseWithFeeData);
  } catch (error) {
    const duration = Date.now() - startTime;

    const rootCause = error.cause ? error.cause.message : error.message;
    const errorType = error.name || error.constructor.name;

    const isValidationError =
      error.statusCode === 400 ||
      error.message?.includes("validation") ||
      error.message?.includes("Invalid") ||
      error.message?.includes("Missing") ||
      error.message?.includes("permission");

    const statusCode = isValidationError ? 400 : 500;

    logErrorWithMetrics(
      `Error in signclient endpoint: ${errorType}`,
      {
        ...baseContext,
        errorMessage: error.message,
        errorName: errorType,
        rootCause,
        reason: error.reason || "Request processing failed",
        impact: "Client request cannot be completed",
        duration,
        statusCode,
        isValidationError
      },
      error,
      "signclient_error",
      {
        operation: "handleSignClientRequest",
        result: "error",
        duration
      }
    );

    sendError(res, {
      statusCode,
      requestId,
      code: isValidationError ? "SIGNCLIENT_INVALID_REQUEST" : "SIGNCLIENT_FAILED",
      message: isValidationError ? "Invalid request" : "Failed to sign client request",
      details: {
        reason: errorType,
        message: error.message,
        impact: "Unable to complete the requested operation"
      }
    });
  }
});

module.exports = router;
