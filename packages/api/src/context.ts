import { TRPCError } from "@trpc/server";
import { getOrCreateProfile } from "@tiktok-gram/db";

import { db } from "./db";

function isPostgresConnectionError(error: unknown): boolean {
  const code =
    (error as { code?: string })?.code ??
    (error as { cause?: { code?: string } })?.cause?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND";
}

export async function createTRPCContext(opts: {
  headers: Headers;
  resolveMediaUrl?: (storageKey: string) => Promise<string>;
}) {
  const telegramUserId = opts.headers.get("x-telegram-user-id");
  const localAnonymousId = opts.headers.get("x-local-anonymous-id");

  let profile = null;
  try {
    if (telegramUserId) {
      const userInfo = {
        firstName: opts.headers.get("x-telegram-first-name") ?? undefined,
        lastName: opts.headers.get("x-telegram-last-name") ?? undefined,
        username: opts.headers.get("x-telegram-username") ?? undefined,
        photoUrl: opts.headers.get("x-telegram-photo-url") ?? undefined,
      };
      profile = await getOrCreateProfile(db, { telegramUserId, userInfo });
    } else if (localAnonymousId) {
      profile = await getOrCreateProfile(db, { localAnonymousId });
    }
  } catch (error) {
    if (isPostgresConnectionError(error)) {
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "PostgreSQL is unavailable. Check POSTGRES_URL in .env.",
      });
    }
    throw error;
  }

  return {
    db,
    profile,
    headers: opts.headers,
    resolveMediaUrl: opts.resolveMediaUrl,
  };
}

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;
