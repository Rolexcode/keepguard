// Restricts bot commands to a known set of Telegram user IDs. Without
// this, anyone who finds the bot's username can issue commands that
// create workflows against your KeeperHub org's wallet — the bot has no
// other gate by default.
//
// Get your own Telegram user ID from @userinfobot, then set it in .env:
// TELEGRAM_ALLOWED_USER_IDS=123456789,987654321

function getAllowlist() {
  return (process.env.TELEGRAM_ALLOWED_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function requireAllowedUser() {
  const allowlist = getAllowlist();

  return (ctx, next) => {
    if (allowlist.length === 0) {
      // Fail closed, not open: an empty allowlist blocks everyone rather
      // than silently allowing everyone. Force the operator to set it.
      return ctx.reply(
        "⚠️ This bot has no configured owner yet (TELEGRAM_ALLOWED_USER_IDS is unset). " +
          "Refusing to act until that's set, to avoid running commands for strangers."
      );
    }

    const userId = String(ctx.from?.id ?? "");
    if (!allowlist.includes(userId)) {
      return ctx.reply("⛔ You're not authorized to use this bot.");
    }

    return next();
  };
}
