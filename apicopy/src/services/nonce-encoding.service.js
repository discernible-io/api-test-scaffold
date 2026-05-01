const HEX_ALPHABET = "0123456789ABCDEF";

function encodeNonceToMorse(raw) {
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8");
  const body = buf.toString("hex").toUpperCase();
  return body;
}

function decodeNonceFromMorse(encoded) {
  if (typeof encoded !== "string") {
    return {
      valid: false,
      checksumValid: false,
      reason: "Nonce must be a string",
      raw: null
    };
  }

  const upper = encoded.toUpperCase();

  if (upper.length < 3) {
    return {
      valid: false,
      checksumValid: false,
      reason: "Nonce must be at least 3 hex characters including checksum",
      raw: null
    };
  }

  if (!/^[0-9A-F]+$/.test(upper)) {
    return {
      valid: false,
      checksumValid: false,
      reason: "Nonce must contain only [0-9A-F] characters",
      raw: null
    };
  }

  const body = upper.slice(0, -1);
  const checksumChar = upper.slice(-1);

  let sum = 0;
  for (const ch of body) {
    const idx = HEX_ALPHABET.indexOf(ch);
    if (idx === -1) {
      return {
        valid: false,
        checksumValid: false,
        reason: "Nonce body contains non-hex character",
        raw: null
      };
    }
    sum += idx;
  }

  const expectedChecksum = HEX_ALPHABET[sum % HEX_ALPHABET.length];
  const checksumValid = checksumChar === expectedChecksum;

  if (!checksumValid) {
    return {
      valid: false,
      checksumValid: false,
      reason: "Nonce checksum mismatch",
      raw: null
    };
  }

  const buf = Buffer.from(body, "hex");
  const raw = buf.toString("utf8");

  return {
    valid: true,
    checksumValid: true,
    raw
  };
}

function validateHexNonce(nonce) {
  if (typeof nonce !== "string") {
    return { valid: false, value: null, reason: "nonce must be a string" };
  }

  const upper = nonce.toUpperCase();

  if (upper.length === 0) {
    return { valid: false, value: null, reason: "nonce must not be empty" };
  }

  if (!/^[0-9A-F]+$/.test(upper)) {
    return {
      valid: false,
      value: null,
      reason: "nonce must contain only [0-9A-F] characters"
    };
  }

  return { valid: true, value: upper, original: nonce, reason: null };
}

function computeHelloChecksum(prefix) {
  let sum = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    sum += prefix.charCodeAt(i);
  }
  const index = sum % HEX_ALPHABET.length;
  return HEX_ALPHABET[index];
}

module.exports = {
  HEX_ALPHABET,
  encodeNonceToMorse,
  decodeNonceFromMorse,
  validateHexNonce,
  computeHelloChecksum
};
