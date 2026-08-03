import test from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SPENDER,
  DEMO_TOKEN,
  demoApprovalCall,
  demoExecutionSummary,
  demoProtectionParams,
} from "../src/demo/sepoliaDemo.js";

test("guided demo uses fixed Sepolia-safe inputs", () => {
  assert.deepEqual(demoProtectionParams(123), {
    chain: "sepolia",
    tokenContract: DEMO_TOKEN,
    spenderWhitelist: [],
    telegramChatId: 123,
  });

  const call = demoApprovalCall({ simulate: true });
  assert.equal(call.chainId, "11155111");
  assert.equal(call.contractAddress, DEMO_TOKEN);
  assert.equal(call.functionName, "approve");
  assert.deepEqual(call.args, [DEMO_SPENDER, "1"]);
  assert.equal(call.simulate, true);
});

test("demo execution summary handles KeeperHub MCP envelopes", () => {
  const raw = {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          result: {
            executionId: "direct_demo_123",
            status: "completed",
            transactionHash: `0x${"a".repeat(64)}`,
          },
        }),
      },
    ],
  };
  assert.deepEqual(demoExecutionSummary(raw), {
    executionId: "direct_demo_123",
    status: "completed",
    txHash: `0x${"a".repeat(64)}`,
  });
});
