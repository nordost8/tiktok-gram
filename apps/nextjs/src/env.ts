import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod/v4";

export const env = createEnv({
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
  server: {
    POSTGRES_URL: z.url(),
    REDIS_URL: z.string().url().optional(),
    S3_ENDPOINT: z.string().url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).optional(),
    TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
    ADMIN_CHAT_ID: z.string().min(1).optional(),
    // Public URL of the deployed app — used to register the Telegram bot
    // webhook and to build Mini App deep links. Unset in local dev.
    SITE_URL: z.string().url().optional(),
    // UI language: "en" (default) or "uk". Deliberately a plain server var,
    // NOT NEXT_PUBLIC_*: Next.js inlines NEXT_PUBLIC_* into the client bundle
    // at `next build` time, which would require a rebuild per locale under
    // this project's build-once-deploy-many Docker/CI setup. Instead the root
    // layout (a server component) reads this at request time and passes it
    // down to the client tree as a prop — see AppConfigProvider. Changing it
    // only needs a container restart, not a rebuild.
    LOCALE: z.enum(["en", "uk"]).default("en"),
    // Optional support/community link shown in Settings and Profile. The row
    // is hidden entirely when unset. Same NEXT_PUBLIC_ caveat as LOCALE — read
    // server-side and threaded down via AppConfigProvider.
    SUPPORT_URL: z.string().url().optional(),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  skipValidation:
    !!process.env.CI ||
    !!process.env.SKIP_ENV_VALIDATION ||
    process.env.npm_lifecycle_event === "lint",
});
