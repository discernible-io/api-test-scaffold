/**
 * Policies Public Routes
 *
 * Serves policy documents at .well-known paths for discoverability.
 * These are public endpoints requiring no authentication.
 *
 * Endpoints:
 * - GET /.well-known/terms-of-service    - Terms of Service (Markdown)
 * - GET /.well-known/privacy-policy      - Privacy Policy (Markdown)
 * - GET /.well-known/data-retention      - Data Retention Policy (Markdown)
 */

const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { ulid } = require("ulid");
const { logger, errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;

const POLICIES_DIR = path.join(__dirname, "../../public/policies");

/**
 * Helper to serve a markdown policy file
 */
function servePolicyFile(filename, res, requestId, context) {
  const filePath = path.join(POLICIES_DIR, filename);

  try {
    if (!fs.existsSync(filePath)) {
      logger.warnWithContext("Policy file not found", {
        ...context,
        filename
      });
      return sendError(res, {
        statusCode: 404,
        requestId,
        code: "POLICY_NOT_FOUND",
        message: `Policy document '${filename}' not found`
      });
    }

    const content = fs.readFileSync(filePath, "utf8");

    // Check Accept header for content negotiation
    const acceptHeader = res.req.get("Accept") || "";

    if (acceptHeader.includes("text/html")) {
      // Return simple HTML wrapper for browser viewing
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${filename.replace(".md", "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; color: #333; }
    h1 { border-bottom: 2px solid #007bff; padding-bottom: 0.5rem; }
    h2 { margin-top: 2rem; color: #555; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
    th { background: #f5f5f5; }
    code { background: #f5f5f5; padding: 0.2rem 0.4rem; border-radius: 3px; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #ddd; margin: 2rem 0; }
  </style>
</head>
<body>
<pre style="white-space: pre-wrap; font-family: inherit;">${content.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>
</body>
</html>`;
      res.type("text/html").send(html);
    } else {
      // Default to markdown
      res.type("text/markdown").send(content);
    }
  } catch (error) {
    logger.errorWithContext("Error serving policy file", {
      ...context,
      filename,
      cause: error.name || "FileReadError",
      error: error.message
    });
    sendError(res, {
      statusCode: 500,
      requestId,
      code: "POLICY_LOAD_FAILED",
      message: "Failed to load policy document"
    });
  }
}

/**
 * GET /.well-known/terms-of-service
 * Returns the Terms of Service document
 */
router.get("/terms-of-service", (req, res) => {
  const requestId = ulid();
  const context = logger.createLogContext("PoliciesRoutes", "getTermsOfService", {
    requestId,
    endpoint: "/.well-known/terms-of-service",
    ip: req.ip
  });
  logger.infoWithContext("Terms of Service requested", context);
  servePolicyFile("terms-of-service.md", res, requestId, context);
});

/**
 * GET /.well-known/privacy-policy
 * Returns the Privacy Policy document
 */
router.get("/privacy-policy", (req, res) => {
  const requestId = ulid();
  const context = logger.createLogContext("PoliciesRoutes", "getPrivacyPolicy", {
    requestId,
    endpoint: "/.well-known/privacy-policy",
    ip: req.ip
  });
  logger.infoWithContext("Privacy Policy requested", context);
  servePolicyFile("privacy-policy.md", res, requestId, context);
});

/**
 * GET /.well-known/data-retention
 * Returns the Data Retention Policy document
 */
router.get("/data-retention", (req, res) => {
  const requestId = ulid();
  const context = logger.createLogContext("PoliciesRoutes", "getDataRetention", {
    requestId,
    endpoint: "/.well-known/data-retention",
    ip: req.ip
  });
  logger.infoWithContext("Data Retention Policy requested", context);
  servePolicyFile("data-retention.md", res, requestId, context);
});

/**
 * GET /.well-known/why-identyclaw
 * Returns the Why IdentityClaw value proposition document
 */
router.get("/why-identyclaw", (req, res) => {
  const requestId = ulid();
  const context = logger.createLogContext("PoliciesRoutes", "getWhyIdentityClaw", {
    requestId,
    endpoint: "/.well-known/why-identyclaw",
    ip: req.ip
  });
  logger.infoWithContext("Why IdentityClaw requested", context);
  servePolicyFile("why-identyclaw.md", res, requestId, context);
});

module.exports = router;
