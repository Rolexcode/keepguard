import { startBot } from "./telegram/bot.js";
import { startX402Server } from "./x402/server.js";
import { logger } from "./utils/logger.js";

startBot();
startX402Server();
logger.info("index", "KeepGuard running (Telegram + x402 surfaces)");
