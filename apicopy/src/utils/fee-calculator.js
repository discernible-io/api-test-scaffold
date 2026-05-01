const config = require("config");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_FEE = 0.018; // Minimum fee to cover contract storage

// Baseline values for formula-based calculation (Personal tier)
const BASELINE = {
  maxRequests: 100,
  maxrqWindow: 3600,
  days: 365,
  feeNear: 0.28 // From REACT_APP_MINTING_FEE
};

function calculateMintingFee({
  maxRequests,
  maxrqWindow,
  expirationDate,
  numberofrodit = 1,
  baselineFeeNear = null,
  tier = null
}) {
  // Handle missing parameters - return 0 fee (frontend behavior)
  if (maxRequests === undefined || maxrqWindow === undefined || expirationDate === undefined) {
    return {
      perRoditNear: 0,
      daysUntilExpiry: 0,
      feeMultiplier: 0,
      tier: "unknown",
      baseline: BASELINE
    };
  }

  const mr = Number(maxRequests);
  const mw = Number(maxrqWindow);
  const qty = Number(numberofrodit);

  const baseFee = baselineFeeNear !== null
    ? Number(baselineFeeNear)
    : Number(process.env.MINTING_FEE || config.get("MINTING_FEE") || BASELINE.feeNear);

  if (isNaN(mr) || mr <= 0) {
    throw new Error(`Invalid maxRequests: ${maxRequests}`);
  }
  if (isNaN(mw) || mw <= 0) {
    throw new Error(`Invalid maxrqWindow: ${maxrqWindow}`);
  }
  if (isNaN(qty) || qty <= 0) {
    throw new Error(`Invalid numberofrodit: ${numberofrodit}`);
  }
  if (isNaN(baseFee) || baseFee < 0) {
    throw new Error(`Invalid baselineFeeNear: ${baselineFeeNear || process.env.MINTING_FEE}`);
  }

  // Collectible Tier (Immortal)
  if (tier === "collectible" || expirationDate === "0") {
    // Fixed fee: 496 NEAR
    // Rate limit: 496 requests/60s
    return {
      perRoditNear: 496,
      daysUntilExpiry: 99999,
      feeMultiplier: 1,
      tier: "collectible",
      baseline: BASELINE
    };
  }

  // Enterprise Tier
  if (tier === "enterprise" || mr === 4999) {
    const expiryDate = new Date(expirationDate);
    const today = new Date();

    if (isNaN(expiryDate.getTime())) {
      throw new Error(`Invalid expirationDate: ${expirationDate}`);
    }

    const diffMs = expiryDate - today;

    if (diffMs < 0) {
      throw new Error(`Expiration date ${expirationDate} is in the past`);
    }

    const daysUntilExpiry = Math.ceil(diffMs / ONE_DAY_MS);
    // Enterprise: 1806 NEAR per year, calculated based on days
    const years = daysUntilExpiry / 365;
    const perRoditNear = 1806 * years; // 1806 NEAR per year

    return {
      perRoditNear,
      daysUntilExpiry,
      feeMultiplier: years,
      tier: "enterprise",
      baseline: BASELINE
    };
  }

  // Personal Tier (Formula-Based)
  const expiryDate = new Date(expirationDate);
  const today = new Date();

  if (isNaN(expiryDate.getTime())) {
    throw new Error(`Invalid expirationDate: ${expirationDate}`);
  }

  const diffMs = expiryDate - today;

  if (diffMs < 0) {
    throw new Error(`Expiration date ${expirationDate} is in the past`);
  }

  const daysUntilExpiry = Math.ceil(diffMs / ONE_DAY_MS);

  // Fee multiplier formula - based on days passed
  const feeMultiplier = (mr / BASELINE.maxRequests) *
                        (BASELINE.maxrqWindow / mw) *
                        (daysUntilExpiry / BASELINE.days);

  // Calculate final fee
  let perRoditNear = baseFee * feeMultiplier;

  // Enforce minimum fee floor
  perRoditNear = Math.max(perRoditNear, MIN_FEE);

  return {
    perRoditNear,
    daysUntilExpiry,
    feeMultiplier,
    tier: tier || "personal",
    baseline: BASELINE
  };
}

function getMintingFeeAccount() {
  return process.env.MINTING_FEEACCOUNT || config.get("MINTING_FEEACCOUNT") || "";
}

module.exports = {
  calculateMintingFee,
  getMintingFeeAccount
};
