/**
 * Service for interacting with the blockchain network
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

const { ulid } = require("ulid");
const config = require("../../services/configsdk");
const logger = require("../../services/logger");
const { createLogContext, logErrorWithMetrics } = logger;

const baseModuleContext = createLogContext("BlockchainService", "module", {
  loadedAt: new Date().toISOString()
});

logger.debugWithContext("Loading blockchainservice.js module", baseModuleContext);

/**
 * Constants and Configuration
 */
const CONSTANTS = {
  NEAR_CONTRACT_ID: config.get("NEAR_CONTRACT_ID"),
  RODIT_ID_SZ: 128,
  RODIT_ID_PK_SZ: 32,
  RODIT_ID_SIGNATURE_SZ: 64,
  ED25519_KEY_SZ: 64,
};

function getNearRpcUrl() {
  return config.get("NEAR_RPC_URL");
}

const DEFAULT_NEAR_RPC_TIMEOUT_MS = 5000;

function getNearRpcTimeoutMs() {
  const raw = config.get("NEAR_RPC_TIMEOUT", DEFAULT_NEAR_RPC_TIMEOUT_MS);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_NEAR_RPC_TIMEOUT_MS;
}

/** Alternate RPC URL from SDK defaults (allowed-fallback-standard: one primary + one alternate). */
function getNearRpcAlternateUrl(primaryRpcUrl = getNearRpcUrl()) {
  const alternate = config.FALLBACK_DEFAULTS?.NEAR_RPC_URL;
  if (!alternate || alternate === primaryRpcUrl) {
    return null;
  }
  return alternate;
}

function isRpcEndpointFailureStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Fetch with an AbortController deadline. On expiry, throws AbortError.
 * @param {string} url
 * @param {RequestInit} options
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithDeadline(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * One NEAR RPC POST: configured primary with deadline, then at most one alternate.
 * Logs the switch with cause fields (silent fallback forbidden).
 *
 * @param {object|string} jsonBody - JSON-RPC body object or already-stringified body
 * @param {{ operation?: string, requestId?: string, primaryRpcUrl?: string, fallbackRpcUrl?: string|null, timeoutMs?: number }} [options]
 * @returns {Promise<Response>}
 */
async function fetchNearRpc(jsonBody, options = {}) {
  const operation = options.operation || "near.rpc.fetch";
  const requestId = options.requestId || ulid();
  const primaryRpcUrl = options.primaryRpcUrl || getNearRpcUrl();
  const fallbackRpcUrl =
    options.fallbackRpcUrl !== undefined
      ? options.fallbackRpcUrl
      : getNearRpcAlternateUrl(primaryRpcUrl);
  const timeoutMs = options.timeoutMs || getNearRpcTimeoutMs();
  const body =
    typeof jsonBody === "string" ? jsonBody : JSON.stringify(jsonBody);
  const candidates = [...new Set([primaryRpcUrl, fallbackRpcUrl].filter(Boolean))];
  let lastError = null;

  for (let i = 0; i < candidates.length; i++) {
    const rpcUrl = candidates[i];
    const usingAlternate = i > 0;
    try {
      const response = await fetchWithDeadline(
        rpcUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body
        },
        timeoutMs
      );

      if (isRpcEndpointFailureStatus(response.status) && i < candidates.length - 1) {
        logger.warnWithContext("NEAR RPC primary endpoint failed; trying alternate", {
          component: "BlockchainService",
          operation,
          sourceId: "BlockchainService.fetchNearRpc",
          requestId,
          result: "source_error",
          resultText: `HTTP ${response.status} from ${rpcUrl}`,
          primaryRpcUrl,
          failedRpcUrl: rpcUrl,
          alternateRpcUrl: candidates[i + 1],
          statusCode: response.status
        });
        lastError = new Error(`NEAR RPC HTTP ${response.status} from ${rpcUrl}`);
        continue;
      }

      if (usingAlternate) {
        logger.warnWithContext("NEAR RPC using alternate endpoint", {
          component: "BlockchainService",
          operation,
          sourceId: "BlockchainService.fetchNearRpc",
          requestId,
          result: "success",
          resultText: `primary unavailable; using ${rpcUrl}`,
          primaryRpcUrl,
          selectedRpcUrl: rpcUrl
        });
      }

      return response;
    } catch (err) {
      const timedOut = err && err.name === "AbortError";
      const resultText = timedOut
        ? `deadline expired after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);

      if (i < candidates.length - 1) {
        logger.warnWithContext("NEAR RPC primary call failed; trying alternate", {
          component: "BlockchainService",
          operation,
          sourceId: "BlockchainService.fetchNearRpc",
          requestId,
          result: "source_error",
          resultText,
          primaryRpcUrl,
          failedRpcUrl: rpcUrl,
          alternateRpcUrl: candidates[i + 1],
          timedOut
        });
        lastError = err;
        continue;
      }

      logger.errorWithContext(
        "NEAR RPC call failed",
        {
          component: "BlockchainService",
          operation,
          sourceId: "BlockchainService.fetchNearRpc",
          requestId,
          result: "source_error",
          resultText,
          rpcUrl,
          timedOut
        },
        err instanceof Error ? err : null
      );

      if (timedOut) {
        throw new Error(`NEAR RPC timed out after ${timeoutMs}ms (${rpcUrl})`);
      }
      throw err;
    }
  }

  throw lastError || new Error("NEAR RPC call failed");
}

// Simple in-memory TTL cache for RPC results
// Single TTL setting for all RPC caches (in milliseconds)
// Default value is defined centrally in configsdk.FALLBACK_DEFAULTS
const NEAR_RPC_CACHE_TTL = parseInt(config.get("NEAR_RPC_CACHE_TTL"));

const _rpcCache = new Map();
function _cacheGet(key) {
  const entry = _rpcCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    _rpcCache.delete(key);
    return undefined;
  }
  return entry.value;
}
function _cacheSet(key, value, ttlMs) {
  const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : 0;
  _rpcCache.set(key, { value, expiresAt });
}

/** Coalesce concurrent NEAR block timestamp RPCs (same cache key). Avoids divergent "chain now" values in parallel login_server calls and intermittent RODIT_NOT_LIVE at validity boundaries. */
let _nearTimestampInflightPromise = null;
/**
 * Data models for RODiT Authentication
 * Copyright (c) 2026 Discernible IO. All rights reserved.
 */

/**
 * RODiT token class that represents a Resource Ownership and Digital Identity Token
 */
class RODiT {
  constructor() {
    this.token_id = "";
    this.owner_id = "";
    this.metadata = {
      openapijson_url: "",
      not_after: "",
      not_before: "",
      max_requests: "",
      maxrq_window: "",
      webhook_url: "",
      webhook_cidr: "",
      userselected_dn: "",
      allowed_cidr: "",
      allowed_iso3166list: "",
      jwt_duration: "",
      permissioned_routes: "",
      subjectuniqueidentifier_url: "",
      serviceprovider_id: "",
      serviceprovider_signature: "",
    };
  }
}

/**
 * A NEAR RPC query failed before a completed view result was available.
 * `status` is the HTTP status. `message` includes that status and the
 * provider text (including credit or quota notices). `creditFailure` is set
 * for HTTP 402 and for messages that say the provider is out of credits.
 *
 * A completed `rodit_token` view whose decoded value is JSON null is not this
 * error: that path returns an empty RODiT.
 */
class NearRpcError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number|null, providerMessage?: string, creditFailure?: boolean }} [details]
   */
  constructor(message, details = {}) {
    super(message);
    this.name = "NearRpcError";
    this.status = details.status == null ? null : details.status;
    this.providerMessage = details.providerMessage || "";
    this.creditFailure = details.creditFailure === true;
  }
}

function clipRpcText(value, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
}

function describeRpcError(errorField) {
  if (errorField == null) return "";
  if (typeof errorField === "string") return clipRpcText(errorField);
  if (typeof errorField === "object") {
    const message = errorField.message || errorField.name || "";
    const code = errorField.code != null ? ` (${errorField.code})` : "";
    let dataText = "";
    if (errorField.data != null) {
      dataText = typeof errorField.data === "string"
        ? errorField.data
        : JSON.stringify(errorField.data);
    }
    const combined = [message ? `${message}${code}` : "", dataText].filter(Boolean).join(": ");
    return clipRpcText(combined || JSON.stringify(errorField));
  }
  return clipRpcText(errorField);
}

function looksLikeCreditFailure(status, text) {
  if (status === 402) return true;
  return /credit|quota|payment required|insufficient (balance|funds)/i.test(text || "");
}

function nearRpcFailure(status, providerMessage) {
  const detail = providerMessage ? clipRpcText(providerMessage) : "";
  const message = detail
    ? `NEAR RPC call failed (HTTP ${status}): ${detail}`
    : `NEAR RPC call failed (HTTP ${status})`;
  return new NearRpcError(message, {
    status,
    providerMessage: detail,
    creditFailure: looksLikeCreditFailure(status, detail)
  });
}

async function readResponseErrorMessage(response) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch (_readError) {
    bodyText = "";
  }
  const trimmed = bodyText.trim();
  if (!trimmed) {
    return response.statusText ? clipRpcText(response.statusText) : "";
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && parsed.error) {
      const described = describeRpcError(parsed.error);
      if (described) return described;
    }
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return clipRpcText(parsed.message);
    }
  } catch (_parseError) {
    // Credit notices are often plain text rather than JSON-RPC.
  }
  return clipRpcText(trimmed);
}

/**
 * Payload class for NEP-413 standard
 */
class PayloadNEP413 {
  constructor(props) {
    this.tag = props.tag || 2147484061;
    this.message = props.message;
    if (props.nonce instanceof Uint8Array) {
      if (props.nonce.length !== 32) {
        throw new Error("Nonce must be exactly 32 bytes");
      }
      this.nonce = props.nonce;
    } else if (
      Array.isArray(props.nonce) ||
      (typeof props.nonce === "object" && props.nonce !== null)
    ) {
      const nonceArray = Array.isArray(props.nonce)
        ? props.nonce
        : Object.values(props.nonce);
      if (nonceArray.length !== 32) {
        throw new Error("Nonce must be exactly 32 bytes");
      }
      this.nonce = new Uint8Array(nonceArray);
    } else {
      throw new Error(
        "Invalid nonce format - must be Uint8Array or convertible to Uint8Array"
      );
    }
    this.recipient = props.recipient;
    this.callbackUrl = props.callbackUrl;
  }
}

/**
 * Schema for NEP-413 payload in Borsh format
 */
const PayloadNEP413Schema = {
  struct: {
    tag: "u32",
    message: "string",
    nonce: { array: { type: "u8", len: 32 } },
    recipient: "string",
    callbackUrl: { option: "string" },
  },
};

/**
 * Service for interacting with the blockchain network
 */

  async function nearorg_rpc_timestamp() {
    const rpcUrl = getNearRpcUrl();
    const cacheKey = `ts:${rpcUrl}`;
    const cached = _cacheGet(cacheKey);
    if (cached !== undefined) {
      const requestId = ulid();
      const baseContext = createLogContext(
        "BlockchainService",
        "nearorg_rpc_timestamp",
        {
          requestId,
          rpcUrl
        }
      );
      logger.debugWithContext("Cache hit for blockchain timestamp", baseContext);
      return cached;
    }

    if (!_nearTimestampInflightPromise) {
      _nearTimestampInflightPromise = nearorg_rpc_timestamp_fetchUncached(cacheKey, rpcUrl).finally(() => {
        _nearTimestampInflightPromise = null;
      });
    }

    return _nearTimestampInflightPromise;
  }

  async function nearorg_rpc_timestamp_fetchUncached(cacheKey, rpcUrl = getNearRpcUrl()) {
    const requestId = ulid();
    const startTime = Date.now();

    const baseContext = createLogContext(
      "BlockchainService",
      "nearorg_rpc_timestamp",
      {
        requestId,
        rpcUrl
      }
    );

    logger.debugWithContext("Fetching blockchain timestamp", baseContext);

    try {
      const jsonData = {
        jsonrpc: "2.0",
        id: "dontcare",
        method: "block",
        params: {
          finality: "final",
        },
      };

      const fetchStartTime = Date.now();
      const response = await fetchNearRpc(jsonData, {
        operation: "nearorg_rpc_timestamp",
        requestId,
        primaryRpcUrl: rpcUrl
      });
      const fetchDuration = Date.now() - fetchStartTime;

      logger.debugWithContext("RPC response received", {
        ...baseContext,
        statusCode: response.status,
        fetchDuration
      });

      if (!response.ok) {
        const duration = Date.now() - startTime;
        
        // Add metric for failed RPC calls
        logger.metric("near_rpc_calls", fetchDuration, {
          result: "http_error",
          status_code: response.status,
          method: "block",
        });
        
        logErrorWithMetrics(
          "HTTP error from blockchain RPC",
          {
            ...baseContext,
            operation: "nearorg_rpc_timestamp",
            sourceId: "BlockchainService.nearorg_rpc_timestamp",
            result: "source_error",
            resultText: `HTTP ${response.status}`,
            statusCode: response.status,
            statusText: response.statusText,
            duration
          },
          new Error(`HTTP error! status: ${response.status}`),
          "near_rpc_http_error",
          {
            result: "error",
            status_code: response.status,
            method: "block",
            duration
          }
        );

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const parseStartTime = Date.now();
      const parsedJson = await response.json();
      const parseDuration = Date.now() - parseStartTime;

      logger.debugWithContext("RPC response parsed", {
        ...baseContext,
        parseDuration
      });

      if (parsedJson.error) {
        const duration = Date.now() - startTime;
        
        // Add metric for RPC errors
        logger.metric("near_rpc_errors", 1, {
          error_code: parsedJson.error.code || "unknown",
          method: "block",
        });
        
        logErrorWithMetrics(
          "RPC error response",
          {
            ...baseContext,
            rpcError: parsedJson.error.message,
            rpcErrorCode: parsedJson.error.code,
            duration
          },
          new Error(`Error 017: ${parsedJson.error.message}`),
          "near_rpc_error_response",
          {
            result: "error",
            error_code: parsedJson.error.code || "unknown",
            method: "block",
            duration
          }
        );

        throw new Error(`Error 017: ${parsedJson.error.message}`);
      }

      const timestamp = parsedJson.result?.header?.timestamp;
      const totalDuration = Date.now() - startTime;

      if (timestamp === undefined || timestamp === null || timestamp === "") {
        const error = new Error("Missing blockchain timestamp in RPC response");
        logErrorWithMetrics(
          "RPC response missing timestamp",
          {
            ...baseContext,
            duration: totalDuration,
            fetchDuration,
            parseDuration,
          },
          error,
          "near_rpc_missing_timestamp",
          {
            result: "error",
            method: "block",
            duration: totalDuration,
          }
        );
        throw error;
      }

      logger.infoWithContext("Blockchain timestamp fetched successfully", {
        ...baseContext,
        duration: totalDuration,
        fetchDuration,
        parseDuration,
        timestamp: timestamp.toString()
      });

      // Add metric for successful RPC calls
      logger.metric("near_rpc_calls", totalDuration, {
        result: "success",
        method: "block",
      });
      // Store in cache using unified TTL setting
      const tsValue = timestamp.toString();
      _cacheSet(cacheKey, tsValue, NEAR_RPC_CACHE_TTL);
      return tsValue;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Add metrics for timestamp errors
      logger.metric("near_rpc_timestamp_errors", 1, {
        error_type: error.name || "Unknown",
      });

      logErrorWithMetrics(
        "Error fetching blockchain timestamp",
        {
          ...baseContext,
          duration,
          rpcUrl
        },
        error,
        "near_rpc_timestamp",
        {
          result: "error",
          error_type: error.name || "Unknown",
          duration
        }
      );

      throw error;
    }
  }

  /**
   * Fetches a RODiT token by ID from the NEAR blockchain.
   *
   * An empty RODiT (no token_id) is returned only when the view call completes
   * and the contract decodes to JSON null (token absent). HTTP failures,
   * JSON-RPC errors, credit exhaustion, WASM errors, and undecodable results
   * throw NearRpcError.
   *
   * @param {string} roditid - RODiT token ID to fetch
   * @returns {Promise<RODiT>} RODiT token object
   * @throws {NearRpcError} When the NEAR RPC call does not yield a completed view
   */
  async function nearorg_rpc_tokenfromroditid(roditid) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "BlockchainService",
      "nearorg_rpc_tokenfromroditid",
      {
        requestId,
        roditId: roditid,
        nearContractId: CONSTANTS.NEAR_CONTRACT_ID,
        nearRpcUrl: getNearRpcUrl()
      }
    );

    // Security check: Handle null, undefined, or invalid roditid
    // This is important for security tests that intentionally send invalid tokens
    if (!roditid) {
      logger.debugWithContext("Attempted to fetch RODiT with null/undefined ID", {
        ...baseContext,
        result: 'failure',
        reason: 'Null or undefined RODiT'
      });
      // Return an empty RODiT object instead of throwing an error
      // This allows the authentication flow to continue and properly reject the invalid token
      return new RODiT();
    }

    logger.infoWithContext("Fetching RODiT token by ID", {
      ...baseContext,
      result: 'call',
      reason: 'Fetch RODiT token by ID requested'
    }); // Function call log

    // Cache check
    const cacheKey = `rodit_by_id:${CONSTANTS.NEAR_CONTRACT_ID}:${roditid}`;
    const cachedRodit = _cacheGet(cacheKey);
    if (cachedRodit) {
      logger.debugWithContext("Cache hit for RODiT token by ID", {
        ...baseContext,
        cached: true
      });
      return cachedRodit;
    }

    try {
      const args = { token_id: roditid };
      const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");

      const json_data = {
        jsonrpc: "2.0",
        id: CONSTANTS.NEAR_CONTRACT_ID,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: CONSTANTS.NEAR_CONTRACT_ID,
          method_name: "rodit_token",
          args_base64: argsBase64,
        },
      };

      const fetchStartTime = Date.now();
      const response = await fetchNearRpc(json_data, {
        operation: "nearorg_rpc_tokenfromroditid",
        requestId
      });
      const fetchDuration = Date.now() - fetchStartTime;

      logger.debugWithContext("RPC response received", {
        ...baseContext,
        statusCode: response.status,
        fetchDuration
      });

      if (!response.ok) {
        const duration = Date.now() - startTime;
        const providerMessage = await readResponseErrorMessage(response);
        const httpError = nearRpcFailure(response.status, providerMessage);
        
        // Add metric for failed RPC calls
        logger.metric("near_rpc_calls", fetchDuration, {
          result: "failure",
          reason: httpError.message,
          status_code: response.status,
          method: "rodit_token",
          credit_failure: httpError.creditFailure ? "true" : "false",
        });
        
        logErrorWithMetrics(
          "HTTP error from blockchain RPC",
          {
            ...baseContext,
            statusCode: response.status,
            providerMessage: httpError.providerMessage,
            creditFailure: httpError.creditFailure,
            duration,
            result: 'failure',
            reason: httpError.message
          },
          httpError,
          "near_rpc_http_error",
          {
            result: "failure",
            reason: httpError.message,
            status_code: response.status,
            method: "rodit_token",
            duration
          }
        );

        throw httpError;
      }

      const parseStartTime = Date.now();
      const responseText = await response.text();
      let parsedJson;
      try {
        parsedJson = JSON.parse(responseText);
      } catch (error) {
        throw nearRpcFailure(
          response.status,
          `Failed to parse NEAR RPC response: ${error.message}`
        );
      }
      const parseDuration = Date.now() - parseStartTime;

      logger.debugWithContext("RPC response parsed", {
        ...baseContext,
        parseDuration,
        hasResult: !!parsedJson.result
      });

      if (parsedJson.error) {
        const duration = Date.now() - startTime;
        const rpcError = nearRpcFailure(
          response.status,
          describeRpcError(parsedJson.error)
        );

        logger.metric("near_rpc_calls", fetchDuration, {
          result: "failure",
          reason: rpcError.message,
          status_code: response.status,
          method: "rodit_token",
          credit_failure: rpcError.creditFailure ? "true" : "false",
        });

        logErrorWithMetrics(
          "JSON-RPC error from blockchain RPC",
          {
            ...baseContext,
            statusCode: response.status,
            rpcError: parsedJson.error,
            providerMessage: rpcError.providerMessage,
            creditFailure: rpcError.creditFailure,
            duration,
            result: 'failure',
            reason: rpcError.message
          },
          rpcError,
          "near_rpc_jsonrpc_error",
          {
            result: "failure",
            reason: rpcError.message,
            status_code: response.status,
            method: "rodit_token",
            duration
          }
        );

        throw rpcError;
      }

      if (parsedJson.result && parsedJson.result.error) {
        const duration = Date.now() - startTime;
        const wasmText = typeof parsedJson.result.error === "string"
          ? parsedJson.result.error
          : JSON.stringify(parsedJson.result.error);
        const wasmError = nearRpcFailure(response.status, `WASM execution error: ${wasmText}`);
        
        // Add metric for WASM errors
        logger.metric("near_rpc_wasm_errors", 1, {
          method: "rodit_token",
          rodit_id: roditid,
          result: 'failure',
          reason: wasmError.message
        });
        
        logErrorWithMetrics(
          "WASM execution error",
          {
            ...baseContext,
            wasmError: parsedJson.result.error,
            duration,
            result: 'failure',
            reason: wasmError.message
          },
          wasmError,
          "near_rpc_wasm_error",
          {
            method: "rodit_token",
            rodit_id: roditid,
            duration,
            result: 'failure',
            reason: wasmError.message
          }
        );

        throw wasmError;
      }

      const resultArray = parsedJson.result && parsedJson.result.result;
      if (!Array.isArray(resultArray)) {
        const duration = Date.now() - startTime;
        const formatError = nearRpcFailure(response.status, "Result is not an array");
        
        // Add metric for format errors
        logger.metric("near_rpc_format_errors", 1, {
          method: "rodit_token",
          rodit_id: roditid,
          error_type: "invalid_array",
          result: 'failure',
          reason: formatError.message
        });
        
        logErrorWithMetrics(
          "Invalid result format",
          {
            ...baseContext,
            resultType: typeof resultArray,
            duration,
            result: 'failure',
            reason: formatError.message
          },
          formatError,
          "near_rpc_format_error",
          {
            method: "rodit_token",
            rodit_id: roditid,
            error_type: "invalid_array",
            duration,
            result: 'failure',
            reason: formatError.message
          }
        );

        throw formatError;
      }

      const decodeStartTime = Date.now();
      const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
      let parsed;
      
      try {
        parsed = JSON.parse(resultString);
      } catch (error) {
        const parseError = nearRpcFailure(
          response.status,
          `Failed to parse RODiT data: ${error.message}`
        );
        logErrorWithMetrics(
          "Failed to parse RODiT data",
          {
            ...baseContext,
            error: error.message,
            result: 'failure',
            reason: parseError.message
          },
          parseError,
          "rodit_parse_error",
          {
            error_type: error.name || "Unknown",
            rodit_id: roditid,
            result: 'failure',
            reason: parseError.message
          }
        );
        throw parseError;
      }
      
      const decodeDuration = Date.now() - decodeStartTime;

      logger.debugWithContext("RODiT data decoded", {
        ...baseContext,
        decodeDuration,
        isNull: parsed === null,
        hasTokenId: parsed && !!parsed.token_id,
        parsedType: typeof parsed
      }); // Context-only debug log, does not expose secrets

      const rodit = new RODiT();
      
      // Handle Option<JsonToken> return type - null means token not found
      if (parsed === null) {
        logger.warnWithContext("RODiT token not found on blockchain", {
          ...baseContext,
          targetTokenId: roditid,
          result: 'not_found',
          reason: 'RODiT token does not exist on blockchain'
        });
        // Return empty RODiT object - this will cause authentication to fail properly
        return rodit;
      }
      
      if (parsed && typeof parsed === 'object') {
        // Debug logging for owner_id issue investigation
        logger.debugWithContext("RAW RODiT data from blockchain", {
          ...baseContext,
          parsedData: parsed,
          parsedOwnerIdType: typeof parsed.owner_id,
          parsedKeys: Object.keys(parsed),
          hasMetadata: !!parsed.metadata,
          metadataServiceProviderId: parsed.metadata?.serviceprovider_id
        });
        
        Object.assign(rodit, parsed);
        
        // Debug logging after assignment
        logger.debugWithContext("RODiT object after assignment", {
          ...baseContext,
          roditOwnerId: rodit.owner_id,
          roditOwnerIdType: typeof rodit.owner_id,
          roditTokenId: rodit.token_id,
          roditMetadata: rodit.metadata
        });
      } else {
        const formatError = nearRpcFailure(
          response.status,
          "Invalid RODiT data format from blockchain"
        );
        logger.warnWithContext("Invalid RODiT data format", {
          ...baseContext,
          parsedType: typeof parsed,
          parsedValue: parsed,
          result: 'failure',
          reason: formatError.message
        });
        throw formatError;
      }

      const totalDuration = Date.now() - startTime;
      const hasValidData = !!rodit.token_id && !!rodit.owner_id;

      logger.infoWithContext("RODiT token fetched", {
        ...baseContext,
        duration: totalDuration,
        retrieved: hasValidData,
        fetchDuration,
        parseDuration,
        decodeDuration,
        result: 'success',
        reason: hasValidData ? 'RODiT token successfully fetched' : 'RODiT token fetch returned empty or incomplete data'
      });

      // Add metrics for successful RPC calls
      logger.metric("near_rpc_calls", totalDuration, {
        result: "success",
        reason: hasValidData ? 'RODiT token successfully fetched' : 'RODiT token fetch returned empty or incomplete data',
        method: "rodit_token",
        data_found: hasValidData ? "true" : "false"
      });
      // Cache successful lookups only
      if (hasValidData) {
        _cacheSet(cacheKey, rodit, NEAR_RPC_CACHE_TTL);
      }
      return rodit;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Add metrics for token fetch errors
      logger.metric("near_rpc_token_errors", 1, {
        error_type: error.name || "Unknown",
        rodit_id: roditid,
        result: 'failure',
        reason: `Failed to fetch RODiT token: ${error.message}`
      });
      
      logErrorWithMetrics(
        "Failed to fetch RODiT token",
        {
          ...baseContext,
          duration,
          result: 'failure',
          reason: `Failed to fetch RODiT token: ${error.message}`
        },
        error,
        "near_rpc_token_fetch",
        {
          result: 'failure',
          reason: `Failed to fetch RODiT token: ${error.message}`,
          error_type: error.name || "Unknown",
          rodit_id: roditid,
          duration
        }
      );

      throw error;
    }
  }

  /**
   * Checks account state on the blockchain
   * 
   * @param {string} accountId - Account ID to check
   * @returns {Promise<boolean>} Whether the account exists
   */
  async function nearorg_rpc_state(accountId) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "BlockchainService",
      "nearorg_rpc_state",
      {
        requestId,
        accountId,
        contractId: CONSTANTS.NEAR_CONTRACT_ID
      }
    );

    logger.infoWithContext("Checking account state on blockchain", {
      ...baseContext,
      result: 'call',
      reason: 'Account state check requested'
    }); // Function call log

    // Cache check
    const cacheKey = `state:${accountId}`;
    const cachedState = _cacheGet(cacheKey);
    if (cachedState !== undefined) {
      logger.debugWithContext("Cache hit for account state", {
        ...baseContext,
        cachedState
      });
      return cachedState;
    }

    try {
      const jsonData = {
        jsonrpc: "2.0",
        id: CONSTANTS.NEAR_CONTRACT_ID,
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: accountId
        }
      };

      const response = await fetchNearRpc(jsonData, {
        operation: "nearorg_rpc_state",
        requestId
      });

      const responseText = await response.json();

      if (JSON.stringify(responseText).includes("does not exist while viewing")) {
        const duration = Date.now() - startTime;

        logger.warnWithContext("Account does not exist in blockchain", {
          ...baseContext,
          operation: "nearorg_rpc_state",
          sourceId: "BlockchainService.nearorg_rpc_state",
          duration,
          needsFunding: true,
          result: "failure",
          resultText: "Account does not exist in blockchain",
          reason: "Account does not exist in blockchain"
        });

        // Emit metrics for dashboards
        logger.metric("account_state_check_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          accountExists: false,
          result: 'failure',
          reason: 'Account does not exist in blockchain'
        });
        logger.metric("non_existent_accounts_total", 1, {
          component: "BlockchainService",
          accountId,
          result: 'failure',
          reason: 'Account does not exist in blockchain'
        });
        _cacheSet(cacheKey, false, NEAR_RPC_CACHE_TTL);
        return false;
      }

      // If account exists
      const duration = Date.now() - startTime;
      logger.infoWithContext("Account exists in blockchain", {
        ...baseContext,
        duration,
        result: 'success',
        reason: 'Account exists in blockchain'
      });
      logger.metric("account_state_check_duration_ms", duration, {
        component: "BlockchainService",
        success: true,
        accountExists: true,
        result: 'success',
        reason: 'Account exists in blockchain'
      });
      _cacheSet(cacheKey, true, NEAR_RPC_CACHE_TTL);
      return true;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.metric("account_state_check_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        accountExists: false,
        result: 'failure',
        reason: error.message || 'Unknown error during account state check'
      });
      logErrorWithMetrics(
        "Error checking account state on blockchain",
        {
          ...baseContext,
          duration,
          result: 'failure',
          reason: error.message || 'Unknown error during account state check'
        },
        error,
        "account_state_check",
        {
          result: 'failure',
          reason: error.message || 'Unknown error during account state check',
          error_type: error.constructor?.name || 'Error',
          duration
        }
      );
      return false;
    }
  }

  /**
   * Fetches RODiT tokens for an account
   * 
   * @param {string} account_id - Account ID to fetch tokens for
   * @returns {Promise<RODiT>} First RODiT token for the account
   */
  async function nearorg_rpc_tokensfromaccountid(account_id) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "BlockchainService",
      "nearorg_rpc_tokensfromaccountid",
      {
        requestId,
        accountId: account_id,
        contractId: CONSTANTS.NEAR_CONTRACT_ID
      }
    );

    logger.infoWithContext("Fetching RODiT tokens for account", {
      ...baseContext,
      result: 'call',
      reason: 'Fetch RODiT tokens for account requested'
    }); // Function call log

    // Cache check
    const cacheKey = `tokens_by_account:${CONSTANTS.NEAR_CONTRACT_ID}:${account_id}`;
    const cachedTokens = _cacheGet(cacheKey);
    if (cachedTokens) {
      logger.debugWithContext("Cache hit for RODiT tokens by account", {
        ...baseContext,
        cached: true,
        firstTokenId: cachedTokens.token_id
      });
      return cachedTokens;
    }

    try {
      const args = JSON.stringify({
        account_id: account_id,
        from_index: "0",  // String format for U128
        limit: 1          // Only retrieve the first token
      });

      const jsonData = {
        jsonrpc: "2.0",
        id: CONSTANTS.NEAR_CONTRACT_ID,
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: CONSTANTS.NEAR_CONTRACT_ID,
          method_name: "rodit_tokens_for_owner",
          args_base64: Buffer.from(args).toString("base64"),
        },
      };

      logger.debugWithContext("Sending RPC request for account tokens", {
        ...baseContext,
        rpcMethod: "rodit_tokens_for_owner"
      });

      const response = await fetchNearRpc(jsonData, {
        operation: "nearorg_rpc_tokensfromaccountid",
        requestId
      });

      if (!response.ok) {
        const duration = Date.now() - startTime;
        
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          result: 'failure',
          reason: `HTTP error from blockchain RPC: status ${response.status}`
        });
        logger.metric("blockchain_rpc_errors_total", 1, {
          component: "BlockchainService",
          method: "tokens_from_account",
          result: 'failure',
          reason: `HTTP error from blockchain RPC: status ${response.status}`
        });
        
        logErrorWithMetrics(
          "HTTP error from blockchain RPC",
          {
            ...baseContext,
            operation: "nearorg_rpc_tokensfromaccountid",
            sourceId: "BlockchainService.nearorg_rpc_tokensfromaccountid",
            result: "source_error",
            resultText: `HTTP ${response.status}`,
            statusCode: response.status,
            duration,
            result: 'failure',
            reason: `HTTP error from blockchain RPC: status ${response.status}`
          },
          new Error(`HTTP error! status: ${response.status}`),
          "account_tokens_fetch",
          {
            result: 'failure',
            reason: `HTTP error from blockchain RPC: status ${response.status}`,
            error_type: "HTTP_ERROR",
            status_code: response.status,
            duration
          }
        );

        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const responseText = await response.text();
      const parsedJson = JSON.parse(responseText);

      // Check for RPC-level errors
      if (parsedJson.error) {
        const duration = Date.now() - startTime;
        
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          result: 'failure',
          reason: `RPC error: ${parsedJson.error.message || parsedJson.error}`
        });
        logger.metric("blockchain_rpc_errors_total", 1, {
          component: "BlockchainService",
          method: "tokens_from_account",
          result: 'failure',
          reason: `RPC error: ${parsedJson.error.message || parsedJson.error}`
        });
        
        logErrorWithMetrics(
          "RPC error response",
          {
            ...baseContext,
            duration,
            rpcError: parsedJson.error,
            result: 'failure',
            reason: `RPC error: ${parsedJson.error.message || parsedJson.error}`
          },
          new Error(`RPC error: ${parsedJson.error.message || parsedJson.error}`),
          "account_tokens_fetch",
          {
            result: 'failure',
            reason: `RPC error: ${parsedJson.error.message || parsedJson.error}`,
            error_type: "RPC_ERROR",
            duration
          }
        );

        throw new Error(`RPC error: ${parsedJson.error.message || parsedJson.error}`);
      }

      // Check if result exists before accessing nested properties
      if (!parsedJson.result) {
        const duration = Date.now() - startTime;
        
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          result: 'failure',
          reason: 'Missing result field in RPC response'
        });
        logger.metric("blockchain_rpc_errors_total", 1, {
          component: "BlockchainService",
          method: "tokens_from_account",
          result: 'failure',
          reason: 'Missing result field in RPC response'
        });
        
        logErrorWithMetrics(
          "Invalid RPC response structure",
          {
            ...baseContext,
            duration,
            responseKeys: Object.keys(parsedJson),
            result: 'failure',
            reason: 'Missing result field in RPC response'
          },
          new Error("Missing result field in RPC response"),
          "account_tokens_fetch",
          {
            result: 'failure',
            reason: 'Missing result field in RPC response',
            error_type: "INVALID_RESPONSE",
            duration
          }
        );

        throw new Error("Missing result field in RPC response");
      }

      if (parsedJson.result && parsedJson.result.error) {
        const duration = Date.now() - startTime;

        // Emit metrics for dashboards
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          result: 'failure',
          reason: `WASM execution error: ${parsedJson.result.error}`
        });
        logger.metric("blockchain_rpc_errors_total", 1, {
          component: "BlockchainService",
          method: "tokens_from_account",
          result: 'failure',
          reason: `WASM execution error: ${parsedJson.result.error}`
        });
        
        logErrorWithMetrics(
          "WASM execution error",
          {
            ...baseContext,
            duration,
            wasmError: parsedJson.result.error,
            result: 'failure',
            reason: `WASM execution error: ${parsedJson.result.error}`
          },
          new Error(`Smart contract execution failed: ${parsedJson.result.error}`),
          "account_tokens_fetch",
          {
            result: 'failure',
            reason: `WASM execution error: ${parsedJson.result.error}`,
            error_type: "WASM_ERROR",
            duration
          }
        );

        throw new Error(
          `Smart contract execution failed: ${parsedJson.result.error}`
        );
      }

      // Safe access to nested result property
      const resultArray = parsedJson.result?.result;
      if (!Array.isArray(resultArray)) {
        const duration = Date.now() - startTime;

        // Emit metrics for dashboards
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: false,
          error: "INVALID_RESULT_FORMAT",
        });
        logger.metric("blockchain_rpc_errors_total", 1, {
          component: "BlockchainService",
          method: "tokens_from_account",
          error: "INVALID_RESULT_FORMAT",
        });
        
        logErrorWithMetrics(
          "Invalid result format from blockchain",
          {
            ...baseContext,
            duration,
            resultType: typeof resultArray
          },
          new Error("Result is not an array"),
          "account_tokens_fetch",
          {
            result: "error",
            error_type: "INVALID_RESULT_FORMAT",
            duration
          }
        );

        throw new Error("Result is not an array");
      }

      const resultString = new TextDecoder().decode(new Uint8Array(resultArray));
      const resultStruct = JSON.parse(resultString);

      if (!Array.isArray(resultStruct) || resultStruct.length === 0) {
        const duration = Date.now() - startTime;

        logger.warnWithContext("No RODiT instances found for account", {
          ...baseContext,
          duration,
          tokenCount: 0
        });

        // Emit metrics for dashboards
        logger.metric("account_tokens_fetch_duration_ms", duration, {
          component: "BlockchainService",
          success: true,
          tokenCount: 0,
        });
        logger.metric("empty_account_tokens_total", 1, {
          component: "BlockchainService",
          accountId: account_id,
        });

        const emptyRodit = new RODiT();
        return emptyRodit;
      }

      const rodit = new RODiT();
      Object.assign(rodit, resultStruct[0]);

      const duration = Date.now() - startTime;
      logger.debugWithContext("Successfully retrieved RODiT tokens", {
        ...baseContext,
        duration,
        tokenCount: resultStruct.length,
        firstTokenId: rodit.token_id
      });

      // Emit metrics for dashboards
      logger.metric("account_tokens_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: true,
        tokenCount: resultStruct.length,
      });
      // Cache successful lookups
      _cacheSet(cacheKey, rodit, NEAR_RPC_CACHE_TTL);
      return rodit;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Emit metrics for dashboards
      logger.metric("account_tokens_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        result: 'failure',
        reason: `Failed to fetch RODiT tokens: ${error.message}`
      });
      logger.metric("blockchain_rpc_errors_total", 1, {
        component: "BlockchainService",
        method: "tokens_from_account",
        result: 'failure',
        reason: `Failed to fetch RODiT tokens: ${error.message}`
      });
      
      logErrorWithMetrics(
        "Failed to fetch RODiT tokens",
        {
          ...baseContext,
          duration,
          result: 'failure',
          reason: `Failed to fetch RODiT tokens: ${error.message}`
        },
        error,
        "account_tokens_fetch",
        {
          result: 'failure',
          reason: `Failed to fetch RODiT tokens: ${error.message}`,
          error_type: error.constructor.name,
          duration
        }
      );

      throw error;
    }
  }

  /**
   * Fetches a public key in bytes format for an account
   * 
   * @param {string} accountId - Account ID
   * @returns {Promise<Uint8Array>} Public key bytes
   */
  async function nearorg_rpc_fetchpublickeybytes(accountId) {
    const requestId = ulid();
    const startTime = Date.now();
    
    const baseContext = createLogContext(
      "BlockchainService",
      "nearorg_rpc_fetchpublickeybytes",
      {
        requestId,
        accountId
      }
    );

    logger.debugWithContext("Fetching public key bytes", baseContext);

    try {
      // Cache check
      const cacheKey = `pubkey_bytes:${accountId}`;
      const cached = _cacheGet(cacheKey);
      if (cached) {
        logger.debugWithContext("Cache hit for public key bytes", {
          ...baseContext,
          keyLength: cached.length
        });
        return cached;
      }
      const isImplicitAccount = /^[0-9a-f]{64}$/.test(accountId);

      if (isImplicitAccount) {
        logger.debugWithContext("Account is implicit, using direct hex encoding", baseContext);

        const result = new Uint8Array(Buffer.from(accountId, "hex"));

        const duration = Date.now() - startTime;
        logger.debugWithContext(
          "Successfully retrieved public key bytes from implicit account",
          {
            ...baseContext,
            duration,
            keyLength: result.length
          }
        );

        // Emit metrics for dashboards
        logger.metric("public_key_fetch_duration_ms", duration, {
          method: "direct_hex",
          component: "BlockchainService",
          success: true,
        });
        // Cache result
        _cacheSet(cacheKey, result, NEAR_RPC_CACHE_TTL);
        return result;
      }

      logger.debugWithContext("Account is named, fetching RODiT token", baseContext);

      const rodit = await nearorg_rpc_tokensfromaccountid(accountId);

      if (!rodit || !rodit.owner_id) {
        const duration = Date.now() - startTime;
        
        // Emit metrics for dashboards
        logger.metric("public_key_fetch_duration_ms", duration, {
          method: "rodit_lookup",
          component: "BlockchainService",
          success: false,
          error: "NO_VALID_RODIT",
        });
        logger.metric("public_key_fetch_errors_total", 1, {
          method: "rodit_lookup",
          component: "BlockchainService",
          error: "NO_VALID_RODIT",
        });
        
        logErrorWithMetrics(
          "No valid RODiT found for account",
          {
            ...baseContext,
            duration,
            error: "NO_VALID_RODIT"
          },
          new Error(`No valid RODiT found for account: ${accountId}`),
          "public_key_fetch",
          {
            result: "error",
            error_type: "NO_VALID_RODIT",
            method: "rodit_lookup",
            duration
          }
        );

        throw new Error(`No valid RODiT found for account: ${accountId}`);
      }

      const result = new Uint8Array(Buffer.from(rodit.owner_id, "hex"));

      const duration = Date.now() - startTime;
      logger.debugWithContext("Successfully retrieved public key bytes from RODiT", {
        ...baseContext,
        duration,
        keyLength: result.length
      });

      // Emit metrics for dashboards
      logger.metric("public_key_fetch_duration_ms", duration, {
        method: "rodit_lookup",
        component: "BlockchainService",
        success: true,
      });
      // Cache result using unified TTL setting
      _cacheSet(cacheKey, result, NEAR_RPC_CACHE_TTL);
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Emit metrics for dashboards
      logger.metric("public_key_fetch_duration_ms", duration, {
        component: "BlockchainService",
        success: false,
        error: error.constructor.name,
      });
      logger.metric("public_key_fetch_errors_total", 1, {
        component: "BlockchainService",
        error: error.constructor.name,
      });
      
      logErrorWithMetrics(
        "Failed to fetch public key bytes",
        {
          ...baseContext,
          duration
        },
        error,
        "public_key_fetch",
        {
          result: "error",
          error_type: error.constructor.name,
          duration
        }
      );

      throw new Error(`Error retrieving public key: ${error.message}`);
    }
  }

/**
 * Fetches list of access keys for an account
 * @param {string} accountId
 */
async function nearorg_rpc_accesskeys(accountId) {
  const requestId = ulid();
  const startTime = Date.now();
  const baseContext = createLogContext("BlockchainService","nearorg_rpc_accesskeys",{requestId,accountId});
  logger.debugWithContext("Fetching access keys", baseContext);
  // Cache check
  const cacheKey = `accesskeys:${accountId}`;
  const cached = _cacheGet(cacheKey);
  if (cached !== undefined) {
    logger.debugWithContext("Cache hit for access keys", { ...baseContext });
    return cached;
  }
  const json_data = {
    jsonrpc:"2.0", id:CONSTANTS.NEAR_CONTRACT_ID, method:"query", params:{request_type:"view_access_key_list", finality:"final", account_id:accountId}
  };
  const response = await fetchNearRpc(json_data, {
    operation: "nearorg_rpc_accesskeys",
    requestId
  });
  const duration = Date.now() - startTime;
  if(!response.ok){
    logger.warnWithContext("NEAR RPC access-keys HTTP error", {
      ...baseContext,
      operation: "nearorg_rpc_accesskeys",
      sourceId: "BlockchainService.nearorg_rpc_accesskeys",
      result: "source_error",
      resultText: `HTTP ${response.status}`,
      statusCode: response.status
    });
    logger.metric("near_rpc_calls", duration,{result:"failure",method:"view_access_key_list",status_code:response.status});
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = await response.json();
  logger.metric("near_rpc_calls", duration,{result:"success",method:"view_access_key_list"});
  // Cache successful result
  _cacheSet(cacheKey, parsed.result, NEAR_RPC_CACHE_TTL);
  return parsed.result;
}

/**
 * Fetches owner (account ID) of a RODiT token
 * @param {string} token_id
 */
async function nearorg_rpc_rodit_owner(token_id){
  const requestId = ulid();
  const startTime = Date.now();
  const baseContext = createLogContext("BlockchainService","nearorg_rpc_rodit_owner",{requestId,token_id});
  logger.debugWithContext("Fetching RODiT owner", baseContext);
  // Cache check
  const cacheKey = `rodit_owner:${token_id}`;
  const cached = _cacheGet(cacheKey);
  if (cached !== undefined) {
    logger.debugWithContext("Cache hit for RODiT owner", { ...baseContext });
    return cached;
  }
  const args = { token_id };
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const json_data = {jsonrpc:"2.0", id:CONSTANTS.NEAR_CONTRACT_ID, method:"query", params:{request_type:"call_function", finality:"final", account_id:CONSTANTS.NEAR_CONTRACT_ID, method_name:"rodit_token_owner", args_base64:argsBase64 }};
  const response = await fetchNearRpc(json_data, {
    operation: "nearorg_rpc_rodit_owner",
    requestId
  });
  const duration = Date.now()-startTime;
  if(!response.ok){
    logger.warnWithContext("NEAR RPC rodit-owner HTTP error", {
      ...baseContext,
      operation: "nearorg_rpc_rodit_owner",
      sourceId: "BlockchainService.nearorg_rpc_rodit_owner",
      result: "source_error",
      resultText: `HTTP ${response.status}`,
      statusCode: response.status
    });
    logger.metric("near_rpc_calls",duration,{result:"failure",method:"rodit_token_owner",status_code:response.status});
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = await response.json();
  logger.metric("near_rpc_calls",duration,{result:"success",method:"rodit_token_owner"});
  if(parsed.result && parsed.result.result){ const buf = Buffer.from(parsed.result.result,"base64"); const value = JSON.parse(new TextDecoder().decode(buf)); _cacheSet(cacheKey, value, NEAR_RPC_CACHE_TTL); return value; }
  return null;
}

/**
 * Retrieves a nonce for a RODiT token from the agent-auth contract
 * @param {string} token_id
 * @returns {Promise<string>} nonce
 */
async function nearorg_rpc_getnonce(token_id) {
  const requestId = ulid();
  const startTime = Date.now();
  const baseContext = createLogContext("BlockchainService","nearorg_rpc_getnonce",{requestId,token_id});
  const args = { token_id };
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const json_data = {jsonrpc:"2.0", id:CONSTANTS.NEAR_CONTRACT_ID, method:"query", params:{request_type:"call_function", finality:"final", account_id:CONSTANTS.NEAR_CONTRACT_ID, method_name:"get_nonce", args_base64:argsBase64 }};
  const response = await fetchNearRpc(json_data, {
    operation: "nearorg_rpc_getnonce",
    requestId
  });
  const duration = Date.now()-startTime;
  if(!response.ok){
    logger.warnWithContext("NEAR RPC get-nonce HTTP error", {
      ...baseContext,
      operation: "nearorg_rpc_getnonce",
      sourceId: "BlockchainService.nearorg_rpc_getnonce",
      result: "source_error",
      resultText: `HTTP ${response.status}`,
      statusCode: response.status
    });
    logger.metric("near_rpc_calls", duration,{result:"failure",method:"get_nonce",status_code:response.status});
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = await response.json();
  logger.metric("near_rpc_calls", duration,{result:"success",method:"get_nonce"});
  if(parsed.result && parsed.result.result){ return Buffer.from(parsed.result.result,"base64").toString(); }
  return null;
}

/**
 * Verifies a signature for RODiT Authentication
 * @param {string} token_id
 * @param {string} nonce
 * @param {string} sig - base58 or hex signature
 * @returns {Promise<boolean>} verification result
 */
async function nearorg_rpc_verifysignature(token_id, nonce, sig) {
  const requestId = ulid();
  const startTime = Date.now();
  const baseContext = createLogContext("BlockchainService","nearorg_rpc_verifysignature",{requestId,token_id});
  const args = { token_id, nonce, sig };
  const argsBase64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const json_data = {jsonrpc:"2.0", id:CONSTANTS.NEAR_CONTRACT_ID, method:"query", params:{request_type:"call_function", finality:"final", account_id:CONSTANTS.NEAR_CONTRACT_ID, method_name:"verify_signature", args_base64:argsBase64 }};
  const response = await fetchNearRpc(json_data, {
    operation: "nearorg_rpc_verifysignature",
    requestId
  });
  const duration = Date.now()-startTime;
  if(!response.ok){
    logger.warnWithContext("NEAR RPC verify-signature HTTP error", {
      ...baseContext,
      operation: "nearorg_rpc_verifysignature",
      sourceId: "BlockchainService.nearorg_rpc_verifysignature",
      result: "source_error",
      resultText: `HTTP ${response.status}`,
      statusCode: response.status
    });
    logger.metric("near_rpc_calls", duration,{result:"failure",method:"verify_signature",status_code:response.status});
    throw new Error(`HTTP ${response.status}`);
  }
  const parsed = await response.json();
  logger.metric("near_rpc_calls", duration,{result:"success",method:"verify_signature"});
  if(parsed.result && parsed.result.result){ return Buffer.from(parsed.result.result,"base64").toString() === 'true'; }
  return false;
}

/**
 * Health check for NEAR RPC endpoint
 * Tests connectivity and rate limits before accepting traffic
 * @param {string} rpcUrl - The RPC URL to check (defaults to configured URL)
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - True if healthy
 */
async function healthCheckRPC(rpcUrl = getNearRpcUrl(), timeout = getNearRpcTimeoutMs()) {
  const requestId = ulid();
  const timeoutMs = Number(timeout) > 0 ? Number(timeout) : getNearRpcTimeoutMs();
  const baseContext = createLogContext("BlockchainService", "healthCheckRPC", {
    requestId,
    rpcUrl,
    operation: "healthCheckRPC",
    sourceId: "BlockchainService.healthCheckRPC"
  });

  logger.infoWithContext("Checking NEAR RPC health", baseContext);

  try {
    const startTime = Date.now();
    // Probe a single explicit URL — no nested alternate (resolveHealthyNearRpcUrl iterates).
    const response = await fetchWithDeadline(
      rpcUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "health-check",
          method: "status",
          params: []
        })
      },
      timeoutMs
    );
    const duration = Date.now() - startTime;

    if (response.status === 429) {
      logger.errorWithContext("RPC endpoint is already rate-limited", {
        ...baseContext,
        result: "source_error",
        resultText: "HTTP 429 rate limited",
        statusCode: 429
      });
      throw new Error("NEAR RPC endpoint is rate-limited (429). Use a dedicated provider.");
    }

    if (!response.ok) {
      logger.errorWithContext("RPC health check failed", {
        ...baseContext,
        result: "source_error",
        resultText: `HTTP ${response.status}`,
        statusCode: response.status,
        statusText: response.statusText
      });
      throw new Error(`RPC health check failed: ${response.status}`);
    }

    const data = await response.json();

    logger.infoWithContext("NEAR RPC is healthy", {
      ...baseContext,
      operation: "healthCheckRPC",
      result: "success",
      duration,
      chainId: data.result?.chain_id,
      syncStatus: data.result?.sync_info?.syncing
    });

    if (duration > 2000) {
      logger.warnWithContext("RPC response is slow", {
        ...baseContext,
        result: "success",
        resultText: `slow response ${duration}ms`,
        duration,
        threshold: 2000
      });
    }

    return true;
  } catch (err) {
    if (err && err.name === "AbortError") {
      logger.errorWithContext("RPC health check timed out", {
        ...baseContext,
        result: "source_error",
        resultText: `deadline expired after ${timeoutMs}ms`,
        timedOut: true
      });
      throw new Error(`RPC health check timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

/**
 * Resolve a healthy NEAR RPC URL by probing configured primary first, then SDK default fallback.
 * Throws when no candidate is healthy.
 */
async function resolveHealthyNearRpcUrl(options = {}) {
  const primaryRpcUrl = options.primaryRpcUrl || config.get("NEAR_RPC_URL");
  const fallbackRpcUrl =
    options.fallbackRpcUrl !== undefined
      ? options.fallbackRpcUrl
      : getNearRpcAlternateUrl(primaryRpcUrl);
  const timeout = Number(options.timeout || getNearRpcTimeoutMs());
  const candidates = [...new Set([primaryRpcUrl, fallbackRpcUrl].filter(Boolean))];
  const failures = [];
  const requestId = ulid();

  for (const rpcUrl of candidates) {
    try {
      await healthCheckRPC(rpcUrl, timeout);
      if (rpcUrl !== primaryRpcUrl) {
        logger.warnWithContext("Primary NEAR RPC unavailable; using SDK default fallback RPC", {
          component: "BlockchainService",
          operation: "resolveHealthyNearRpcUrl",
          sourceId: "BlockchainService.resolveHealthyNearRpcUrl",
          requestId,
          result: "success",
          resultText: `primary unavailable; using ${rpcUrl}`,
          primaryRpcUrl,
          selectedRpcUrl: rpcUrl
        });
      }
      return rpcUrl;
    } catch (err) {
      const resultText = err instanceof Error ? err.message : String(err);
      failures.push({ rpcUrl, error: resultText });
      logger.warnWithContext("NEAR RPC candidate failed health check", {
        component: "BlockchainService",
        operation: "resolveHealthyNearRpcUrl",
        sourceId: "BlockchainService.resolveHealthyNearRpcUrl",
        requestId,
        result: "source_error",
        resultText,
        rpcUrl
      });
    }
  }

  const details = failures.map((f) => `${f.rpcUrl} -> ${f.error}`).join("; ");
  throw new Error(`No healthy NEAR RPC endpoint available (${details})`);
}

/**
 * NEAR RPC fetch with deadline and one alternate (allowed-fallback-standard).
 * Retained export name for callers; no multi-retry loop.
 *
 * @param {string} url - Primary RPC URL
 * @param {RequestInit} options - Fetch options (body used for the RPC POST)
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}) {
  return fetchNearRpc(options.body ?? {}, {
    operation: "fetchWithRetry",
    primaryRpcUrl: url
  });
}

module.exports = {
    RODiT,
    NearRpcError,
    PayloadNEP413,
    PayloadNEP413Schema,
    CONSTANTS,
    nearorg_rpc_timestamp,
    nearorg_rpc_tokenfromroditid,
    nearorg_rpc_state,
    nearorg_rpc_tokensfromaccountid,
    nearorg_rpc_fetchpublickeybytes,
    nearorg_rpc_accesskeys,
    nearorg_rpc_rodit_owner,
    nearorg_rpc_getnonce,
    nearorg_rpc_verifysignature,
    healthCheckRPC,
    resolveHealthyNearRpcUrl,
    fetchNearRpc,
    fetchWithDeadline,
    fetchWithRetry,
    getNearRpcTimeoutMs,
    getNearRpcAlternateUrl
};