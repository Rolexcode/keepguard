// Entry point for deploying to Render's free "Web Service" tier.
//
// Render's free tier requires the app to bind a port and respond to
// health checks — but the Telegram bot itself uses long-polling and
// doesn't need a port at all. This file starts the bot AND a bare
// health-check HTTP server side by side, so Render sees a healthy
// listening port while the actual work happens over Telegram.
//
// Deliberately does NOT start the x402 server here — that endpoint's
// payment check is still a stub (see SECURITY.md) and isn't safe to
// expose on a public Render URL yet. Deploy that separately, later,
// once the real payment middleware is wired in.

import "dotenv/config";
import http from "node:http";
import { startBot } from "./telegram/bot.js";
import { logger } from "./utils/logger.js";

const SCOPE = "render-entry";

const port = process.env.PORT || 3000; // Render sets PORT itself
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("KeepGuard bot is running.");
  })
  .listen(port, "0.0.0.0", () => {
    logger.info(SCOPE, `health-check server listening on 0.0.0.0:${port}`);
  });

startBot();