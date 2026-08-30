import { eq } from "drizzle-orm";

import { db } from "@tiktok-gram/db/client";
import { telegramPostDescriptions } from "@tiktok-gram/db/schema";

type CacheEntry = { value: PostAudioContext | null; expiresAt: number };
const metaCache = new Map<string, CacheEntry>();
// Ready audio is immutable; other statuses can still transition to ready.
const TTL_READY = 300_000;
const TTL_OTHER = 10_000;

export type PostAudioStatus =
  | "caching"
  | "needs_audio"
  | "fetching_audio"
  | "ready"
  | "failed";

export type PostAudioContext = {
  descId: string;
  status: PostAudioStatus;
  title: string | null;
  author: string | null;
  data: Buffer | null;
};

/**
 * Looks up the TikTok-music track for a post description. Mirrors
 * `loadMediaForStream` (short TTL cache + ready/other split). Loads audio_data
 * (Buffer) for ready tracks from Postgres. Returns `null` when the desc id is unknown.
 * No R2 storageKey logic (audio now served from PG like photos).
 */
export async function loadPostAudioForStream(
  descId: string,
): Promise<PostAudioContext | null> {
  const now = Date.now();
  const cached = metaCache.get(descId);
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await db
    .select({
      descId: telegramPostDescriptions.id,
      status: telegramPostDescriptions.status,
      title: telegramPostDescriptions.audioTitle,
      author: telegramPostDescriptions.audioAuthor,
      data: telegramPostDescriptions.audioData,
    })
    .from(telegramPostDescriptions)
    .where(eq(telegramPostDescriptions.id, descId))
    .limit(1);

  const row = rows[0];
  let data: Buffer | null = null;
  if (row?.data) {
    data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  }
  const value: PostAudioContext | null = row
    ? {
        descId: row.descId,
        status: row.status,
        title: row.title,
        author: row.author,
        data,
      }
    : null;

  const ttl = value?.status === "ready" ? TTL_READY : TTL_OTHER;
  metaCache.set(descId, { value, expiresAt: now + ttl });

  return value;
}
