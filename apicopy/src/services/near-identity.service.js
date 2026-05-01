const { logger, blockchainService } = require("@rodit/rodit-auth-be");
const config = require("config");

class NearIdentityService {
  constructor() {
    this.rpcUrl = config.get("NEAR_RPC_URL");
    this.contractId = config.get("NEAR_CONTRACT_ID");
  }

  refreshConfig() {
    this.rpcUrl = config.get("NEAR_RPC_URL");
    this.contractId = config.get("NEAR_CONTRACT_ID");
  }

  async getToken(tokenId) {
    this.refreshConfig();
    const startTime = Date.now();
    const context = logger.createLogContext("NearIdentityService", "getToken", {
      tokenId
    });

    if (!this.rpcUrl || !this.contractId) {
      logger.warnWithContext("NearIdentityService.getToken called without NEAR configuration", {
        ...context,
        rpcUrl: this.rpcUrl,
        contractId: this.contractId
      });
      return null;
    }
    if (!tokenId || typeof tokenId !== "string") {
      logger.warnWithContext("NearIdentityService.getToken called without valid tokenId", context);
      return null;
    }

    logger.infoWithContext("NearIdentityService.getToken called", context);

    try {
      const token = await blockchainService.nearorg_rpc_tokenfromroditid(tokenId);

      if (!token || !token.token_id) {
        logger.infoWithContext("NearIdentityService.getToken - token not found on NEAR", context);
        return null;
      }

      const duration = Date.now() - startTime;
      logger.infoWithContext("NearIdentityService.getToken successful", {
        ...context,
        tokenId: token.token_id,
        ownerId: token.owner_id,
        duration
      });

      logger.metric("near_identity_get_token", duration, {
        operation: "getToken",
        result: "success"
      });

      return token;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.logErrorWithMetrics(
        "NearIdentityService.getToken failed",
        { ...context, duration },
        error,
        "near_identity_get_token_error",
        { operation: "getToken", result: "error", duration }
      );
      throw error;
    }
  }
}

module.exports = new NearIdentityService();
