// config.js
module.exports = {
    SMART_CONTRACT: "10201-cableguard-org.testnet",
    BLOCKCHAIN_NETWORK: ".testnet",
    RODIT_ID_SZ: 128,
    RODIT_ID_PK_SZ: 32,
    RODIT_ID_SIGNATURE_SZ: 64,
    ED25519_KEY_SZ: 64
};

// In other files
const config = require('./config');
// Use config.SMART_CONTRACT instead of CONSTANTS.SMART_CONTRACT