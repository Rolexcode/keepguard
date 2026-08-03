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

const APPROVAL_EVENT_ABI = JSON.stringify([
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "owner", type: "address" },
      { indexed: true, internalType: "address", name: "spender", type: "address" },
      { indexed: false, internalType: "uint256", name: "value", type: "uint256" },
    ],
    name: "Approval",
    type: "event",
  },
]);

const APPROVE_FUNCTION_ABI = JSON.stringify([
  {
    inputs: [
      { internalType: "address", name: "spender", type: "address" },
      { internalType: "uint256", name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
]);

function caseInsensitiveAddressPattern(address) {
  const escaped = [...address].map((character) => {
    if (/[a-fx]/i.test(character)) return `[${character.toLowerCase()}${character.toUpperCase()}]`;
    return character;
  }).join("");
  return `^${escaped}$`;
}

function conditionNode(id, label, leftOperand, operator, rightOperand, x) {
  return {
    id,
    type: "action",
    position: { x, y: 220 },
    data: {
      label,
      description: label,
      type: "action",
      status: "idle",
      config: {
        actionType: "Condition",
        condition: `${leftOperand} ${operator} ${JSON.stringify(rightOperand)}`,
        conditionConfig: {
          group: {
            id: `${id}-group`,
            logic: "AND",
            rules: [{
              id: `${id}-rule`,
              leftOperand,
              operator,
              rightOperand,
            }],
          },
        },
      },
    },
  };
}

// This fixed graph uses documented KeeperHub node schemas and does not depend
// on the optional AI workflow generator being enabled for the organization.
export function buildApprovalWatchWorkflow({
  walletAddress,
  tokenContract,
  network,
  spenderWhitelist = [],
}) {
  const triggerId = "approval-trigger";
  const ownerConditionId = "owner-condition";
  const valueConditionId = "value-condition";
  const whitelistConditionId = "whitelist-condition";
  const revokeId = "revoke-approval";
  // Event arguments are spread onto the trigger output by KeeperHub.
  const ownerRef = `{{@${triggerId}:Approval detected.owner}}`;
  const spenderRef = `{{@${triggerId}:Approval detected.spender}}`;
  const valueRef = `{{@${triggerId}:Approval detected.value}}`;

  const nodes = [
    {
      id: triggerId,
      type: "trigger",
      position: { x: 0, y: 220 },
      data: {
        label: "Approval detected",
        description: "Watch the selected token for Approval events",
        type: "trigger",
        status: "idle",
        config: {
          triggerType: "Event",
          network,
          contractAddress: tokenContract,
          contractABI: APPROVAL_EVENT_ABI,
          eventName: "Approval",
        },
      },
    },
    conditionNode(
      ownerConditionId,
      "Approval belongs to protected wallet",
      ownerRef,
      "matchesRegex",
      caseInsensitiveAddressPattern(walletAddress),
      300
    ),
    conditionNode(
      valueConditionId,
      "Allowance is greater than zero",
      valueRef,
      ">",
      "0",
      600
    ),
    {
      id: revokeId,
      type: "action",
      position: { x: spenderWhitelist.length ? 1200 : 900, y: 220 },
      data: {
        label: "Revoke untrusted approval",
        description: "Reset the detected spender's allowance to zero",
        type: "action",
        status: "idle",
        config: {
          actionType: "web3/write-contract",
          network,
          contractAddress: tokenContract,
          abi: APPROVE_FUNCTION_ABI,
          abiFunction: "approve",
          functionArgs: JSON.stringify([spenderRef, "0"]),
        },
      },
    },
  ];

  const edges = [
    { id: "approval-to-owner", source: triggerId, target: ownerConditionId },
    {
      id: "owner-to-value",
      source: ownerConditionId,
      target: valueConditionId,
      sourceHandle: "true",
    },
  ];

  if (spenderWhitelist.length) {
    const whitelistPattern = `^(?:${spenderWhitelist
      .map(caseInsensitiveAddressPattern)
      .map((pattern) => pattern.slice(1, -1))
      .join("|")})$`;
    nodes.splice(nodes.length - 1, 0, conditionNode(
      whitelistConditionId,
      "Spender is trusted",
      spenderRef,
      "matchesRegex",
      whitelistPattern,
      900
    ));
    edges.push(
      {
        id: "value-to-whitelist",
        source: valueConditionId,
        target: whitelistConditionId,
        sourceHandle: "true",
      },
      {
        id: "untrusted-to-revoke",
        source: whitelistConditionId,
        target: revokeId,
        sourceHandle: "false",
      }
    );
  } else {
    edges.push({
      id: "value-to-revoke",
      source: valueConditionId,
      target: revokeId,
      sourceHandle: "true",
    });
  }

  return { nodes, edges };
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
