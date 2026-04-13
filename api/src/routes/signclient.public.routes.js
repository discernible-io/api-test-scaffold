const express = require("express");
const router = express.Router();
const { ulid } = require("ulid");
const { logger, roditManager } = require("@rodit/rodit-auth-be");
const { createLogContext, logErrorWithMetrics } = logger;
const { calculateMintingFee, getMintingFeeAccount } = require("../utils/fee-calculator");
const { validateContentType, validateJsonBody } = require("../middleware/request-validation");

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

      return res.status(400).json({
        error: "Request body is missing or malformed",
        details: "Expected JSON body with tobesignedValues and mintingfee",
        requestId,
        contentType: req.get("Content-Type")
      });
    }

    const { tobesignedValues, mintingfee: clientMintingFee } = req.body;

    const validationContext = {
      ...baseContext,
      hasSignedValues: !!tobesignedValues,
      hasClientMintingFee: !!clientMintingFee,
      bodySize: req.body ? JSON.stringify(req.body).length : 0
    };

    if (!tobesignedValues) {
      logger.warnWithContext("Missing required field tobesignedValues", validationContext);

      return res.status(400).json({
        error: "Missing required field: tobesignedValues",
        requestId
      });
    }

    if (!clientMintingFee) {
      logger.warnWithContext("Missing mintingfee in signclient request", validationContext);

      return res.status(400).json({
        error: "Missing required field: mintingfee",
        requestId
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

    try {
      const requestedPermissions = JSON.parse(tobesignedValues.permissioned_routes);
      const configPermissions = JSON.parse(config_own_rodit.own_rodit.metadata.permissioned_routes);

      const requestedMethods = requestedPermissions?.entities?.methods || {};
      const configMethods = configPermissions?.entities?.methods || {};

      const invalidRoutes = [];
      for (const routeKey of Object.keys(requestedMethods)) {
        if (!Object.prototype.hasOwnProperty.call(configMethods, routeKey)) {
          invalidRoutes.push(routeKey);
          logger.warnWithContext("Invalid route permission requested", {
            ...baseContext,
            route: routeKey,
            permission: requestedMethods[routeKey],
            reason: "not_in_config"
          });
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

        return res.status(400).json({
          error: "Invalid permissions requested",
          details: {
            invalidRoutes,
            message: "One or more requested permissions are not available in the server's configuration",
            availableRoutes: Object.keys(configMethods)
          },
          requestId: req.requestId
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

      return res.status(400).json({
        error: "Invalid permission format",
        details: {
          message: "Could not parse requested permissions",
          parseError: error.message
        },
        requestId: req.requestId
      });
    }

    let feeCalculation;
    try {
      feeCalculation = calculateMintingFee({
        maxRequests: tobesignedValues.max_requests,
        maxrqWindow: tobesignedValues.maxrq_window,
        notAfter: tobesignedValues.not_after,
        numberofrodit: 1
      });

      logger.infoWithContext("Calculated minting fee", {
        ...baseContext,
        serverTotalFee: feeCalculation.totalFee,
        clientTotalFee: clientMintingFee,
        perRoditFee: feeCalculation.perRoditFee,
        daysUntilExpiry: feeCalculation.daysUntilExpiry,
        numberofrodit: feeCalculation.breakdown.numberofrodit
      });

      logger.debugWithContext("Fee calculation breakdown", {
        ...baseContext,
        breakdown: feeCalculation.breakdown
      });
    } catch (error) {
      logger.errorWithContext("Failed to calculate minting fee", {
        ...baseContext,
        error: error.message,
        maxRequests: tobesignedValues.max_requests,
        maxrqWindow: tobesignedValues.maxrq_window,
        notAfter: tobesignedValues.not_after
      });

      return res.status(400).json({
        error: "Invalid fee calculation parameters",
        details: error.message,
        requestId
      });
    }

    const serverFee = parseFloat(feeCalculation.totalFee);
    const clientFee = parseFloat(clientMintingFee);
    const feeTolerance = 0.000001;

    if (Math.abs(serverFee - clientFee) > feeTolerance) {
      logger.errorWithContext("Minting fee mismatch", {
        ...baseContext,
        serverFee,
        clientFee,
        difference: Math.abs(serverFee - clientFee),
        breakdown: feeCalculation.breakdown
      });

      return res.status(400).json({
        error: "Minting fee mismatch",
        details: {
          message: "The minting fee provided does not match the server's calculation",
          clientFee: clientMintingFee,
          serverFee: feeCalculation.totalFee,
          breakdown: feeCalculation.breakdown
        },
        requestId
      });
    }

    const mintingfee = feeCalculation.totalFee;
    const mintingfeeaccount = getMintingFeeAccount();

    const tamperproofedValues = {
      openapijson_url: config_own_rodit.own_rodit.metadata.openapijson_url,
      not_after: tobesignedValues.not_after,
      not_before: config_own_rodit.own_rodit.metadata.not_before,
      max_requests: String(tobesignedValues.max_requests),
      maxrq_window: String(tobesignedValues.maxrq_window),
      webhook_cidr: config_own_rodit.own_rodit.metadata.webhook_cidr,
      allowed_cidr: config_own_rodit.own_rodit.metadata.allowed_cidr,
      allowed_iso3166list: config_own_rodit.own_rodit.metadata.allowed_iso3166list,
      jwt_duration: config_own_rodit.own_rodit.metadata.jwt_duration,
      permissioned_routes: tobesignedValues.permissioned_routes,
      subjectuniqueidentifier_url: config_own_rodit.own_rodit.metadata.subjectuniqueidentifier_url,
      serviceprovider_id: config_own_rodit.own_rodit.metadata.serviceprovider_id,
      serviceprovider_signature: tobesignedValues.serviceprovider_signature
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

    res.status(201).json(signResult);
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

    res.status(statusCode).json({
      error: isValidationError ? "Invalid request" : "Failed to sign client request",
      reason: errorType,
      details: error.message,
      impact: "Unable to complete the requested operation",
      requestId
    });
  }
});

module.exports = router;
