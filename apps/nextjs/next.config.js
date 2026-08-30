import path from "node:path";
import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

const jiti = createJiti(import.meta.url);
await jiti.import("./src/env");

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  transpilePackages: ["@tiktok-gram/api", "@tiktok-gram/db", "@tiktok-gram/ui"],
  // Dev from phone/LAN (e.g. http://192.168.1.50:3000) — silences webpack-hmr
  // WebSocket blocks. Add your own machine's LAN IP here for phone testing.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    ...(process.env.DEV_LAN_ORIGINS?.split(",").map((s) => s.trim()) ?? []),
  ],
  // The Telegram Mini App webview caches the entry HTML aggressively, which keeps
  // serving stale chunk references after a deploy ("still see old code"). Force the
  // entry HTML to always revalidate; the hashed JS/CSS under /_next/static stay
  // immutably cached, so each open picks up the latest build.
  async headers() {
    const noStore = [
      { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
    ];
    return [
      { source: "/", headers: noStore },
      { source: "/telegram", headers: noStore },
    ];
  },
};

export default config;
