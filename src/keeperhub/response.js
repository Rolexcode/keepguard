const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Normalize MCP content blocks and KeeperHub { ok, result } envelopes. */
export function unwrapToolResult(raw) {
  let value = raw;

  if (Array.isArray(value?.content)) {
    const textBlocks = value.content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text);
    value = textBlocks.map(tryParseJson).find((item) => typeof item === "object") ?? textBlocks[0] ?? value;
  }

  value = tryParseJson(value);
  for (let depth = 0; depth < 4; depth += 1) {
    if (value && typeof value === "object" && value.result && typeof value.result === "object") {
      value = value.result;
      continue;
    }
    if (value && typeof value === "object" && value.data && typeof value.data === "object") {
      value = value.data;
      continue;
    }
    break;
  }
  return value;
}

export function extractWorkflowDraft(raw) {
  const value = unwrapToolResult(raw);
  const draft = value?.workflow ?? value?.draft ?? value;
  if (!draft || !Array.isArray(draft.nodes) || !Array.isArray(draft.edges)) {
    throw new Error(
      "KeeperHub did not return a workflow draft with nodes and edges. Run /status, then try again."
    );
  }
  return draft;
}

export function extractWorkflowId(raw) {
  const value = unwrapToolResult(raw);
  const candidates = [
    value?.workflowId,
    value?.workflow_id,
    value?.workflow?.workflowId,
    value?.workflow?.id,
    value?.id,
  ];
  return candidates.find(
    (candidate) => typeof candidate === "string" && /^wf[_-]/i.test(candidate)
  );
}

function collectWalletAddresses(value, parentKey = "", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    if (
      typeof child === "string" &&
      ADDRESS_RE.test(child) &&
      /(wallet|address)/i.test(key || parentKey)
    ) {
      found.push(child);
    } else if (child && typeof child === "object") {
      collectWalletAddresses(child, key, found);
    }
  }
  return found;
}

export function extractWalletAddresses(raw) {
  const addresses = collectWalletAddresses(unwrapToolResult(raw));
  return [...new Set(addresses.map((address) => address.toLowerCase()))];
}

export function extractWalletIntegrations(raw) {
  const value = unwrapToolResult(raw);
  const items = Array.isArray(value) ? value : value?.integrations;
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.id === "string")
    .filter(
      (item) =>
        (typeof item.address === "string" && ADDRESS_RE.test(item.address)) ||
        /wallet|turnkey/i.test(String(item.type ?? ""))
    )
    .map((item) => ({
      id: item.id,
      name: item.name ?? "KeeperHub wallet",
      type: item.type ?? "wallet",
      address: typeof item.address === "string" ? item.address.toLowerCase() : null,
    }));
}

export function validationFailureMessage(raw) {
  const value = unwrapToolResult(raw);
  if (value?.valid === true) return null;
  const errors = Array.isArray(value?.errors) ? value.errors : [];
  if (errors.length > 0) {
    return errors.map((error) => error?.message ?? error?.code ?? String(error)).join("; ");
  }
  return "KeeperHub did not confirm that the stored workflow is valid.";
}
