# KeepGuard

KeepGuard is a Telegram bot that protects a crypto wallet automatically. You tell it what to watch for — an untrusted spending approval, or a price drop past your stop-loss — and it takes the protective action for you, executing the transaction through [KeeperHub](https://keeperhub.com).

The same protection is also available as a pay-per-call service (via [x402](https://x402.org)), so another AI agent can request it on someone else's behalf.

Built for the [KeeperHub Agents Onchain Hackathon](https://dorahacks.io/hackathon/agents-onchain/detail).

## What it does

**Approval watch.** You give it a wallet, a token, and a list of spenders you trust. If that token approves a spender *not* on your list, KeepGuard revokes it automatically.

**Stop-loss watch.** You give it a wallet, an asset, an entry price, and a drop threshold. If the price falls past that threshold, KeepGuard swaps the asset into a stablecoin automatically.

In both cases, KeepGuard doesn't execute the transaction itself — it describes the automation to KeeperHub, which builds and runs it, then reports back what happened (transaction hash, gas used, retries) so you always see the real audit trail, not just "done."

## Who can sign transactions

KeepGuard never holds a private key. Your organization's wallet is created and held by KeeperHub through [Turnkey](https://www.turnkey.com), which generates the key inside a hardware-secured enclave and never lets it leave. KeepGuard only ever sees a wallet *address* — never a key. See [SECURITY.md](./SECURITY.md) for the full breakdown.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `KEEPERHUB_API_KEY` | app.keeperhub.com → Settings → API Keys → Organisation tab |
| `TELEGRAM_BOT_TOKEN` | Message @BotFather → `/newbot` |
| `TELEGRAM_ALLOWED_USER_IDS` | Message @userinfobot to get your own ID |
| `X402_PAY_TO_ADDRESS` | Any wallet address you control |

Start on **Sepolia** (`KEEPERHUB_CHAIN=sepolia`) while testing. Only switch to a mainnet chain for the one real transaction the hackathon submission requires.

## Running it

```bash
npm run bot      # Telegram bot only
npm run x402     # paid HTTP endpoint only
npm start        # both
```

## Using the bot

```
/protect_revoke <chain> <wallet> <tokenContract> <whitelistCsv>
/protect_stoploss <chain> <wallet> <assetContract> <priceFeed> <entryUsd> <thresholdPct> <stableContract>
/audit <executionId>
```

Example:
```
/protect_revoke sepolia 0xYourWallet 0xTokenContract 0xTrustedSpender1,0xTrustedSpender2
```

Only Telegram user IDs listed in `TELEGRAM_ALLOWED_USER_IDS` can use these commands — everyone else gets refused. This is deliberate; see [SECURITY.md](./SECURITY.md).

## How a request becomes a transaction

1. You send a command (or another agent calls the x402 endpoint)
2. KeepGuard checks the input is well-formed (real addresses, sane numbers)
3. KeepGuard describes the automation in plain English and asks KeeperHub's `ai_generate_workflow` to build it
4. KeeperHub's `validate_workflow` checks the result is structurally sound
5. KeepGuard creates the workflow, enabled, via `create_workflow`
6. KeeperHub runs it — reading the chain, deciding, and (if needed) executing the transaction through your Turnkey-backed wallet
7. `/audit <executionId>` shows you exactly what happened, step by step

## Project structure

```
src/
  telegram/
    bot.js        commands users type
    authz.js       who's allowed to use the bot
  x402/
    server.js      paid HTTP endpoint for other agents
  keeperhub/
    mcpClient.js       low-level calls to KeeperHub's MCP tools
    provision.js       shared logic: describe -> generate -> validate -> create
    workflowTemplates.js   turns your parameters into a plain-English description
    cliClient.js       audit-log pulls via the `kh` CLI (a second, separate surface)
  audit/
    relay.js       formats a KeeperHub execution into a readable trail
  utils/
    validate.js    input sanity checks
    logger.js      structured logging
```

## Known gaps before this is production-ready

These are flagged in code comments too, not hidden:

- The x402 payment check is a placeholder — it checks a header is *present*, not that a payment actually happened. The server only listens on localhost until this is fixed (`X402_PUBLIC` stays `false`).
- Whether `ai_generate_workflow` returns a draft or already saves it isn't confirmed — check `list_workflows` after your first real run to be sure you don't end up with duplicates.

Full detail in [SECURITY.md](./SECURITY.md).
