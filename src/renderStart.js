// Render entry point: Telegram long-polling plus a small public health server.
// The external /health request is also suitable for an uptime monitor.

import "dotenv/config";
import http from "node:http";
import { startBot } from "./telegram/bot.js";
import { logger } from "./utils/logger.js";

const SCOPE = "render-entry";
const port = process.env.PORT || 3000;
let botReady = false;
let botError = null;

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/ready") {
    return sendJson(res, botReady ? 200 : 503, {
      service: "keepguard",
      ready: botReady,
      network: process.env.KEEPERHUB_CHAIN || "sepolia",
      bot: botReady ? "connected" : "starting",
      error: botError,
    });
  }

  if (req.url === "/") {
    return sendJson(res, 200, {
      name: "KeepGuard",
      description: "Automated wallet defense through KeeperHub",
      ready: botReady,
      network: process.env.KEEPERHUB_CHAIN || "sepolia",
      telegram: process.env.TELEGRAM_BOT_USERNAME || "@keepguardbot",
      health: "/health",
    });
  }

  return sendJson(res, 404, { error: "Not found", health: "/health" });
});

server.listen(port, "0.0.0.0", () => {
  logger.info(SCOPE, `health server listening on 0.0.0.0:${port}`);
});

startBot({
  onRuntimeError: (error) => {
    botReady = false;
    botError = error.message;
  },
})
  .then(() => {
    botReady = true;
    logger.info(SCOPE, "Telegram bot is ready");
  })
  .catch((error) => {
    botError = error.message;
    logger.error(SCOPE, "Telegram bot failed to start", { error: error.message });
    process.exitCode = 1;
  });

process.once("SIGTERM", () => {
  server.close(() => logger.info(SCOPE, "health server stopped"));
});
