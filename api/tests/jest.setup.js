jest.mock("@rodit/rodit-auth-be", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    infoWithContext: jest.fn(),
    warnWithContext: jest.fn(),
    errorWithContext: jest.fn(),
    debugWithContext: jest.fn(),
    metric: jest.fn(),
    createLogContext: jest.fn(() => ({})),
    logErrorWithMetrics: jest.fn()
  };

  const blockchainService = {
    nearorg_rpc_fetchpublickeybytes: jest.fn(),
    nearorg_rpc_timestamp: jest.fn(),
    nearorg_rpc_tokensfromaccountid: jest.fn()
  };

  const nearorg_rpc_listpublicagents = jest.fn();

  const RoditClient = {
    create: jest.fn()
  };

  const buildErrorResponse = ({ requestId, code, message, details }) => {
    const payload = {
      error: {
        code,
        message
      },
      requestId,
      timestamp: new Date().toISOString()
    };

    if (details) {
      payload.error.details = details;
    }

    return payload;
  };

  const sendError = (res, { statusCode = 500, requestId, code, message, details }) => {
    return res.status(statusCode).json(buildErrorResponse({ requestId, code, message, details }));
  };

  const errorResponse = { sendError, buildErrorResponse };

  return {
    logger,
    blockchainService,
    nearorg_rpc_listpublicagents,
    RoditClient,
    errorResponse,
    sendError,
    buildErrorResponse
  };
});
