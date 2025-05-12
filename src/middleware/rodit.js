/**
 * Integration layer for backward compatibility with existing code
 * Copyright (c) 2024 Cableguard, Inc. All rights reserved.
 */

const { ulid } = require("ulid");
const config = require("config");
const logger = require("../../config/logger");
const Authentication = require('../auth/authentication');
const TokenService = require('../auth/tokenservice');
const BlockchainService = require('../blockchain/blockchainservice');
const AuthenticationMiddleware = require('./authenticationmiddleware');
const session = require('../auth/sessionmanager');
const { CONSTANTS, API_OPTIONS, SERVERPORT, API_PROTOCOL, NEAR_RPC_URL, TOKEN_RENEWAL_OPTIONS } = require('../utils/constants');
const validators = require('../validators');
const utils = require('../utils');

// Original state managers (keep same instances)
const { AuthStateManager } = require('./initialrodit');
const { RoditManager } = require('./initialrodit');

// Create or use existing instances
const stateManager = new AuthStateManager();
const roditManager = new RoditManager();
const sessionManager = session;

// Create new service instances
const blockchainService = new BlockchainService({
  CONSTANTS,
  NEAR_RPC_URL
});

const tokenService = new TokenService(stateManager, blockchainService);
const authentication = new Authentication(stateManager, tokenService, blockchainService);
const authMiddleware = new AuthenticationMiddleware(tokenService, stateManager);

// Maintain backward compatibility by exporting all the original functions
// but delegating to our new class implementations
module.exports = {
  // Original state managers
  stateManager,
  roditManager,
  
  // Constants
  CONSTANTS,
  
  // Class definitions for backward compatibility
  AuthStateManager,
  
  // Authentication functions
  login_client: (req, res) => authentication.login_client(req, res),
  logout_client: (req, res) => authentication.logout_client(req, res),
  login_server: (own_rodit) => authentication.login_server(own_rodit),
  login_portal: (own_rodit, port) => authentication.login_portal(own_rodit, port),
  login_client_withnep413: (req, res, config_own_rodit) => 
    authentication.login_client_withnep413(req, res, config_own_rodit),
  
  // Token functions
  generate_jwt_token: (peer_rodit, peer_timestamp, own_rodit, own_rodit_bytes_private_key, session_status) =>
    tokenService.generate_jwt_token(peer_rodit, peer_timestamp, own_rodit, own_rodit_bytes_private_key, session_status),
  
// Middleware
authenticate_apicall: (req, res, next) => authMiddleware.authenticate_apicall(req, res, next),
  
// Webhook functions
send_webhook: (event, data, isError, req) => authentication.send_webhook(event, data, isError, req),
authenticate_webhook: (payload, signature_hex_ofpayload, timestamp, peer_rodit_owner_id) =>
  authentication.authenticate_webhook(payload, signature_hex_ofpayload, timestamp, peer_rodit_owner_id),

// Blockchain functions
nearorg_rpc_state: (id, accountId) => blockchainService.nearorg_rpc_state(id, accountId),
nearorg_rpc_tokensfromaccountid: (id, account_id) => 
  blockchainService.nearorg_rpc_tokensfromaccountid(id, account_id),
nearorg_rpc_fetchpublickeybytes: (accountId) =>
  blockchainService.nearorg_rpc_fetchpublickeybytes(accountId),
nearorg_rpc_tokenfromroditid: (roditid) =>
  blockchainService.nearorg_rpc_tokenfromroditid(roditid),
nearorg_rpc_timestamp: () => blockchainService.nearorg_rpc_timestamp(),

// Token service functions
base64url2jwk_public_key: (base64url_public_key) => 
  tokenService.base64url2jwk_public_key(base64url_public_key),

// Utility functions from utils/index.js
debugWithType: utils.debugWithType,
ensureDateIsSet: utils.ensureDateIsSet,
base64ToBase64Url: utils.base64ToBase64Url,
canonicalizeObject: utils.canonicalizeObject,
calculateCanonicalHash: utils.calculateCanonicalHash,
logServerBufferState: utils.logServerBufferState,
fetchWithErrorHandling: utils.fetchWithErrorHandling,

// Validation functions from validators/index.js
validateAndSetUrl: validators.validateAndSetUrl,
validateAndSetDate: validators.validateAndSetDate,
validateAndSetJson: validators.validateAndSetJson,
validateAndSetSignature: validators.validateAndSetSignature,
};