const https = require("https");

/**
 * Perform a lightweight TLS connectivity check against the provided API endpoint.
 * Primarily detects DNS/network issues and TLS handshake failures before running
 * expensive integration tests.
 *
 * @param {string} apiEndpoint - Base API endpoint (e.g. https://api.identyclaw.com)
 * @param {Object} [options]
 * @param {string} [options.method="HEAD"] - HTTP method to use for the probe
 * @param {number} [options.timeoutMs=5000] - Request timeout in milliseconds
 * @returns {Promise<{ok: boolean, statusCode?: number, error?: Error, reason?: string}>}
 */
async function verifyTlsConnectivity(apiEndpoint, options = {}) {
  if (!apiEndpoint) {
    return { ok: false, reason: "missing_endpoint" };
  }

  const { method = "HEAD", timeoutMs = 5000 } = options;

  let parsedUrl;
  try {
    parsedUrl = new URL(apiEndpoint);
  } catch (error) {
    return { ok: false, reason: "invalid_url", error };
  }

  const requestOptions = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port || 443,
    method,
    path:
      parsedUrl.pathname && parsedUrl.pathname !== "/"
        ? parsedUrl.pathname
        : "/",
    timeout: timeoutMs,
  };

  return new Promise((resolve) => {
    const req = https.request(requestOptions, (res) => {
      res.resume();
      resolve({ ok: true, statusCode: res.statusCode });
    });

    req.on("timeout", () => {
      req.destroy(new Error("TLS connection timeout"));
    });

    req.on("error", (error) => {
      resolve({ ok: false, error });
    });

    req.end();
  });
}

module.exports = {
  verifyTlsConnectivity,
};
