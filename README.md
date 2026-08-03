# KeepGuard

KeepGuard is a Telegram-based wallet-defense agent built for the KeeperHub Agents Onchain Hackathon. It watches a KeeperHub-controlled wallet for risky ERC-20 approvals or stop-loss conditions and asks KeeperHub to execute the protective action onchain.

The first test environment is **Sepolia**. Mainnet automation is locked by default.

## Protection modes

### Approval watch

KeepGuard watches an ERC-20 token for `Approval` events whose owner is the connected KeeperHub wallet. If the spender is not trusted, KeeperHub submits `approve(spender, 0)` from that same wallet.

### Stop-loss watch

KeepGuard reads a configured price feed on a schedule. If the normalized price drops beyond the chosen threshold and the protected wallet has a non-zero balance, KeeperHub swaps the available asset balance into the selected stable asset.

## Safety model

- KeepGuard never accepts or stores a private key.
- The requested wallet is resolved from KeeperHub's wallet integration instead of user input.
- A workflow is created **disabled**, validated by its stored KeeperHub workflow ID, and enabled only after validation passes.
- Mainnet chains are rejected unless `KEEPERHUB_ALLOW_MAINNET=true` is explicitly set.
- Telegram commands are restricted to `TELEGRAM_ALLOWED_USER_IDS`.
- Protection setup requires a readable preview and an explicit confirmation that expires after ten minutes.
- The unfinished x402 endpoint is forced to localhost and refuses public startup.

See [SECURITY.md](./SECURITY.md) for limitations and threat-model details.

## Setup

Requirements:

- Node.js 18 or newer
- A KeeperHub organization API key
- A KeeperHub wallet integration
- A Telegram bot created through BotFather
- Sepolia test ETH and test tokens for the eventual execution test

```bash
npm install
cp .env.example .env
```

Configure at least:

```dotenv
KEEPERHUB_API_KEY=kh_...
KEEPERHUB_MCP_URL=https://app.keeperhub.com/mcp
KEEPERHUB_CHAIN=sepolia
KEEPERHUB_ALLOW_MAINNET=false
TELEGRAM_BOT_TOKEN=...
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEGRAM_BOT_USERNAME=@keepguardbot
X402_PUBLIC=false
```

Do not put a private key in `.env`. KeepGuard has no private-key configuration.

## Run

```bash
npm run bot      # Telegram experience
npm start        # Telegram plus localhost-only x402 preview
npm run render   # Telegram plus public JSON health endpoint for Render
npm run readiness # read-only Telegram + KeeperHub preflight
npm test         # local unit tests; no network or transaction
```

## Telegram onboarding

Start with:

```text
/start
/status
/demo
```

`/status` checks the KeeperHub API connection, connected signing wallet, selected network, access control, and mainnet lock. It does not create a workflow or send a transaction.

### Guided Sepolia demo — recommended

`/demo` requires no addresses or blockchain terminology. The bot guides the user through:

1. Creating and validating an approval-protection workflow for a standard Sepolia WETH contract.
2. Simulating a harmless approval of one wei to a burn address.
3. Asking for explicit confirmation before broadcasting the test approval.
4. Watching KeeperHub detect the approval and revoke it.

The approval does not transfer tokens. The connected KeeperHub wallet only needs enough Sepolia ETH for test gas.

### Advanced approval protection

```text
/protect_revoke <tokenContract> [trustedSpender1,trustedSpender2]
```

### Advanced stop-loss protection

```text
/protect_stoploss <assetContract> <priceFeed> <entryUsd> <dropPct> <stableContract>
```

Both commands show a preview first. Confirming performs this lifecycle:

1. Read the connected KeeperHub signing wallet.
2. Generate a workflow through `ai_generate_workflow`.
3. Save it disabled.
4. Validate the stored workflow through `validate_workflow({ workflowId })`.
5. Enable it only when KeeperHub returns `valid: true`.

To inspect an execution:

```text
/audit <executionId>
```

The audit response includes the execution state, steps, transaction hash, gas used, and a block-explorer link when KeeperHub supplies those fields.

## Render uptime for testing

Render Free web services spin down after 15 minutes without inbound traffic. KeepGuard exposes:

```text
https://YOUR-SERVICE.onrender.com/health
```

Render settings:

- Build command: `npm ci`
- Start command: `npm run render`
- Health check path: `/health`
- Environment: `KEEPERHUB_CHAIN=sepolia`, `KEEPERHUB_ALLOW_MAINNET=false`, `X402_PUBLIC=false`

The included `render.yaml` records the same configuration for future Blueprint deployments.

To keep a Free instance awake while testing, create a free UptimeRobot HTTP(S) monitor:

1. Click **Add New Monitor** and choose **HTTP(s)**.
2. Enter `https://YOUR-SERVICE.onrender.com/health`.
3. Select the free five-minute interval.
4. Enable redirects and attach your email alert contact.
5. Wait for a response containing `"ready":true`.

Do not run the same Telegram token locally while Render is running. Two long-polling bot instances will compete for updates.

## Project structure

```text
src/
  telegram/
    bot.js                 guided Telegram UX and confirmations
    authz.js               Telegram user allowlist
  keeperhub/
    mcpClient.js           KeeperHub MCP calls
    provision.js           safe create/validate/enable lifecycle
    response.js            MCP and KeeperHub response normalization
    workflowTemplates.js   workflow generation prompts
    cliClient.js           optional CLI wrapper; not used by the bot
  audit/
    relay.js               readable execution trail and explorer links
  x402/
    server.js              localhost-only development preview
  utils/
    validate.js            address and numeric validation
    logger.js              structured logs
test/
  provision.test.js
  response.test.js
  validate.test.js
```

## x402 status

The local `/protect` endpoint is a development preview, not a completed x402 implementation. It does not verify payment and cannot bind publicly. For the hackathon, the preferred next step is publishing a validated paid workflow through KeeperHub's marketplace, which supplies x402/MPP settlement.

## Before hackathon submission

- [ ] Run `/status` successfully against KeeperHub.
- [ ] Create and validate one Sepolia workflow.
- [ ] Trigger a real Sepolia transaction through KeeperHub.
- [ ] Capture the execution ID, transaction hash, explorer link, gas, and audit trail.
- [ ] Test both success and failure recovery paths.
- [ ] Decide whether x402 is implemented through the KeeperHub marketplace or removed from the demo claim.
- [ ] Record the required demo video.
- [ ] Add the transaction and video links to this README and the submission.
