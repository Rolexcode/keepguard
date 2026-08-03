import test from "node:test";
import assert from "node:assert/strict";
import {
  extractWalletAddresses,
  extractWalletIntegrations,
  extractWorkflowDraft,
  extractWorkflowId,
  unwrapToolResult,
  validationFailureMessage,
} from "../src/keeperhub/response.js";

function content(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

test("unwrapToolResult handles MCP content and KeeperHub envelopes", () => {
  assert.deepEqual(unwrapToolResult(content({ ok: true, result: { valid: true } })), {
    valid: true,
  });
});

test("workflow and wallet helpers extract current response shapes", () => {
  const draft = { nodes: [{ id: "trigger" }], edges: [] };
  assert.deepEqual(extractWorkflowDraft(content({ result: { workflow: draft } })), draft);
  assert.equal(extractWorkflowId(content({ result: { workflowId: "wf_test_123" } })), "wf_test_123");
  assert.deepEqual(
    extractWalletAddresses(content({ result: { integration: { walletAddress: "0x1111111111111111111111111111111111111111" } } })),
    ["0x1111111111111111111111111111111111111111"]
  );
  assert.deepEqual(
    extractWalletIntegrations(
      content({ result: [{ id: "int_1", name: "Wallet", type: "turnkey", address: "0x1111111111111111111111111111111111111111" }] })
    ),
    [{ id: "int_1", name: "Wallet", type: "turnkey", address: "0x1111111111111111111111111111111111111111" }]
  );
});

test("validation helper returns typed KeeperHub errors", () => {
  assert.equal(validationFailureMessage(content({ result: { valid: true } })), null);
  assert.equal(
    validationFailureMessage(content({ result: { valid: false, errors: [{ message: "missing trigger" }] } })),
    "missing trigger"
  );
});
