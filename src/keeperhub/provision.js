// Shared provisioning flow: describe -> generate -> validate -> create.
// Used by both the Telegram bot (human-triggered) and the x402 endpoint
// (agent-triggered, paid per call) so the two surfaces share one code path
// instead of drifting apart.

import { generateWorkflow, validateWorkflow, createWorkflow } from "./mcpClient.js";
import { approvalWatchDescription, stopLossDescription, toChainId } from "./workflowTemplates.js";
import { validateRevokeParams, validateStopLossParams } from "../utils/validate.js";
import { logger } from "../utils/logger.js";

const SCOPE = "keeperhub.provision";

async function generateValidateAndCreate(description, name) {
  const generated = await generateWorkflow(description);
  const draft = JSON.parse(generated.content?.[0]?.text ?? "{}");

  const validation = await validateWorkflow(draft);
  const validationText = validation.content?.[0]?.text ?? "";
  if (validation.isError || /invalid|error/i.test(validationText)) {
    throw new Error(`Generated workflow failed validation: ${validationText}`);
  }

  const created = await createWorkflow({
    name,
    nodes: draft.nodes,
    edges: draft.edges,
    enabled: true,
  });

  logger.info(SCOPE, "workflow provisioned", { name });
  return created;
}

export async function provisionRevoke(params) {
  validateRevokeParams(params);
  const network = toChainId(params.chain);
  const description = approvalWatchDescription({ ...params, network });
  return generateValidateAndCreate(
    description,
    `KeepGuard — Approval Watch — ${params.walletAddress.slice(0, 8)}`
  );
}

export async function provisionStopLoss(params) {
  validateStopLossParams(params);
  const network = toChainId(params.chain);
  const description = stopLossDescription({ ...params, network });
  return generateValidateAndCreate(
    description,
    `KeepGuard — Stop-Loss — ${params.walletAddress.slice(0, 8)}`
  );
}
