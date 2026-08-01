# Security notes

This is a plain-language account of what could go wrong with KeepGuard, what
already protects against it, and what's still open. Written for anyone
reviewing the code — including hackathon judges.

## Who holds the private key?

**Not KeepGuard, and not KeeperHub either, really.**

Your wallet is created through [Turnkey](https://www.turnkey.com), which
generates the private key *inside* a hardware-secured enclave (a TEE —
Trusted Execution Environment). The key is created there, used there for
signing, and never leaves. Per KeeperHub's own engineering writeup: what
they store is the wallet address, a sub-organization ID, and a wallet ID —
never the key itself. It never touches their database, their logs, or
their servers' memory.

KeepGuard sits one layer further out than that. It never sees a private
key, never asks for one, and has no code path that could handle one. Every
action KeepGuard requests goes through KeeperHub's API, which is the only
thing that ever talks to the enclave.

**Practical effect:** even if someone fully compromised the machine running
KeepGuard, they would not obtain a private key from it — there isn't one
there to take. The real asset to protect is the **KeeperHub API key**
(`kh_` prefix), because that key can *direct* the wallet to act, even
though it can't extract the wallet's private key.

## What actually needs protecting

Given the above, the real attack surface is: **who can get KeepGuard to ask
KeeperHub to do something?** Two entry points do that — the Telegram bot
and the x402 HTTP endpoint. Both were reviewed and hardened:

### 1. Telegram bot — was open to anyone, now allowlisted

**Before:** any user who found the bot's Telegram username could run
`/protect_revoke` or `/protect_stoploss` and create a workflow against your
org's wallet. No check existed.

**Now:** `src/telegram/authz.js` gates every command behind
`TELEGRAM_ALLOWED_USER_IDS`. It fails *closed* — if that variable is empty,
the bot refuses everyone, rather than defaulting to open. You set your own
Telegram user ID (from @userinfobot) before the bot will do anything.

### 2. x402 endpoint — payment check was a non-functional stub

**Before:** the `/protect` route only checked that an `X-PAYMENT` header
was present — not that it represented a real, verified payment. Combined
with the server listening on all network interfaces by default, this meant
anyone reachable over the network could provision workflows for free.

**Now, two layers:**
- The server binds to `127.0.0.1` (localhost only) unless you explicitly
  set `X402_PUBLIC=true` — so it isn't reachable from outside your machine
  by default.
- A basic rate limiter (10 requests/minute/IP) is in as a second layer.

**Still open, and clearly marked in the code:** the payment verification
itself is still a placeholder. Before this endpoint is ever exposed
publicly (`X402_PUBLIC=true`), the real x402 middleware needs to be wired
in — see the `TODO` at the top of `src/x402/server.js`. Don't flip that
flag until it's done.

### 3. Input validation

Both entry points now run wallet/contract addresses through a format check
(`src/utils/validate.js`) and sanity-check numeric inputs (stop-loss
threshold between 0–100%, entry price positive) before anything gets
turned into a workflow description. This doesn't replace KeeperHub's own
`validate_workflow` check — it just catches obviously bad input (a typo'd
address, a nonsense percentage) earlier, with a clearer error.

## Patterns already safe by design

- **The API key is never logged.** It's passed once, into the MCP
  transport's auth header — it never appears in the `args` objects that
  `logger.js` prints for each tool call.
- **The CLI wrapper (`cliClient.js`) is not vulnerable to command
  injection.** It calls `execFile("kh", [...args])` — Node's `execFile`
  does not invoke a shell unless explicitly told to, so user-controlled
  values in `args` can't break out into arbitrary shell commands the way
  they could with a string-interpolated `exec()` call.
- **Secrets stay out of git.** `.env` is in `.gitignore`; only
  `.env.example` (placeholders, no real values) is committed.

## What's genuinely still open

Being direct about this rather than burying it:

1. **x402 payment verification is not implemented**, only stubbed. Don't
   set `X402_PUBLIC=true` until it is.
2. **`ai_generate_workflow`'s exact persistence behavior isn't confirmed**
   — whether it saves a workflow itself or only returns a draft. Check
   `list_workflows` after your first real run so you're not accidentally
   running two copies of the same protection.
3. **No automated tests yet.** Each file was syntax-checked
   (`node --check`) and reviewed by hand, but there's no test suite
   exercising the actual KeeperHub calls.
4. **Rate limiting is in-memory and per-process** — fine for a hackathon
   demo, not durable across restarts or multiple instances.

None of these affect the core claim above (KeepGuard never holds a key),
but all four are worth knowing about before treating this as more than a
hackathon submission.
