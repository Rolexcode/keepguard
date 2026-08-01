// Minimal structured logger. Every line is timestamped and tagged with a
// scope, so when we relay audit info back through Telegram or the demo
// video, the underlying log stream already tells a clean story:
// trigger -> decision -> execution -> outcome.

function ts() {
  return new Date().toISOString();
}

function log(level, scope, message, meta = {}) {
  const line = { ts: ts(), level, scope, message, ...meta };
  const out = level === "error" ? console.error : console.log;
  out(JSON.stringify(line));
  return line;
}

export const logger = {
  info: (scope, message, meta) => log("info", scope, message, meta),
  warn: (scope, message, meta) => log("warn", scope, message, meta),
  error: (scope, message, meta) => log("error", scope, message, meta),
};
