// Minimal sanity checks before anything gets turned into a workflow
// description. Not a substitute for KeeperHub's own validate_workflow —
// this catches obviously bad input early, with a clear error, instead of
// generating a nonsense workflow or silently accepting a typo'd address.

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function assertAddress(value, label) {
  if (!ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be a valid 0x-prefixed 40-hex-char address, got: ${value}`);
  }
}

export function assertPercent(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    throw new Error(`${label} must be a number between 0 and 100, got: ${value}`);
  }
}

export function assertPositiveNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`${label} must be a positive number, got: ${value}`);
  }
}

export function validateRevokeParams(p) {
  assertAddress(p.walletAddress, "walletAddress");
  assertAddress(p.tokenContract, "tokenContract");
  (p.spenderWhitelist || []).forEach((addr) => assertAddress(addr, "whitelist entry"));
}

export function validateStopLossParams(p) {
  assertAddress(p.walletAddress, "walletAddress");
  assertAddress(p.assetContract, "assetContract");
  assertAddress(p.priceFeedContract, "priceFeedContract");
  assertAddress(p.stableAssetContract, "stableAssetContract");
  assertPositiveNumber(p.entryPriceUsd, "entryPriceUsd");
  assertPercent(p.thresholdPct, "thresholdPct");
}
