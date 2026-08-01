// Exposes protection as a pay-per-call HTTP endpoint, gated by x402.
// This turns KeepGuard from "a bot I run for myself" into infrastructure
// another autonomous agent can pay to use.
//
// SECURITY — read before deploying anywhere public:
// 1. The payment check below is a STUB. It checks that an X-PAYMENT header
//    is present, not that a real payment happened. Until the real x402
//    middleware (see TODO below) is wired in, this endpoint provisions
//    workflows against your wallet for FREE to anyone who sends any value
//    in that header. Do not point a public domain at this until that's fixed.
// 2. Because of #1, this binds to 127.0.0.1 (localhost only) by default.
//    Set X402_PUBLIC=true only after the real payment middleware is in.
// 3. A basic in-memory rate limiter is included as defense in depth — it
//    is not a substitute for #1, just a second layer.
//
// npm install express dotenv
// npm install <the confirmed x402 middleware package — see x402.org docs>

import "dotenv/config";
import { fileURLToPath } from "node:url";
import express from "express";
// import { paymentMiddleware } from "<confirmed-x402-package>";
import { provisionRevoke, provisionStopLoss } from "../keeperhub/provision.js";
import { logger } from "../utils/logger.js";

const SCOPE = "x402.server";
const app = express();
app.use(express.json());

// --- Minimal rate limiter (defense in depth, not a replacement for real auth) ---
const hits = new Map(); // ip -> [timestamps]
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

app.use("/protect", (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  if (recent.length > MAX_PER_WINDOW) {
    return res.status(429).json({ error: "Too many requests, slow down." });
  }
  next();
});

// --- Payment gate (STUB — see warning above) --------------------------
app.use("/protect", (req, res, next) => {
  const paid = req.header("X-PAYMENT");
  if (!paid) {
    return res.status(402).json({
      error: "Payment required",
      priceUsdc: process.env.X402_PRICE_USDC,
      payTo: process.env.X402_PAY_TO_ADDRESS,
    });
  }
  next();
});
// -----------------------------------------------------------------------

app.post("/protect", async (req, res) => {
  const { mode, params } = req.body;

  try {
    let result;
    if (mode === "revoke") {
      result = await provisionRevoke(params);
    } else if (mode === "stoploss") {
      result = await provisionStopLoss(params);
    } else {
      return res.status(400).json({ error: "mode must be 'revoke' or 'stoploss'" });
    }

    logger.info(SCOPE, "provisioned protection via paid call", { mode });
    res.json({ ok: true, workflow: result.content?.[0]?.text ?? result });
  } catch (err) {
    logger.error(SCOPE, "provisioning failed", { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

export function startX402Server() {
  const port = process.env.X402_PORT || 4021;
  const isPublic = process.env.X402_PUBLIC === "true";
  const host = isPublic ? "0.0.0.0" : "127.0.0.1";

  if (isPublic) {
    logger.warn(
      SCOPE,
      "X402_PUBLIC=true — binding to all interfaces. Confirm the real payment " +
        "middleware is wired in before this is reachable from the internet."
    );
  }

  app.listen(port, host, () =>
    logger.info(SCOPE, `x402 server listening on ${host}:${port}`)
  );
}

// Runs the server when this file is executed directly (`node src/x402/server.js`
// or `npm run x402`) — not just when imported and started from index.js.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startX402Server();
}
