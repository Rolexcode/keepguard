import "dotenv/config";
import { getProtectionReadiness } from "../keeperhub/provision.js";
import { closeMcpClient } from "../keeperhub/mcpClient.js";
import { toChainId } from "../keeperhub/workflowTemplates.js";

function requireConfig(name) {
  if (!process.env[name]) throw new Error(`${name} is not configured.`);
}

function shortAddress(value) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

async function checkTelegram() {
  requireConfig("TELEGRAM_BOT_TOKEN");
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`,
        { signal: AbortSignal.timeout(15_000) }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) {
        throw new Error("Telegram rejected the configured bot token.");
      }
      return payload.result?.username ?? "connected bot";
    } catch (error) {
      lastError = error;
    }
  }
  if (/rejected/.test(lastError?.message || "")) throw lastError;
  throw new Error("Telegram could not be reached after two attempts.");
}

async function main() {
  requireConfig("KEEPERHUB_API_KEY");
  requireConfig("TELEGRAM_ALLOWED_USER_IDS");

  const chainId = toChainId(process.env.KEEPERHUB_CHAIN || "sepolia");
  if (chainId !== "11155111") {
    throw new Error(`Readiness requires Sepolia (11155111); configured chain is ${chainId}.`);
  }
  if (process.env.KEEPERHUB_ALLOW_MAINNET === "true") {
    throw new Error("Mainnet is currently unlocked. Set KEEPERHUB_ALLOW_MAINNET=false for testing.");
  }
  if (process.env.X402_PUBLIC === "true") {
    throw new Error("X402_PUBLIC must remain false until payment verification is implemented.");
  }

  console.log("Local safety configuration: passed");
  const keeperHub = await getProtectionReadiness();
  if (!keeperHub.ready || !keeperHub.walletAddress) {
    throw new Error("KeeperHub is reachable but no signing wallet integration was found.");
  }
  console.log(`KeeperHub wallet: ${shortAddress(keeperHub.walletAddress)}`);
  await closeMcpClient();

  const telegramUsername = await checkTelegram();
  console.log(`Telegram: @${telegramUsername}`);

  console.log("KeepGuard preflight passed");
  console.log("Network: Sepolia (11155111)");
  console.log("Mainnet lock: enabled");
  console.log("x402 public exposure: disabled");
  console.log("No workflow or transaction was created by this check.");
}

main()
  .catch((error) => {
    console.error(`KeepGuard preflight failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await closeMcpClient();
    } catch {
      // The original preflight error is more useful than a cleanup failure.
    }
  });
