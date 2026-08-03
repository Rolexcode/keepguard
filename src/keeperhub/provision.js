// Safe provisioning lifecycle shared by Telegram and the local x402 preview:
// resolve signer -> generate -> create disabled -> validate stored ID -> enable.

import {
  createWorkflow,
  generateWorkflow,
  getWalletIntegration,
  listIntegrations,
  updateWorkflow,
  validateWorkflow,
} from "./mcpClient.js";
import { approvalWatchDescription, stopLossDescription, toChainId } from "./workflowTemplates.js";
import { validateRevokeParams, validateStopLossParams } from "../utils/validate.js";
import { logger } from "../utils/logger.js";
import {
  extractWalletAddresses,
  extractWalletIntegrations,
  extractWorkflowDraft,
  extractWorkflowId,
  validationFailureMessage,
} from "./response.js";

const SCOPE = "keeperhub.provision";
const DEFAULT_DEPS = {
  createWorkflow,
  generateWorkflow,
  getWalletIntegration,
  listIntegrations,
  updateWorkflow,
  validateWorkflow,
};

function enforceNetworkPolicy(network) {
  const isSepolia = network === "11155111";
  const mainnetAllowed = process.env.KEEPERHUB_ALLOW_MAINNET === "true";
  if (!isSepolia && !mainnetAllowed) {
    throw new Error(
      "Mainnet protection is locked while testing. Use Sepolia, or explicitly set " +
        "KEEPERHUB_ALLOW_MAINNET=true after the Sepolia demo succeeds."
    );
  }
}

async function resolveKeeperHubWallet(requestedAddress, deps) {
  const listed = extractWalletIntegrations(await deps.listIntegrations());
  const configuredId = process.env.KEEPERHUB_WALLET_INTEGRATION_ID;
  let selected;

  if (configuredId) selected = listed.find((item) => item.id === configuredId);
  else if (requestedAddress) {
    selected = listed.find((item) => item.address === requestedAddress.toLowerCase());
  } else if (listed.length === 1) selected = listed[0];

  if (!selected) {
    if (requestedAddress && listed.length > 0) {
      throw new Error(
        "The requested wallet does not match the KeeperHub signing wallet. " +
          "KeepGuard can only protect assets owned by its connected signer."
      );
    }
    if (listed.length > 1) {
      throw new Error(
        "Multiple KeeperHub wallet integrations were found. Set KEEPERHUB_WALLET_INTEGRATION_ID " +
          "to select the wallet KeepGuard should protect."
      );
    }
    throw new Error(
      "No KeeperHub signing wallet was found. Connect a wallet integration in KeeperHub first."
    );
  }

  const integration = await deps.getWalletIntegration(selected.id);
  const addresses = extractWalletAddresses(integration);
  if (selected.address) addresses.push(selected.address);
  const uniqueAddresses = [...new Set(addresses)];
  if (uniqueAddresses.length === 0) {
    throw new Error(
      "No KeeperHub signing wallet was found. Connect a wallet integration in KeeperHub first."
    );
  }
  if (requestedAddress && !uniqueAddresses.includes(requestedAddress.toLowerCase())) {
    throw new Error(
      "The requested wallet does not match the KeeperHub signing wallet. " +
        "KeepGuard can only protect assets owned by its connected signer."
    );
  }
  return requestedAddress || uniqueAddresses[0];
}

async function generateCreateValidateAndEnable(description, name, deps) {
  const generated = await deps.generateWorkflow(description);
  let workflowId = extractWorkflowId(generated);

  // Some KeeperHub versions persist AI-generated workflows and return an ID;
  // others return a draft. Support both without creating a duplicate.
  if (workflowId) {
    await deps.updateWorkflow(workflowId, { name, description, enabled: false });
  } else {
    const draft = extractWorkflowDraft(generated);
    const created = await deps.createWorkflow({
      name,
      description,
      nodes: draft.nodes,
      edges: draft.edges,
      enabled: false,
    });
    workflowId = extractWorkflowId(created);
  }

  if (!workflowId) {
    throw new Error(
      "KeeperHub created a workflow but did not return its workflow ID, so it was not enabled."
    );
  }

  const validation = await deps.validateWorkflow(workflowId, { deepCheck: true });
  const validationFailure = validationFailureMessage(validation);
  if (validationFailure) {
    const error = new Error(
      `Workflow ${workflowId} remains disabled because validation failed: ${validationFailure}`
    );
    error.workflowId = workflowId;
    throw error;
  }

  await deps.updateWorkflow(workflowId, { enabled: true });
  logger.info(SCOPE, "workflow provisioned and enabled", { name, workflowId });
  return { workflowId, name, enabled: true, validation };
}

export async function provisionRevoke(params, dependencyOverrides = {}) {
  if (!params || typeof params !== "object") throw new Error("Protection parameters are required.");
  const deps = { ...DEFAULT_DEPS, ...dependencyOverrides };
  const network = toChainId(params.chain);
  enforceNetworkPolicy(network);
  const walletAddress = await resolveKeeperHubWallet(params.walletAddress, deps);
  const resolvedParams = { ...params, walletAddress };
  validateRevokeParams(resolvedParams);
  const description = approvalWatchDescription({ ...resolvedParams, network });
  const result = await generateCreateValidateAndEnable(
    description,
    `KeepGuard — Approval Watch — ${walletAddress.slice(0, 8)}`,
    deps
  );
  return { ...result, walletAddress, network, mode: "revoke" };
}

export async function provisionStopLoss(params, dependencyOverrides = {}) {
  if (!params || typeof params !== "object") throw new Error("Protection parameters are required.");
  const deps = { ...DEFAULT_DEPS, ...dependencyOverrides };
  const network = toChainId(params.chain);
  enforceNetworkPolicy(network);
  const walletAddress = await resolveKeeperHubWallet(params.walletAddress, deps);
  const resolvedParams = { ...params, walletAddress };
  validateStopLossParams(resolvedParams);
  const description = stopLossDescription({ ...resolvedParams, network });
  const result = await generateCreateValidateAndEnable(
    description,
    `KeepGuard — Stop-Loss — ${walletAddress.slice(0, 8)}`,
    deps
  );
  return { ...result, walletAddress, network, mode: "stoploss" };
}

export async function getProtectionReadiness(dependencyOverrides = {}) {
  const deps = { ...DEFAULT_DEPS, ...dependencyOverrides };
  const walletAddress = await resolveKeeperHubWallet(undefined, deps);
  return {
    ready: Boolean(walletAddress),
    walletAddress,
    network: toChainId(process.env.KEEPERHUB_CHAIN || "sepolia"),
  };
}
