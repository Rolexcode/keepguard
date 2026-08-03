// Builds plain-English descriptions for KeeperHub's `ai_generate_workflow`
// tool, rather than hand-authoring the node/edge flow-graph JSON ourselves.
//
// Why: KeeperHub's real workflow format is a node/edge graph (React-Flow
// style) with specific trigger types (Manual, Schedule, Webhook, Event,
// Block), typed action configs (actionType strings like
// "web3/write-contract"), and condition nodes with true/false handles.
// That's a lot of exact structure to get right by hand on the first try.
// ai_generate_workflow builds it correctly from a description instead —
// we then run validate_workflow on the result before executing anything.
//
// Confirmed real chain IDs (docs.keeperhub.com/ai-tools/mcp-server):
//   Ethereum mainnet: "1"   Sepolia: "11155111"
//   Base: "8453"            Arbitrum: "42161"    Polygon: "137"

export function approvalWatchDescription({
  walletAddress,
  tokenContract,
  network,
  spenderWhitelist,
}) {
  return (
    `Watch token contract ${tokenContract} on chain ${network} for ERC-20 Approval events ` +
    `where the owner field exactly equals ${walletAddress}. Ignore approvals made by other owners. ` +
    `Check whether the spender is in this whitelist: [${spenderWhitelist.join(", ")}]. ` +
    `If the spender is NOT in the whitelist, use the connected KeeperHub signing wallet, which must ` +
    `equal ${walletAddress}, to call approve(spender, 0) on the token contract. ` +
    `Keep the transaction hash, gas used, retries, and outcome in the KeeperHub execution audit trail. ` +
    `Do not add Telegram, email, Discord, or other external notification nodes.`
  );
}

export function stopLossDescription({
  walletAddress,
  assetContract,
  priceFeedContract,
  network,
  entryPriceUsd,
  thresholdPct,
  stableAssetContract,
  scheduleCron = "*/5 * * * *",
}) {
  return (
    `On a schedule (cron: ${scheduleCron}), read the current price from price feed ` +
    `contract ${priceFeedContract} on chain ${network}, normalizing the answer using the feed's ` +
    `decimals value. Compute the percent change from ` +
    `an entry price of $${entryPriceUsd}. If the price has dropped more than ${thresholdPct}% ` +
    `from entry, read the asset balance of ${walletAddress}. If the balance is zero, do nothing. ` +
    `Otherwise use the connected KeeperHub signing wallet, which must equal ${walletAddress}, ` +
    `to swap the full available balance of asset ${assetContract} into stable asset ` +
    `${stableAssetContract} on the same chain. Store the drawdown, transaction hash, gas used, ` +
    `retries, and outcome in the KeeperHub execution audit trail. Do not add external notification ` +
    `nodes. If the price has not dropped past the threshold, do nothing.`
  );
}

// Chain-id helper so bot.js and callers can accept a friendly name and
// convert to what the MCP tools actually expect (string chain IDs).
const CHAIN_IDS = {
  ethereum: "1",
  mainnet: "1",
  sepolia: "11155111",
  base: "8453",
  arbitrum: "42161",
  polygon: "137",
};

export function toChainId(nameOrId) {
  if (/^\d+$/.test(String(nameOrId))) return String(nameOrId);
  const id = CHAIN_IDS[String(nameOrId).toLowerCase()];
  if (!id) {
    throw new Error(
      `Unknown chain "${nameOrId}". Known: ${Object.keys(CHAIN_IDS).join(", ")}, or pass a numeric chain id directly.`
    );
  }
  return id;
}
