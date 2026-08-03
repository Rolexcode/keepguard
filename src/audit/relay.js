import { getDirectExecutionStatus, getExecution } from "../keeperhub/mcpClient.js";
import { unwrapToolResult } from "../keeperhub/response.js";

const EXPLORERS = {
  "1": "https://etherscan.io/tx/",
  "11155111": "https://sepolia.etherscan.io/tx/",
  "8453": "https://basescan.org/tx/",
  "42161": "https://arbiscan.io/tx/",
  "137": "https://polygonscan.com/tx/",
};

function findFirst(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (keys.includes(key) && child != null) return child;
    if (child && typeof child === "object") {
      const nested = findFirst(child, keys);
      if (nested != null) return nested;
    }
  }
  return undefined;
}

export async function formatAuditTrail(executionId) {
  const result = /^direct[_-]/i.test(executionId)
    ? await getDirectExecutionStatus(executionId)
    : await getExecution(executionId);
  const parsed = unwrapToolResult(result);
  if (!parsed || typeof parsed !== "object") {
    return `Execution ${executionId}\n\n${String(parsed ?? "No execution details returned.")}`;
  }

  const status = parsed.status ?? parsed.state ?? "unknown";
  const chainId = String(
    findFirst(parsed, ["chainId", "network"]) ?? process.env.KEEPERHUB_CHAIN ?? ""
  );
  const txHash = findFirst(parsed, ["txHash", "transactionHash"]);
  const gasUsed = findFirst(parsed, ["gasUsed", "gas_used"]);
  const explorer = txHash && EXPLORERS[chainId] ? `${EXPLORERS[chainId]}${txHash}` : null;
  const lines = [
    `KeeperHub execution ${executionId}`,
    "",
    `Status: ${status}`,
    chainId ? `Network: ${chainId}` : null,
    txHash ? `Transaction: ${txHash}` : null,
    gasUsed ? `Gas used: ${gasUsed}` : null,
    explorer ? `Explorer: ${explorer}` : null,
  ].filter(Boolean);

  const steps = parsed.logs ?? parsed.steps ?? [];
  if (Array.isArray(steps) && steps.length > 0) {
    lines.push("", "Steps");
    steps.forEach((step, index) => {
      const label = step.nodeLabel ?? step.step ?? step.name ?? step.id ?? `Step ${index + 1}`;
      const outcome = step.status ?? step.outcome ?? "unknown";
      const retry = step.retryCount ? `, retries: ${step.retryCount}` : "";
      lines.push(`${index + 1}. ${label}: ${outcome}${retry}`);
    });
  } else {
    lines.push("", "No step logs yet. The execution may still be pending.");
  }

  return lines.join("\n");
}
