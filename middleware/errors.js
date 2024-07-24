// errors.js
class RODiTVerificationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RODiTVerificationError';
    }
}

class NearOrgRPCError extends Error {
    constructor(message) {
        super(message);
        this.name = 'NearOrgRPCError';
    }
}

module.exports = {
    RODiTVerificationError,
    NearOrgRPCError,
};

// In verification.js
const { RODiTVerificationError } = require('./errors');

async function verify_hasrodit_getit(peerroditid, peerroditid_base64url_signature) {
    try {
        // ... (existing code)
    } catch (err) {
        throw new RODiTVerificationError(`Peer RODiT verification failed: ${err.message}`);
    }
}