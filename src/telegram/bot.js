// Telegram front-end. A chat-driven agent that takes a command, decides
// what to do, and executes it — routing execution through KeeperHub
// instead of firing a transaction directly.

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { Telegraf } from "telegraf";
import { provisionRevoke, provisionStopLoss } from "../keeperhub/provision.js";
import { formatAuditTrail } from "../audit/relay.js";
import { requireAllowedUser } from "./authz.js";
import { logger } from "../utils/logger.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const SCOPE = "telegram.bot";

// Every command below touches the wallet or reads its activity — gate all of them.
bot.use(requireAllowedUser());

bot.start((ctx) =>
  ctx.reply(
    "🛡️ KeepGuard\n\n" +
      "I watch a wallet and act automatically through KeeperHub when something risky happens.\n\n" +
      "Commands:\n" +
      "/protect_revoke <chain> <wallet> <tokenContract> <whitelistCsv>\n" +
      "/protect_stoploss <chain> <wallet> <assetContract> <priceFeed> <entryUsd> <thresholdPct> <stableContract>\n" +
      "/audit <executionId>"
  )
);

bot.command("protect_revoke", async (ctx) => {
  const [, chain, walletAddress, tokenContract, whitelistCsv = ""] =
    ctx.message.text.split(" ");

  if (!chain || !walletAddress || !tokenContract) {
    return ctx.reply(
      "Usage: /protect_revoke <chain> <wallet> <tokenContract> <whitelistCsv>"
    );
  }

  try {
    const result = await provisionRevoke({
      chain,
      walletAddress,
      tokenContract,
      spenderWhitelist: whitelistCsv.split(",").filter(Boolean),
      telegramChatId: ctx.chat.id,
    });

    logger.info(SCOPE, "approval-watch workflow created", { walletAddress });
    await ctx.reply(
      `✅ Watching ${walletAddress}. Any approval to a spender outside your whitelist gets revoked automatically via KeeperHub.\n\n${
        result.content?.[0]?.text ?? "workflow created"
      }`
    );
  } catch (err) {
    logger.error(SCOPE, "failed to create approval-watch workflow", { error: err.message });
    await ctx.reply(`❌ Couldn't set that up: ${err.message}`);
  }
});

bot.command("protect_stoploss", async (ctx) => {
  const [
    ,
    chain,
    walletAddress,
    assetContract,
    priceFeedContract,
    entryPriceUsd,
    thresholdPct,
    stableAssetContract,
  ] = ctx.message.text.split(" ");

  if (!stableAssetContract) {
    return ctx.reply(
      "Usage: /protect_stoploss <chain> <wallet> <assetContract> <priceFeed> <entryUsd> <thresholdPct> <stableContract>"
    );
  }

  try {
    const result = await provisionStopLoss({
      chain,
      walletAddress,
      assetContract,
      priceFeedContract,
      entryPriceUsd: Number(entryPriceUsd),
      thresholdPct: Number(thresholdPct),
      stableAssetContract,
      telegramChatId: ctx.chat.id,
    });

    logger.info(SCOPE, "stop-loss workflow created", { walletAddress });
    await ctx.reply(
      `✅ Stop-loss armed for ${walletAddress}. Drop below -${thresholdPct}% and I swap into your stable asset automatically via KeeperHub.\n\n${
        result.content?.[0]?.text ?? "workflow created"
      }`
    );
  } catch (err) {
    logger.error(SCOPE, "failed to create stop-loss workflow", { error: err.message });
    await ctx.reply(`❌ Couldn't set that up: ${err.message}`);
  }
});

bot.command("audit", async (ctx) => {
  const [, executionId] = ctx.message.text.split(" ");
  if (!executionId) return ctx.reply("Usage: /audit <executionId>");

  try {
    const trail = await formatAuditTrail(executionId);
    await ctx.replyWithMarkdown(trail);
  } catch (err) {
    await ctx.reply(`❌ Couldn't fetch audit trail: ${err.message}`);
  }
});

export function startBot() {
  bot.launch();
  logger.info(SCOPE, "bot started");
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

// Runs the bot when this file is executed directly (`node src/telegram/bot.js`
// or `npm run bot`) — not just when imported and started from index.js.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startBot();
}
