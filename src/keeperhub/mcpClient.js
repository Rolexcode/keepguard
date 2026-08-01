// Talks to KeeperHub's hosted MCP server (https://app.keeperhub.com/mcp)
// using the official MCP TypeScript/JS SDK. Auth is a Bearer org API key
// (kh_ prefix).
//
// Tool names below are CONFIRMED against docs.keeperhub.com/ai-tools/mcp-server
// (fetched directly, not guessed) — the server registers 30+ tools; these are
// the ones KeepGuard actually uses.
//
// npm install @modelcontextprotocol/sdk

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "../utils/logger.js";

const SCOPE = "keeperhub.mcp";

let clientPromise = null;

function getClient() {
  if (clientPromise) return clientPromise;

  clientPromise = (async () => {
    const url = new URL(process.env.KEEPERHUB_MCP_URL || "https://app.keeperhub.com/mcp");
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: {
        headers: {
          Authorization: `Bearer ${process.env.KEEPERHUB_API_KEY}`,
        },
      },
    });

    const client = new Client(
      { name: "keepguard", version: "0.1.0" },
      { capabilities: {} }
    );

    await client.connect(transport);
    logger.info(SCOPE, "connected to KeeperHub MCP server");
    return client;
  })();

  return clientPromise;
}

async function callTool(toolName, args) {
  const client = await getClient();
  logger.info(SCOPE, `calling ${toolName}`, { args });
  const result = await client.callTool({ name: toolName, arguments: args });
  logger.info(SCOPE, `${toolName} result`, { result });
  return result;
}

// --- Workflow management ---------------------------------------------
export const listWorkflows = (params = {}) => callTool("list_workflows", params);
export const getWorkflow = (workflowId) => callTool("get_workflow", { workflowId });
export const createWorkflow = (workflow) => callTool("create_workflow", workflow);
export const updateWorkflow = (workflowId, patch) =>
  callTool("update_workflow", { workflowId, ...patch });
export const deleteWorkflow = (workflowId) => callTool("delete_workflow", { workflowId });
export const validateWorkflow = (workflow) => callTool("validate_workflow", workflow);

// --- AI generation ------------------------------------------------------
// The big one: describe the automation in plain English, get back real
// nodes/edges instead of us hand-authoring the flow-graph JSON ourselves.
export const generateWorkflow = (description) =>
  callTool("ai_generate_workflow", { description });

// --- Execution ------------------------------------------------------------
export const executeWorkflow = (workflowId, input = {}) =>
  callTool("execute_workflow", { workflowId, input });

// Combined status + logs in one call (KeeperHub merged what used to be two).
export const getExecution = (executionId) => callTool("get_execution", { executionId });

// --- Direct on-chain execution (no workflow needed) ------------------------
// Useful for one-off actions triggered straight from a Telegram command,
// e.g. "revoke this approval right now" without waiting on an event trigger.
export const executeContractCall = ({ network, contractAddress, abi, abiFunction, args = [] }) =>
  callTool("execute_contract_call", { network, contractAddress, abi, abiFunction, args });

export const executeTransfer = ({ network, recipientAddress, amount, tokenConfig }) =>
  callTool("execute_transfer", { network, recipientAddress, amount, tokenConfig });

export const getDirectExecutionStatus = (executionId) =>
  callTool("get_direct_execution_status", { executionId });

// --- Protocol actions (DeFi) — useful for the stop-loss swap ---------------
export const searchProtocolActions = (query) => callTool("search_protocol_actions", { query });
export const executeProtocolAction = (actionType, params) =>
  callTool("execute_protocol_action", { actionType, ...params });

// --- Discovery / docs -------------------------------------------------------
export const listActionSchemas = (category) => callTool("list_action_schemas", { category });
export const toolsDocumentation = () => callTool("tools_documentation", {});

// --- Wallet integration check (required before any write action) ----------
export const getWalletIntegration = () => callTool("get_wallet_integration", {});
