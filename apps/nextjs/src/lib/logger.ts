/** Structured logger — writes JSON to stdout, captured by `docker logs tiktok-gram-web`. */

type Level = "info" | "warn" | "error";

function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(data ?? {}),
  });
  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

export const logger = {
  info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
  warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
  error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
};
