// Local preview of the future paid agent endpoint. Payment verification is
// intentionally not claimed as complete and public binding is blocked.

import "dotenv/config";
import { fileURLToPath } from "node:url";
import express from "express";
import { provisionRevoke, provisionStopLoss } from "../keeperhub/provision.js";
import { logger } from "../utils/logger.js";

const SCOPE = "x402.server";
const app = express();
app.use(express.json({ limit: "32kb" }));

app.get("/", (_req, res) => {
  res.json({
    service: "KeepGuard x402 preview",
    public: false,
    paymentVerification: "not implemented",
    endpoints: ["GET /health", "POST /protect"],
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "keepguard-x402-preview" });
});

const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

app.use("/protect", (req, res, next) => {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  hits.set(req.ip, recent);
  if (recent.length > MAX_PER_WINDOW) {
    return res.status(429).json({ error: "Too many requests. Retry in one minute." });
  }
  next();
});

// Development-only challenge. A non-empty header is not payment proof.
app.use("/protect", (req, res, next) => {
  if (!req.header("X-PAYMENT")) {
    return res.status(402).json({
      error: "Payment required",
      developmentPreview: true,
      priceUsdc: process.env.X402_PRICE_USDC,
      payTo: process.env.X402_PAY_TO_ADDRESS || null,
    });
  }
  next();
});

app.post("/protect", async (req, res) => {
  const { mode, params } = req.body || {};
  try {
    let result;
    if (mode === "revoke") result = await provisionRevoke(params);
    else if (mode === "stoploss") result = await provisionStopLoss(params);
    else return res.status(400).json({ error: "mode must be 'revoke' or 'stoploss'" });

    logger.info(SCOPE, "provisioned protection via local preview", { mode });
    return res.json({ ok: true, workflow: result });
  } catch (error) {
    logger.error(SCOPE, "provisioning failed", { error: error.message });
    return res.status(400).json({ error: error.message });
  }
});

export function startX402Server() {
  if (process.env.X402_PUBLIC === "true") {
    throw new Error(
      "Refusing to expose the x402 preview publicly until real payment verification is implemented."
    );
  }
  const port = process.env.X402_PORT || 4021;
  app.listen(port, "127.0.0.1", () =>
    logger.info(SCOPE, `x402 preview listening on 127.0.0.1:${port}`)
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    startX402Server();
  } catch (error) {
    logger.error(SCOPE, "x402 preview failed to start", { error: error.message });
    process.exitCode = 1;
  }
}
