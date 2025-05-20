// Copyright (c) 2024 Cableguard, Inc. All rights reserved.

const config = require("config");
const express = require("express");
const https = require("https");
const ratelimitmw = require("./middleware/ratelimit");
const validatepermissions = require("./middleware/validatepermissions");
const logger = require("../../config/logger");
const loggingmw = require("./middleware/loggingmw");
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");
const forge = require("node-forge");
const crypto = require("crypto");
const fs = require("fs");

const {
  authenticate_apicall,
} = require("../middleware/authenticationmw");
const {
  verify_peerrodit_getrodit,
} = require("../auth/authentication");
const {
  generate_jwt_token,
} = require("../auth/tokenservice");
const stateManager = require("../blockchain/statemanager");

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "RODiT prototype API",
      version: "1.0.0",
      description:
        "This is a REST API application made with Express. It just echoes whatever string you send to it.",
      // license: {
      //  name: 'Licensed Under MIT',
      //  url: 'https://spdx.org/licenses/MIT.html',
      //},
      contact: {
        name: "JSONPlaceholder for the contact name",
        url: "https:// https://dev-api.aparejos.net:3443/home.js",
      },
    },
    servers: [
      {
        url: "https:// https://dev-api.aparejos.net:3443",
        description: "RODiT Development server",
      },
    ],
  },
  apis: ["./app.js", "./routes/*.js"],
};

// Default rate limits
let ratelimitmwph = ratelimitmw(100, 15 * 60 * 1000);

// Configuration is now loaded from config files
const VAULT_RODIT_KEYVALUE_PATH = config.get(
  "VAULT_RODIT_KEYVALUE_PATH"
);
const PORT = config.get("PORT");

const swaggerSpec = swaggerJsdoc(options);
const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Routes

// Log in route
/**
 * @swagger
 * /login:
 *   post:
 *     summary: Authenticate user
 *     description: Authenticate a user using their RODiT ID and signature
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               peer_roditid:
 *                 type: string
 *                 description: The RODiT ID verify_peerrodit_getitof the user
 *               peer_roditid_base64url_signature:
 *                 type: string
 *                 description: The base64url signature of the RODiT ID
 *     responses:
 *       200:
 *         description: Successful authentication
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT token for authenticated session
 *       400:
 *         description: Missing RODiT ID or Signature
 *       401:
 *         description: Authentication failed
 */
app.post(
  "/login",
  async (req, res, next) => {
    req.logAction = "login-attempt";
    next();
  },
  async (req, res) => {
    const { roditid, roditid_base64url_signature } = req.body;

    let peer_roditid = roditid;
    let peer_roditid_base64url_signature = roditid_base64url_signature;
    logger.debug("Info: Client RODiT ID:", peer_roditid);

    if (!peer_roditid || !peer_roditid_base64url_signature) {
      return res
        .status(400)
        .json({ message: "Error: Missing RODiT ID and Signature" });
    }

    try {
      let { peer_rodit, goodrodit } = await verify_peerrodit_getrodit(
        peer_roditid,
        peer_roditid_base64url_signature
      );

      if (goodrodit) {
        const config_own_rodit = await stateManager.get_rodit_config();
        if (!config_own_rodit) {
          throw new Error("Server configuration not initialized");
        }
        const token = await generate_jwt_token(
          peer_rodit,
          config_own_rodit.own_rodit,
          config_own_rodit.own_rodit_bytes_private_key,
          config_own_rodit.own_roditid_base64url_signature
        );

        logger.warn(`Info: Login attempt succeeded:`, peer_rodit.token_id);
        res.json({ token });
      } else {
        logger.error(`Error 001: Login attempt failed: ${error}`);
        res.status(401).json({
          message: "Error 001: Login attempt failed:",
          error: error.message,
        });
      }
    } catch (error) {
      logger.error(`Error 001: Login attempt failed: ${error}`);
      res.status(401).json({
        message: "Error 001: Login attempt failed:",
        error: error.message,
      });
    }
  }
);

app.use((req, res, next) => {
  if (req.logAction) {
    logger.info(`Action logged: ${req.logAction}`);
  }
  next();
});

// Import protected routes
const crudarotectedRoute = require("./protected/cruda");
const echoprotectedRoute = require("./protected/echo");

// Apply rate limiting middleware to all routes
app.use(ratelimitmwph);

// Mount Logging middleware
app.use(loggingmw);

// Mount rate limiter route
app.use((req, res, next) => ratelimitmwph(req, res, next));

// Mount CRUDA protected route, where token is authenticated and permissions vetted
app.use("/api", authenticate_apicall, echoprotectedRoute);

// Mount CRUDA protected route, where token is authenticated and permissions vetted
app.use("/api", authenticate_apicall, validatepermissions, crudarotectedRoute);

app.use((err, req, res, next) => {
  logger.error({
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    userIP: req.ip,
    userId: req.user ? req.user.id : "anonymous",
  });
  res.status(500).json({ error: "Error: Internal Server Error" });
});

// Update rate limit once obtained config
function updateratelimit(maxrequests, maxrqwindow) {
  ratelimitmwph = ratelimitmw(maxrequests, maxrqwindow);
}

// Start server
async function startServer() {
  try {
    await stateManager.set_rodit_config(VAULT_RODIT_KEYVALUE_PATH);
    const config_own_rodit = await stateManager.get_rodit_config();

    // Create key objects using Node.js crypto
    const own_rodit_keyobject_privatekey = crypto.createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"), // Ed25519 private key header
        config_own_rodit.own_rodit_bytes_private_key,
      ]),
      format: "der",
      type: "pkcs8",
    });
    const own_rodit_keyobject_publickey = crypto.createPublicKey(own_rodit_keyobject_privatekey);

    // Export keys in DER format
    const own_rodit_der_privatekey = own_rodit_keyobject_privatekey.export({ format: "der", type: "pkcs8" });
    const own_rodit_der_publickey = own_rodit_keyobject_publickey.export({ format: "der", type: "spki" });

    // Convert directly to Forge ASN.1 objects
    const own_rodit_asn1_privatekey = forge.asn1.fromDer(own_rodit_der_privatekey.toString('binary'));
    const own_rodit_asn1_publickey = forge.asn1.fromDer(own_rodit_der_publickey.toString('binary'));

    // Create Forge key object
    let own_forge_keypair = forge.pki.ed25519.generateKeyPair();
    own_forge_keypair.privateKey = forge.pki.ed25519.privateKeyFromAsn1(own_rodit_asn1_privatekey);
    own_forge_keypair.publicKey = forge.pki.ed25519.publicKeyFromAsn1(own_rodit_asn1_publickey);

    // Create and assign keys to certificate
    const cert = forge.pki.createCertificate();
    cert.privateKey = own_forge_keypair.privateKey;
    cert.publicKey = own_forge_keypair.publicKey;
    // NOTE: serialNumber is the hex encoded value of an ASN.1 INTEGER.
    // Conforming CAs should ensure serialNumber is:
    // - no more than 20 octets
    // - non-negative (prefix a '00' if your value starts with a '1' bit)
    cert.serialNumber = "01" + crypto.randomBytes(19).toString("hex"); // 1 octet = 8 bits = 1 byte = 2 hex chars
    cert.validity.notBefore = config_own_rodit.own_rodit.metadata.notbefore;
    cert.validity.notAfter = config_own_rodit.own_rodit.metadata.notafter;
    const attrs = [
      { shortName: "C", value: "thenameofacountry" },
      { shortName: "ST", value: "thenameofanadministrativedivision" },
      { shortName: "L", value: "thenameofacity" },
      {
        shortName: "O",
        value: config_own_rodit.own_rodit.metadata.openapijsonurl,
      },
      {
        shortName: "CN",
        value: config_own_rodit.own_rodit.metadata.subjectuniqueidentifierurl,
      },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    // const pem = generateSelfSignedCertificate();
    // add alt names so that the browser won't complain
    /*        cert.setExtensions([{
      name: 'subjectAltName',
      altNames: [
        ...(altNameURIs !== undefined ?
          altNameURIs.map((uri) => ({type: 6, value: uri})) :
          []
        ),
        ...(altNameIPs !== undefined ?
          altNameIPs.map((uri) => ({type: 7, ip: uri})) :
          []
        )
      ]
    }]);
    */
        
    // Create a SHA-512 hash of the certificate data
    /*
    const certhash = crypto.createHash('sha512');
    certhash.update(cert);
    const certdigest = certhash.digest();
    cert.signature = crypto.sign('sha512', certdigest, own_rodit_keyobject_privatekey);
    const isVerified = crypto.verify('sha512', digest, own_rodit_keyobject_publickey, cert.signature);
    logger.info('Signature:', cert.signature.toString('base64'));
    logger.info('Signature Verified:', isVerified);
    */

    cert.sign(own_forge_keypair.privateKey, forge.md.sha512.create());

    ed25519.sign = function(options) {
      options = options || {};
      var msg = messageToNativeBuffer(options);
      var privateKey = messageToNativeBuffer({
        message: options.privateKey,
        encoding: 'binary'
      });
      if(privateKey.length === ed25519.constants.SEED_BYTE_LENGTH) {
        var keyPair = ed25519.generateKeyPair({seed: privateKey});
        privateKey = keyPair.privateKey;
      } else if(privateKey.length !== ed25519.constants.PRIVATE_KEY_BYTE_LENGTH) {
        throw new TypeError(
          '"options.privateKey" must have a byte length of ' +
          ed25519.constants.SEED_BYTE_LENGTH + ' or ' +
          ed25519.constants.PRIVATE_KEY_BYTE_LENGTH);
      }
    
      var signedMsg = new NativeBuffer(
        ed25519.constants.SIGN_BYTE_LENGTH + msg.length);
      crypto_sign(signedMsg, msg, msg.length, privateKey);
    
      var sig = new NativeBuffer(ed25519.constants.SIGN_BYTE_LENGTH);
      for(var i = 0; i < sig.length; ++i) {
        sig[i] = signedMsg[i];
      }
      return sig;
    };

/*    
    const certPem = forge.pki.certificateToPem(cert);
    const publicKeyPem = forge.pki.publicKeyToPem(
      own_rodit_keyobject_publickey
    );
    const privateKeyPem = forge.pki.privateKeyToPem(
      own_rodit_keyobject_privatekey
    );

    fs.writeFileSync("certificate.pem", certPem);
    fs.writeFileSync("public_key.pem", publicKeyPem);
    fs.writeFileSync("private_key.pem", privateKeyPem);
*/


    logger.debug(
      "config_own_rodit.own_rodit.metadata.maxrequests",
      config_own_rodit.own_rodit.metadata.maxrequests
    );
    logger.debug(
      "config_own_rodit.own_rodit.metadata.maxrqwindow",
      config_own_rodit.own_rodit.metadata.maxrqwindow
    );
    if (
      config_own_rodit.own_rodit.metadata.maxrequests &&
      config_own_rodit.own_rodit.metadata.maxrqwindow
    ) {
      updateratelimit(
        config_own_rodit.own_rodit.metadata.maxrequests,
        config_own_rodit.own_rodit.metadata.maxrqwindow
      );
    } else {
      logger.debug("Info: Unable to update rate limit due to missing data");
    }
    
    app.listen(config_own_rodit.port, () => {
      logger.info(`Info: Server started on port ${config_own_rodit.port}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error}`);
    process.exit(1);
  }
}

startServer();
