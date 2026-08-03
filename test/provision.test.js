import test from "node:test";
import assert from "node:assert/strict";
import { provisionRevoke, provisionStopLoss } from "../src/keeperhub/provision.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SPENDER = "0x3333333333333333333333333333333333333333";
const FEED = "0x4444444444444444444444444444444444444444";
const STABLE = "0x5555555555555555555555555555555555555555";

function mcp(payload) {
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, result: payload }) }] };
}

function happyDeps(calls) {
  return {
    listIntegrations: async () => {
      calls.push(["integrations"]);
      return mcp([{ id: "int_wallet", name: "Test wallet", type: "turnkey", address: WALLET }]);
    },
    getWalletIntegration: async (integrationId) => {
      assert.equal(integrationId, "int_wallet");
      calls.push(["wallet"]);
      return mcp({ walletAddress: WALLET });
    },
    generateWorkflow: async (description) => {
      calls.push(["generate", description]);
      return mcp({ nodes: [{ id: "trigger", type: "trigger" }], edges: [] });
    },
    createWorkflow: async (workflow) => {
      calls.push(["create", workflow]);
      return mcp({ workflowId: "wf_test_123" });
    },
    validateWorkflow: async (workflowId) => {
      calls.push(["validate", workflowId]);
      return mcp({ valid: true, nodeCount: 1 });
    },
    updateWorkflow: async (workflowId, patch) => {
      calls.push(["update", workflowId, patch]);
      return mcp({ workflowId, ...patch });
    },
  };
}

test("approval protection creates disabled, validates by ID, then enables", async () => {
  const calls = [];
  const result = await provisionRevoke(
    { chain: "sepolia", tokenContract: TOKEN, spenderWhitelist: [SPENDER], telegramChatId: 1 },
    happyDeps(calls)
  );

  assert.equal(result.workflowId, "wf_test_123");
  assert.equal(result.walletAddress, WALLET);
  assert.deepEqual(calls.map(([name]) => name), ["integrations", "wallet", "generate", "create", "validate", "update"]);
  assert.equal(calls[3][1].enabled, false);
  assert.deepEqual(calls[5].slice(1), ["wf_test_123", { enabled: true }]);
});

test("a wallet mismatch is rejected before workflow generation", async () => {
  const calls = [];
  await assert.rejects(
    provisionRevoke(
      {
        chain: "sepolia",
        walletAddress: "0x9999999999999999999999999999999999999999",
        tokenContract: TOKEN,
        spenderWhitelist: [],
        telegramChatId: 1,
      },
      happyDeps(calls)
    ),
    /does not match/
  );
  assert.deepEqual(calls.map(([name]) => name), ["integrations"]);
});

test("a failed validation leaves the stored workflow disabled", async () => {
  const calls = [];
  const deps = happyDeps(calls);
  deps.validateWorkflow = async (workflowId) => {
    calls.push(["validate", workflowId]);
    return mcp({ valid: false, errors: [{ message: "missing trigger configuration" }] });
  };

  await assert.rejects(
    provisionStopLoss(
      {
        chain: "sepolia",
        assetContract: TOKEN,
        priceFeedContract: FEED,
        entryPriceUsd: 100,
        thresholdPct: 10,
        stableAssetContract: STABLE,
        telegramChatId: 1,
      },
      deps
    ),
    /remains disabled/
  );
  assert.equal(calls.some(([name]) => name === "update"), false);
  assert.equal(calls.find(([name]) => name === "create")[1].enabled, false);
});

test("mainnet remains locked by default", async () => {
  const previous = process.env.KEEPERHUB_ALLOW_MAINNET;
  delete process.env.KEEPERHUB_ALLOW_MAINNET;
  const calls = [];
  try {
    await assert.rejects(
      provisionRevoke(
        { chain: "ethereum", tokenContract: TOKEN, spenderWhitelist: [], telegramChatId: 1 },
        happyDeps(calls)
      ),
      /Mainnet protection is locked/
    );
    assert.equal(calls.length, 0);
  } finally {
    if (previous == null) delete process.env.KEEPERHUB_ALLOW_MAINNET;
    else process.env.KEEPERHUB_ALLOW_MAINNET = previous;
  }
});
