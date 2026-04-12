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

  return {
    logger,
    blockchainService,
    nearorg_rpc_listpublicagents,
    RoditClient
  };
});
