const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const { ulid } = require("ulid");
const { logger, errorResponse } = require("@rodit/rodit-auth-be");
const { sendError } = errorResponse;
const enrollmentConfig = require("../config/howto.config");

/**
 * Helper function to generate enrollment steps HTML
 */
function generateEnrollmentStepsHTML() {
  return enrollmentConfig.enrollmentSteps.map(step => {
    let detailsHTML = '';
    
    if (step.details.warning) {
      detailsHTML += `<p style="background: #fff3cd; padding: 10px; border-radius: 4px; margin: 10px 0 10px 42px; border-left: 3px solid #ffc107;"><strong>⚠️ Warning:</strong> ${step.details.warning}</p>`;
    }
    if (step.details.command) {
      detailsHTML += `<div class="code">${step.details.command}</div>`;
    }
    if (step.details.exchange) {
      detailsHTML += `<p><strong>Get NEAR tokens:</strong> ${step.details.exchange}</p>`;
    }
    if (step.details.note) {
      detailsHTML += `<p style="background: #e8f4f8; padding: 10px; border-radius: 4px; margin: 10px 0 10px 42px; border-left: 3px solid #0288d1;"><strong>💡 Note:</strong> ${step.details.note}</p>`;
    }
    if (step.details.url) {
      detailsHTML += `<p><strong>Portal:</strong> <a href="${step.details.url}" target="_blank">${step.details.url.replace('https://', '')}</a></p>`;
    }
    if (step.details.requirements) {
      detailsHTML += `<p><strong>What you'll need:</strong></p>
                <ul style="margin-left: 62px; color: #666;">
                  ${step.details.requirements.map(req => `<li>${req}</li>`).join('')}
                </ul>`;
    }
    if (step.step === 3) {
      detailsHTML += `<div class="code">curl -X POST https://api.identyclaw.com/api/login \\
  -H "Content-Type: application/json" \\
  -d '{"hello":"HOLA/&lt;recipient&gt;/&lt;tokenId&gt;/&lt;timestamp&gt;/&lt;nonce&gt;/API.IDENTYCLAW.COM/&lt;signature&gt;/&lt;checksum&gt;"}'</div>
                <p>Then retrieve your full identity:</p>
                <div class="code">curl https://api.identyclaw.com/api/me/identity \\
  -H "Authorization: Bearer &lt;jwt_token&gt;"</div>`;
    }
    
    return `
            <div class="step">
                <span class="step-number">${step.step}</span>
                <h3>${step.title}</h3>
                <p>${step.description}</p>
                ${detailsHTML}
            </div>`;
  }).join('');
}

/**
 * @route GET /
 * @desc API discovery endpoint with enrollment information
 * @access Public - No authentication required
 */
router.get("/", (req, res) => {
  const requestId = req.requestId || ulid();
  const context = logger.createLogContext("DiscoveryRoutes", "getRoot", {
    requestId,
    endpoint: "/",
    ip: req.ip
  });

  logger.infoWithContext("API root discovery requested", context);

  const response = {
    name: "IdentityClaw API",
    version: "1.0.0",
    description: "API for AI agent identities backed by RODiT tokens on NEAR, including facial token_id encoding.",
    enrollment: {
      url: enrollmentConfig.enrollment.url,
      guide: "/.well-known/enrollment",
      quickStart: "/docs/enrollment",
      badge: enrollmentConfig.messages.badge
    },
    documentation: {
      swagger: "/swagger.json",
      openapi: "/openapi.json",
      html: "/docs"
    },
    endpoints: {
      public: [
        "/.well-known/did/resolve",
        "/.well-known/enrollment",
        "/api/agents",
        "/api/login/timestamp",
        "/api/signclient"
      ],
      authenticated: [
        "/api/me/identity",
        "/api/login",
        "/api/logout",
        "/api/identity/verify",
        "/api/isauthorizedsigner",
        "/api/holanonce16ts"
      ],
      privileged: [
        "/api/metrics",
        "/api/sessions"
      ]
    },
    wellKnown: {
      enrollment: "/.well-known/enrollment",
      termsOfService: "/.well-known/terms-of-service",
      privacyPolicy: "/.well-known/privacy-policy",
      dataRetention: "/.well-known/data-retention",
      did: "/.well-known/did"
    },
    mcp: {
      resources: "/api/mcp/resources",
      schema: "/api/mcp/schema"
    },
    requestId,
    timestamp: new Date().toISOString()
  };

  return res.status(200).json(response);
});

/**
 * @route GET /.well-known/enrollment
 * @desc Enrollment information and guidance
 * @access Public - No authentication required
 */
router.get("/.well-known/enrollment", (req, res) => {
  const requestId = req.requestId || ulid();
  const context = logger.createLogContext("DiscoveryRoutes", "getEnrollment", {
    requestId,
    endpoint: "/.well-known/enrollment",
    ip: req.ip
  });

  logger.infoWithContext("Enrollment information requested", context);

  const response = {
    title: "IdentityClaw API Enrollment",
    enrollment: enrollmentConfig.enrollment,
    pricing: enrollmentConfig.pricing,
    enrollmentSteps: enrollmentConfig.enrollmentSteps,
    authentication: enrollmentConfig.authentication,
    support: enrollmentConfig.support,
    requestId,
    timestamp: new Date().toISOString()
  };

  return res.status(200).json(response);
});

/**
 * @route GET /openapi.json
 * @desc Standard OpenAPI specification (alias for swagger.json)
 * @access Public - No authentication required
 */
router.get("/openapi.json", (req, res) => {
  const requestId = req.requestId || ulid();
  const swaggerPath = path.join(__dirname, "../../api-docs/swagger.json");
  
  try {
    const swaggerContent = fs.readFileSync(swaggerPath, "utf8");
    const swagger = JSON.parse(swaggerContent);
    
    // Update to OpenAPI 3.0.0 format if needed
    const openApiSpec = {
      ...swagger,
      openapi: swagger.openapi || "3.0.0"
    };
    
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json(openApiSpec);
  } catch (error) {
    logger.error("Error serving OpenAPI spec", {
      requestId,
      error: error.message
    });
    
    return sendError(res, {
      statusCode: 500,
      requestId,
      code: "OPENAPI_ERROR",
      message: "Failed to load OpenAPI specification"
    });
  }
});

/**
 * @route GET /api/v1/openapi.json
 * @desc Versioned OpenAPI specification
 * @access Public - No authentication required
 */
router.get("/api/v1/openapi.json", (req, res) => {
  // Redirect to the main OpenAPI spec
  return res.redirect(301, "/openapi.json");
});

/**
 * @route GET /docs/enrollment
 * @desc Quick-start enrollment guide (HTML)
 * @access Public - No authentication required
 */
router.get("/docs/enrollment", (req, res) => {
  const requestId = req.requestId || ulid();
  
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IdentityClaw Quick Start Guide</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 12px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 40px;
            text-align: center;
        }
        .header h1 { font-size: 2.5rem; margin-bottom: 10px; }
        .header p { font-size: 1.2rem; opacity: 0.9; }
        .content { padding: 40px; }
        .step {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 4px;
        }
        .step-number {
            display: inline-block;
            background: #667eea;
            color: white;
            width: 32px;
            height: 32px;
            line-height: 32px;
            text-align: center;
            border-radius: 50%;
            font-weight: bold;
            margin-right: 10px;
        }
        .step h3 { display: inline; color: #333; }
        .step p { margin: 10px 0 10px 42px; color: #666; }
        .code {
            background: #2d2d2d;
            color: #f8f8f2;
            padding: 15px;
            border-radius: 4px;
            overflow-x: auto;
            font-family: 'Courier New', monospace;
            font-size: 0.9rem;
            margin: 10px 0 10px 42px;
        }
        .cta {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
            margin-top: 30px;
            border-radius: 8px;
        }
        .cta a {
            display: inline-block;
            background: white;
            color: #667eea;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 6px;
            font-weight: bold;
            margin: 10px;
            transition: transform 0.2s;
        }
        .cta a:hover { transform: translateY(-2px); }
        .info-box {
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .warning-box {
            background: #fff3cd;
            border-left: 4px solid #ffc107;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .construction-banner {
            background: linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%);
            color: white;
            padding: 20px;
            margin-bottom: 30px;
            border-radius: 8px;
            text-align: center;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.9; }
        }
        .construction-banner h2 {
            margin: 0 0 10px 0;
            font-size: 1.8rem;
        }
        .construction-banner p {
            margin: 0;
            font-size: 1.1rem;
            opacity: 0.95;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="construction-banner">
            <h2>🚧 UNDER CONSTRUCTION</h2>
            <p>Many features may not work until further announcement. Please check back later.</p>
        </div>
        
        <div class="header">
            <h1>🎫 Quick Start Guide</h1>
            <p>${enrollmentConfig.messages.quickStartTitle}</p>
        </div>
        
        <div class="content">
            <div class="info-box">
                <strong>📋 What you'll need:</strong> ${enrollmentConfig.messages.requirements}.
            </div>

${generateEnrollmentStepsHTML()}

            <div class="warning-box">
                <strong>⚠️ Important:</strong> Keep your NEAR private keys secure. Never share them with anyone. Your RODiT token metadata is publicly visible on the blockchain.
            </div>

            <div class="cta">
                <h2>Ready to Get Started?</h2>
                <a href="${enrollmentConfig.enrollment.url}" target="_blank">Purchase Token</a>
                <a href="/.well-known/enrollment" target="_blank">Full Enrollment Guide</a>
                <a href="/docs" target="_blank">API Documentation</a>
            </div>

            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; text-align: center; color: #666;">
                <p><strong>Need Help?</strong></p>
                <p>📧 <a href="mailto:${enrollmentConfig.support.contact}">${enrollmentConfig.support.contact}</a></p>
                <p>📚 <a href="/swagger.json">OpenAPI Spec</a> | <a href="/.well-known/terms-of-service">Terms</a> | <a href="/.well-known/privacy-policy">Privacy</a></p>
            </div>
        </div>
    </div>
</body>
</html>`;
  
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(htmlContent);
});

/**
 * @route GET /docs
 * @desc HTML documentation interface
 * @access Public - No authentication required
 */
router.get("/docs", (req, res) => {
  const requestId = req.requestId || ulid();
  
  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IdentityClaw API Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui.css">
    <style>
        body { margin: 0; padding: 20px; font-family: Arial, sans-serif; }
        .header { text-align: center; margin-bottom: 30px; }
        .swagger-ui .topbar { display: none; }
        .enrollment-banner {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
            text-align: center;
        }
        .enrollment-banner h2 { margin: 0 0 10px 0; }
        .enrollment-banner a {
            background: white;
            color: #667eea;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 4px;
            font-weight: bold;
            margin: 0 10px;
            display: inline-block;
        }
        .enrollment-banner a:hover {
            background: #f0f0f0;
        }
        .construction-banner {
            background: linear-gradient(135deg, #ff6b6b 0%, #ffa500 100%);
            color: white;
            padding: 20px;
            margin-bottom: 20px;
            border-radius: 8px;
            text-align: center;
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.9; }
        }
        .construction-banner h2 {
            margin: 0 0 10px 0;
            font-size: 1.8rem;
        }
        .construction-banner p {
            margin: 0;
            font-size: 1.1rem;
            opacity: 0.95;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>IdentityClaw API Documentation</h1>
        <p>API for AI agent identities backed by RODiT tokens on NEAR</p>
    </div>
    
    <div class="construction-banner">
        <h2>🚧 UNDER CONSTRUCTION</h2>
        <p>Many features may not work until further announcement. Please check back later.</p>
    </div>
    
    <div class="enrollment-banner">
        <h2>🎫 Get Started with IdentityClaw</h2>
        <p>Need API access? ${enrollmentConfig.enrollment.description}</p>
        <a href="${enrollmentConfig.enrollment.url}" target="_blank">Purchase Token</a>
        <a href="/docs/enrollment" target="_blank">Quick Start Guide</a>
        <a href="/.well-known/enrollment" target="_blank">Full Enrollment Info</a>
    </div>
    
    <div id="swagger-ui"></div>
    
    <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.10.5/swagger-ui-standalone-preset.js"></script>
    <script>
        SwaggerUIBundle({
            url: '/openapi.json',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
            ],
            plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
            ],
            layout: "StandaloneLayout",
            defaultModelsExpandDepth: 2,
            displayRequestDuration: true
        });
    </script>
</body>
</html>`;
  
  res.setHeader("Content-Type", "text/html");
  return res.status(200).send(htmlContent);
});

module.exports = router;
