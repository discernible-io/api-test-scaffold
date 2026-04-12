const config = require("config");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function calculateMintingFee({
  maxRequests,
  maxrqWindow,
  notAfter,
  numberofrodit = 1,
  baseFee = null
}) {
  const mr = Number(maxRequests);
  const mw = Number(maxrqWindow);
  const qty = Number(numberofrodit);

  const baselineFee = baseFee !== null
    ? Number(baseFee)
    : Number(process.env.MINTING_FEE || config.get("MINTING_FEE") || 0);

  if (isNaN(mr) || mr <= 0) {
    throw new Error(`Invalid maxRequests: ${maxRequests}`);
  }
  if (isNaN(mw) || mw <= 0) {
    throw new Error(`Invalid maxrqWindow: ${maxrqWindow}`);
  }
  if (isNaN(qty) || qty <= 0) {
    throw new Error(`Invalid numberofrodit: ${numberofrodit}`);
  }
  if (isNaN(baselineFee) || baselineFee < 0) {
    throw new Error(`Invalid baseFee: ${baseFee || process.env.MINTING_FEE}`);
  }

  const expiryDate = new Date(notAfter);
  const today = new Date();

  if (isNaN(expiryDate.getTime())) {
    throw new Error(`Invalid notAfter date: ${notAfter}`);
  }

  const diffMs = expiryDate - today;

  if (diffMs < 0) {
    throw new Error(`Expiration date ${notAfter} is in the past`);
  }

  const daysUntilExpiry = Math.ceil(diffMs / ONE_DAY_MS);

  const requestsMultiplier = mr / 100;
  const windowMultiplier = 3600 / mw;
  const daysMultiplier = daysUntilExpiry / 365;

  const feeMultiplier = requestsMultiplier * windowMultiplier * daysMultiplier;
  const perRoditFee = baselineFee * feeMultiplier;

  const totalFee = perRoditFee * qty;

  return {
    totalFee: totalFee.toString(),
    perRoditFee,
    daysUntilExpiry,
    breakdown: {
      baseFee: baselineFee,
      maxRequests: mr,
      maxrqWindow: mw,
      numberofrodit: qty,
      requestsMultiplier,
      windowMultiplier,
      daysMultiplier,
      feeMultiplier,
      expiryDate: expiryDate.toISOString(),
      today: today.toISOString()
    }
  };
}

function getMintingFeeAccount() {
  return process.env.MINTING_FEEACCOUNT || config.get("MINTING_FEEACCOUNT") || "";
}

module.exports = {
  calculateMintingFee,
  getMintingFeeAccount
};
