import { executeContractCall } from "../keeperhub/mcpClient.js";
import { unwrapToolResult } from "../keeperhub/response.js";

export const SEPOLIA_CHAIN_ID = "11155111";
export const DEMO_TOKEN = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14";
export const DEMO_SPENDER = "0x000000000000000000000000000000000000dEaD";

const APPROVE_ABI = [
  {
    inputs: [
      { internalType: "address", name: "guy", type: "address" },
      { internalType: "uint256", name: "wad", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
];

export function demoProtectionParams(telegramChatId) {
  return {
    chain: "sepolia",
    tokenContract: DEMO_TOKEN,
    spenderWhitelist: [],
    telegramChatId,
  };
}

export function demoApprovalCall({ simulate, idempotencyKey } = {}) {
  return {
    chainId: SEPOLIA_CHAIN_ID,
    contractAddress: DEMO_TOKEN,
    abi: APPROVE_ABI,
    functionName: "approve",
    args: [DEMO_SPENDER, "1"],
    simulate: Boolean(simulate),
    idempotencyKey,
  };
}

export async function simulateDemoApproval(dependencyOverrides = {}) {
  const execute = dependencyOverrides.executeContractCall ?? executeContractCall;
  return execute(demoApprovalCall({ simulate: true }));
}

export async function broadcastDemoApproval(idempotencyKey, dependencyOverrides = {}) {
  const execute = dependencyOverrides.executeContractCall ?? executeContractCall;
  return execute(demoApprovalCall({ simulate: false, idempotencyKey }));
}

function findFirst(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && child != null) return child;
    if (child && typeof child === "object") {
      const found = findFirst(child, keys);
      if (found != null) return found;
    }
  }
  return undefined;
}

export function demoExecutionSummary(raw) {
  const value = unwrapToolResult(raw);
  return {
    status: findFirst(value, ["status", "state"]) ?? "submitted",
    executionId: findFirst(value, ["executionId", "execution_id", "id"]),
    txHash: findFirst(value, ["txHash", "transactionHash", "transaction_hash"]),
  };
}
