import "dotenv/config";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Markup, Telegraf } from "telegraf";
import {
  getProtectionReadiness,
  provisionRevoke,
  provisionStopLoss,
} from "../keeperhub/provision.js";
import { formatAuditTrail } from "../audit/relay.js";
import { requireAllowedUser } from "./authz.js";
import { logger } from "../utils/logger.js";
import { assertAddress, assertPercent, assertPositiveNumber } from "../utils/validate.js";
import {
  broadcastDemoApproval,
  demoExecutionSummary,
  demoProtectionParams,
  simulateDemoApproval,
} from "../demo/sepoliaDemo.js";

const SCOPE = "telegram.bot";
const DEFAULT_CHAIN = process.env.KEEPERHUB_CHAIN || "sepolia";
const PENDING_TTL_MS = 10 * 60 * 1000;
const pendingActions = new Map();
const pendingDemoBroadcasts = new Map();
let bot;

function shortAddress(value) {
  return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "not connected";
}

function argsFrom(ctx) {
  return ctx.message.text.trim().split(/\s+/).slice(1);
}

function helpText() {
  return [
    "KeepGuard — automated wallet defense",
    "",
    "KeepGuard watches your KeeperHub wallet and responds to risky conditions onchain.",
    "Testing is locked to Sepolia unless the operator explicitly enables mainnet.",
    "",
    "Start here",
    "/status — verify KeeperHub, wallet, and network readiness",
    "/demo — run the guided Sepolia demo; no addresses needed",
    "/audit <executionId> — inspect an execution",
    "/help — show this guide",
    "",
    "Advanced setup",
    "/protect_revoke — custom approval protection",
    "/protect_stoploss — custom stop-loss protection",
    "",
    "No workflow is enabled without a preview and explicit confirmation.",
  ].join("\n");
}

function revokeUsage() {
  return [
    "Approval protection",
    "",
    "Usage:",
    "/protect_revoke <tokenContract> [trustedSpender1,trustedSpender2]",
    "",
    "The wallet and network come from your verified KeeperHub configuration.",
    "Example:",
    "/protect_revoke 0xTokenContract 0xTrustedSpender",
  ].join("\n");
}

function stopLossUsage() {
  return [
    "Stop-loss protection",
    "",
    "Usage:",
    "/protect_stoploss <assetContract> <priceFeed> <entryUsd> <dropPct> <stableContract>",
    "",
    "Example:",
    "/protect_stoploss 0xAsset 0xPriceFeed 2500 15 0xStable",
  ].join("\n");
}

function friendlyError(error) {
  const message = error?.message || "Unknown error";
  if (/401|unauthorized|api key/i.test(message)) {
    return "KeeperHub rejected the API key. Check KEEPERHUB_API_KEY and run /status again.";
  }
  if (/wallet integration|signing wallet/i.test(message)) {
    return `${message} Open KeeperHub, connect the organization wallet, then run /status.`;
  }
  if (/ENOTFOUND|ECONN|fetch failed|network/i.test(message)) {
    return "KeeperHub could not be reached. Check your connection and retry; no protection was enabled.";
  }
  return message;
}

function queueAction(ctx, mode, params, preview, options = {}) {
  const id = randomUUID();
  pendingActions.set(id, {
    id,
    mode,
    params,
    chatId: ctx.chat.id,
    userId: ctx.from.id,
    createdAt: Date.now(),
    ...options,
  });
  return ctx.reply(
    `${preview}\n\nReview this carefully. Confirm within 10 minutes, or cancel.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("Confirm protection", `kg_confirm:${id}`)],
      [Markup.button.callback("Cancel", `kg_cancel:${id}`)],
    ])
  );
}

function getPending(ctx, id) {
  const pending = pendingActions.get(id);
  if (!pending) throw new Error("This confirmation has expired or was already used.");
  if (pending.chatId !== ctx.chat.id || pending.userId !== ctx.from.id) {
    throw new Error("This confirmation belongs to a different user or chat.");
  }
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
    pendingActions.delete(id);
    throw new Error("This confirmation expired. Run the protection command again.");
  }
  return pending;
}

function registerHandlers(instance) {
  instance.use(requireAllowedUser());
  instance.start((ctx) =>
    ctx.reply(
      helpText(),
      Markup.inlineKeyboard([
        [Markup.button.callback("Run the Sepolia demo", "kg_demo")],
        [Markup.button.callback("Check readiness", "kg_status")],
        [Markup.button.callback("Set up approval protection", "kg_help:revoke")],
        [Markup.button.callback("Set up stop-loss protection", "kg_help:stoploss")],
      ])
    )
  );
  instance.help((ctx) => ctx.reply(helpText()));
  instance.action("kg_help:revoke", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(revokeUsage());
  });
  instance.action("kg_help:stoploss", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(stopLossUsage());
  });

  const showDemo = (ctx) =>
    ctx.reply(
      [
        "Guided Sepolia demo",
        "",
        "You do not need to find a token contract or understand trusted spenders.",
        "",
        "KeepGuard will:",
        "1. Use a standard WETH test contract on Sepolia.",
        "2. Watch your verified KeeperHub wallet.",
        "3. Simulate a harmless approval of 1 wei to a burn address.",
        "4. Ask you again before broadcasting the Sepolia approval.",
        "5. Detect it and revoke it through the KeeperHub workflow.",
        "",
        "No tokens are transferred. The wallet only needs enough Sepolia ETH for test gas.",
      ].join("\n"),
      Markup.inlineKeyboard([
        [Markup.button.callback("Create demo protection", "kg_demo_arm")],
        [Markup.button.callback("Check readiness first", "kg_status")],
      ])
    );

  instance.command("demo", showDemo);
  instance.action("kg_demo", async (ctx) => {
    await ctx.answerCbQuery();
    await showDemo(ctx);
  });
  instance.action("kg_demo_arm", async (ctx) => {
    await ctx.answerCbQuery();
    return queueAction(
      ctx,
      "revoke",
      demoProtectionParams(ctx.chat.id),
      [
        "Demo protection preview",
        "",
        "Network: Sepolia testnet",
        "Wallet: your verified KeeperHub signing wallet",
        "Asset: standard Sepolia WETH test contract",
        "Rule: revoke approvals to the demo burn address",
        "Setup transaction: none",
        "Later test transaction: approve 1 wei of allowance; no token transfer",
      ].join("\n"),
      { demo: true }
    );
  });

  const showStatus = async (ctx) => {
    try {
      const readiness = await getProtectionReadiness();
      const networkLabel = readiness.network === "11155111" ? "Sepolia (11155111)" : readiness.network;
      await ctx.reply(
        [
          "KeepGuard readiness",
          "",
          `Network: ${networkLabel}`,
          `KeeperHub API: ${process.env.KEEPERHUB_API_KEY ? "configured" : "missing"}`,
          `Signing wallet: ${readiness.ready ? shortAddress(readiness.walletAddress) : "not connected"}`,
          `Bot access control: ${process.env.TELEGRAM_ALLOWED_USER_IDS ? "enabled" : "missing"}`,
          `Mainnet lock: ${process.env.KEEPERHUB_ALLOW_MAINNET === "true" ? "disabled" : "enabled"}`,
          "x402: local preview only; real payment verification is not enabled",
          "",
          readiness.ready
            ? "Ready for a Sepolia protection preview. No transaction is sent by /status."
            : "Connect a KeeperHub signing wallet before creating protection.",
        ].join("\n")
      );
    } catch (error) {
      logger.error(SCOPE, "readiness check failed", { error: error.message });
      await ctx.reply(`Readiness check failed\n\n${friendlyError(error)}`);
    }
  };

  instance.command("status", showStatus);
  instance.action("kg_status", async (ctx) => {
    await ctx.answerCbQuery("Checking KeeperHub…");
    await showStatus(ctx);
  });

  instance.command("protect_revoke", async (ctx) => {
    const [tokenContract, whitelistCsv = ""] = argsFrom(ctx);
    if (!tokenContract) return ctx.reply(revokeUsage());
    const spenderWhitelist = whitelistCsv.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      assertAddress(tokenContract, "tokenContract");
      spenderWhitelist.forEach((address) => assertAddress(address, "trusted spender"));
    } catch (error) {
      return ctx.reply(`Check the command input\n\n${friendlyError(error)}\n\n${revokeUsage()}`);
    }
    return queueAction(
      ctx,
      "revoke",
      { chain: DEFAULT_CHAIN, tokenContract, spenderWhitelist, telegramChatId: ctx.chat.id },
      [
        "Protection preview — approval watch",
        "",
        `Network: ${DEFAULT_CHAIN}`,
        "Wallet: verified KeeperHub signing wallet",
        `Token: ${shortAddress(tokenContract)}`,
        `Trusted spenders: ${spenderWhitelist.length || "none — every approval will be revoked"}`,
        "Action: revoke approvals to spenders outside your trusted list.",
        "Cost: network gas may apply when triggered; setup does not submit that transaction.",
      ].join("\n")
    );
  });

  instance.command("protect_stoploss", async (ctx) => {
    const [assetContract, priceFeedContract, entryPriceUsd, thresholdPct, stableAssetContract] = argsFrom(ctx);
    if (!stableAssetContract) return ctx.reply(stopLossUsage());
    try {
      assertAddress(assetContract, "assetContract");
      assertAddress(priceFeedContract, "priceFeedContract");
      assertAddress(stableAssetContract, "stableAssetContract");
      assertPositiveNumber(entryPriceUsd, "entryPriceUsd");
      assertPercent(thresholdPct, "thresholdPct");
    } catch (error) {
      return ctx.reply(`Check the command input\n\n${friendlyError(error)}\n\n${stopLossUsage()}`);
    }
    return queueAction(
      ctx,
      "stoploss",
      {
        chain: DEFAULT_CHAIN,
        assetContract,
        priceFeedContract,
        entryPriceUsd: Number(entryPriceUsd),
        thresholdPct: Number(thresholdPct),
        stableAssetContract,
        telegramChatId: ctx.chat.id,
      },
      [
        "Protection preview — stop-loss",
        "",
        `Network: ${DEFAULT_CHAIN}`,
        "Wallet: verified KeeperHub signing wallet",
        `Asset: ${shortAddress(assetContract)}`,
        `Entry price: $${entryPriceUsd}`,
        `Trigger: price drops more than ${thresholdPct}%`,
        `Destination asset: ${shortAddress(stableAssetContract)}`,
        "Action: swap the available asset balance after the condition is met.",
        "Cost: swap and network fees may apply when triggered; setup does not submit that transaction.",
      ].join("\n")
    );
  });

  instance.action(/^kg_cancel:(.+)$/, async (ctx) => {
    try {
      const pending = getPending(ctx, ctx.match[1]);
      pendingActions.delete(pending.id);
      await ctx.answerCbQuery("Cancelled");
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      await ctx.reply("Protection setup cancelled. Nothing was enabled.");
    } catch (error) {
      await ctx.answerCbQuery(friendlyError(error), { show_alert: true });
    }
  });

  instance.action(/^kg_confirm:(.+)$/, async (ctx) => {
    try {
      const pending = getPending(ctx, ctx.match[1]);
      pendingActions.delete(pending.id);
      await ctx.answerCbQuery("Creating and validating…");
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      const progress = await ctx.reply(
        "Creating the workflow disabled, validating it with KeeperHub, then enabling it…"
      );
      const result = pending.mode === "revoke"
        ? await provisionRevoke(pending.params)
        : await provisionStopLoss(pending.params);
      const successText = [
        "Protection active",
        "",
        `Mode: ${pending.demo ? "guided approval demo" : pending.mode === "revoke" ? "approval watch" : "stop-loss"}`,
        `Network: ${result.network === "11155111" ? "Sepolia (11155111)" : result.network}`,
        `Wallet: ${shortAddress(result.walletAddress)}`,
        `Workflow: ${result.workflowId}`,
        "Validation: passed",
        "Status: enabled",
        "",
        pending.demo
          ? "Next: simulate the harmless demo approval. Simulation does not sign or broadcast."
          : "Next: trigger the Sepolia test condition, then use /audit <executionId>.",
      ].join("\n");
      const successMarkup = pending.demo
        ? Markup.inlineKeyboard([
            [Markup.button.callback("Simulate demo approval", `kg_demo_simulate:${result.workflowId}`)],
          ])
        : undefined;
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progress.message_id,
        undefined,
        successText,
        successMarkup
      );
    } catch (error) {
      logger.error(SCOPE, "protection setup failed", { error: error.message });
      await ctx.reply(
        `Protection was not enabled\n\n${friendlyError(error)}\n\nFix the issue, run /status, and retry.`
      );
    }
  });

  instance.action(/^kg_demo_simulate:(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery("Simulating…");
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      const progress = await ctx.reply("Simulating the 1-wei Sepolia approval. Nothing is being signed or broadcast…");
      const simulation = demoExecutionSummary(await simulateDemoApproval());
      if (/fail|revert|error/i.test(String(simulation.status))) {
        throw new Error(`KeeperHub simulation returned status: ${simulation.status}`);
      }

      const id = randomUUID();
      pendingDemoBroadcasts.set(id, {
        id,
        workflowId: ctx.match[1],
        chatId: ctx.chat.id,
        userId: ctx.from.id,
        createdAt: Date.now(),
      });
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progress.message_id,
        undefined,
        [
          "Simulation passed",
          "",
          "The next confirmation broadcasts one real Sepolia transaction through KeeperHub:",
          "Action: approve 1 wei of WETH allowance to the demo burn address",
          "Token transfer: none",
          "Cost: Sepolia test gas only",
          "",
          "KeepGuard should detect the Approval event and revoke it automatically.",
        ].join("\n"),
        Markup.inlineKeyboard([
          [Markup.button.callback("Broadcast Sepolia test", `kg_demo_broadcast:${id}`)],
          [Markup.button.callback("Cancel", `kg_demo_broadcast_cancel:${id}`)],
        ])
      );
    } catch (error) {
      logger.error(SCOPE, "demo simulation failed", { error: error.message });
      await ctx.reply(`Simulation failed\n\n${friendlyError(error)}\n\nNo transaction was broadcast.`);
    }
  });

  instance.action(/^kg_demo_broadcast_cancel:(.+)$/, async (ctx) => {
    const pending = pendingDemoBroadcasts.get(ctx.match[1]);
    if (pending?.chatId === ctx.chat.id && pending?.userId === ctx.from.id) {
      pendingDemoBroadcasts.delete(pending.id);
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    }
    await ctx.answerCbQuery("Cancelled");
    await ctx.reply("Sepolia test cancelled. No transaction was broadcast.");
  });

  instance.action(/^kg_demo_broadcast:(.+)$/, async (ctx) => {
    const pending = pendingDemoBroadcasts.get(ctx.match[1]);
    try {
      if (!pending || pending.chatId !== ctx.chat.id || pending.userId !== ctx.from.id) {
        throw new Error("This demo confirmation expired or belongs to another chat.");
      }
      if (Date.now() - pending.createdAt > PENDING_TTL_MS) {
        pendingDemoBroadcasts.delete(pending.id);
        throw new Error("This demo confirmation expired. Run /demo again.");
      }
      pendingDemoBroadcasts.delete(pending.id);
      await ctx.answerCbQuery("Broadcasting on Sepolia…");
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
      const progress = await ctx.reply("Broadcasting the test approval through KeeperHub…");
      const summary = demoExecutionSummary(
        await broadcastDemoApproval(`keepguard-demo-${pending.id}`)
      );
      const lines = [
        "Sepolia test approval submitted",
        "",
        `Status: ${summary.status}`,
        summary.executionId ? `Execution: ${summary.executionId}` : null,
        summary.txHash ? `Transaction: ${summary.txHash}` : null,
        summary.txHash ? `Explorer: https://sepolia.etherscan.io/tx/${summary.txHash}` : null,
        "",
        "KeepGuard should now detect and revoke this approval. Open the workflow's Runs tab in KeeperHub to watch the automatic execution.",
        summary.executionId ? `You can also send: /audit ${summary.executionId}` : null,
      ].filter(Boolean);
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        progress.message_id,
        undefined,
        lines.join("\n")
      );
    } catch (error) {
      logger.error(SCOPE, "demo broadcast failed", { error: error.message });
      await ctx.reply(`Sepolia test failed\n\n${friendlyError(error)}\n\nCheck /status and retry /demo.`);
    }
  });

  instance.command("audit", async (ctx) => {
    const [executionId] = argsFrom(ctx);
    if (!executionId) return ctx.reply("Usage: /audit <executionId>");
    try {
      await ctx.reply("Fetching the KeeperHub execution trail…");
      await ctx.reply(await formatAuditTrail(executionId));
    } catch (error) {
      await ctx.reply(`Audit unavailable\n\n${friendlyError(error)}\n\nCheck the execution ID and retry.`);
    }
  });

  instance.catch((error) => {
    logger.error(SCOPE, "unhandled Telegram update error", { error: error.message });
  });
}

function getBot() {
  if (bot) return bot;
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured.");
  }
  bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
  registerHandlers(bot);
  return bot;
}

export async function startBot() {
  const instance = getBot();
  await instance.telegram.setMyCommands([
    { command: "start", description: "Open the guided KeepGuard menu" },
    { command: "status", description: "Check KeeperHub and Sepolia readiness" },
    { command: "demo", description: "Run the guided Sepolia demo" },
    { command: "protect_revoke", description: "Preview approval protection" },
    { command: "protect_stoploss", description: "Preview stop-loss protection" },
    { command: "audit", description: "View a KeeperHub execution trail" },
    { command: "help", description: "Show commands and safety guidance" },
  ]);
  await instance.launch();
  logger.info(SCOPE, "bot started");
  process.once("SIGINT", () => instance.stop("SIGINT"));
  process.once("SIGTERM", () => instance.stop("SIGTERM"));
  return instance;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBot().catch((error) => {
    logger.error(SCOPE, "bot failed to start", { error: error.message });
    process.exitCode = 1;
  });
}
