import { eq } from "drizzle-orm";

import { db } from "@tiktok-gram/db/client";
import {
  telegramChannels,
  telegramPostDescriptions,
  telegramPostMedia,
} from "@tiktok-gram/db/schema";

type CacheEntry = { value: MediaStreamContext | null; expiresAt: number };
const metaCache = new Map<string, CacheEntry>();
// Ready+cached objects are stable; other statuses change (downloading→ready).
const TTL_READY = 300_000;
const TTL_OTHER = 10_000;

export type MediaCacheStatus =
  | "needs_cache"
  | "downloading"
  | "ready"
  | "failed"
  | "skipped";

export type MediaStreamContext = {
  mediaId: string;
  type: "photo" | "video" | "animation";
  mimeType: string | null;
  sizeBytes: number | null;
  cacheStatus: MediaCacheStatus | null;
  storageKey: string | null;
  storageBackend: string | null;
  cachedSizeBytes: number | null;
  cacheRangeReady: boolean;
  lastCacheError: string | null;
  telegramDocumentId: string | null;
  telegramPhotoId: string | null;
  telegramAccessHash: string | null;
  telegramFileReference: string | null;
  telegramDcId: number | null;
  channelUsername: string;
  telegramMessageId: string;
};

export async function loadMediaForStream(
  mediaId: string,
): Promise<MediaStreamContext | null> {
  const now = Date.now();
  const cached = metaCache.get(mediaId);
  if (cached && cached.expiresAt > now) return cached.value;

  const rows = await db
    .select({
      mediaId: telegramPostMedia.id,
      type: telegramPostMedia.type,
      mimeType: telegramPostMedia.mimeType,
      sizeBytes: telegramPostMedia.sizeBytes,
      cacheStatus: telegramPostMedia.cacheStatus,
      storageKey: telegramPostMedia.storageKey,
      storageBackend: telegramPostMedia.storageBackend,
      cachedSizeBytes: telegramPostMedia.cachedSizeBytes,
      cacheRangeReady: telegramPostMedia.cacheRangeReady,
      lastCacheError: telegramPostMedia.lastCacheError,
      telegramDocumentId: telegramPostMedia.telegramDocumentId,
      telegramPhotoId: telegramPostMedia.telegramPhotoId,
      telegramAccessHash: telegramPostMedia.telegramAccessHash,
      telegramFileReference: telegramPostMedia.telegramFileReference,
      telegramDcId: telegramPostMedia.telegramDcId,
      channelUsername: telegramChannels.username,
      telegramMessageId: telegramPostDescriptions.telegramMessageId,
    })
    .from(telegramPostMedia)
    .innerJoin(
      telegramPostDescriptions,
      eq(telegramPostMedia.descId, telegramPostDescriptions.id),
    )
    .innerJoin(
      telegramChannels,
      eq(telegramPostDescriptions.channelId, telegramChannels.id),
    )
    .where(eq(telegramPostMedia.id, mediaId))
    .limit(1);

  const row = rows[0];
  const value: MediaStreamContext | null = row?.telegramAccessHash
    ? {
        mediaId: row.mediaId,
        type: row.type,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        cacheStatus: row.cacheStatus,
        storageKey: row.storageKey,
        storageBackend: row.storageBackend,
        cachedSizeBytes: row.cachedSizeBytes,
        cacheRangeReady: row.cacheRangeReady,
        lastCacheError: row.lastCacheError,
        telegramDocumentId: row.telegramDocumentId,
        telegramPhotoId: row.telegramPhotoId,
        telegramAccessHash: row.telegramAccessHash,
        telegramFileReference: row.telegramFileReference,
        telegramDcId: row.telegramDcId,
        channelUsername: row.channelUsername,
        telegramMessageId: row.telegramMessageId,
      }
    : null;

  const ttl =
    value?.cacheStatus === "ready" && value.cacheRangeReady ? TTL_READY : TTL_OTHER;
  metaCache.set(mediaId, { value, expiresAt: now + ttl });

  return value;
}
