import { startBot } from "./telegram/bot.js";
import { startX402Server } from "./x402/server.js";
import { logger } from "./utils/logger.js";

startX402Server();
startBot()
  .then(() => logger.info("index", "KeepGuard running (Telegram + local x402 preview)"))
  .catch((error) => {
    logger.error("index", "KeepGuard failed to start", { error: error.message });
    process.exitCode = 1;
  });
