import Redis from "ioredis";

import { env } from "~/env";

import type { MediaStreamContext } from "./load-media";

/** Redis list drained by media_cache_worker → RQ enqueue. */
export const MEDIA_CACHE_PENDING_LIST = "tiktok_gram:media-cache:pending-ids";

const inFlight = new Set<string>();
let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  redis ??= new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  return redis;
}

export function shouldEnqueueMediaCache(media: MediaStreamContext): boolean {
  return (
    media.cacheStatus === "needs_cache" || media.cacheStatus === "failed"
  );
}

export async function enqueueMediaCacheJob(mediaId: string): Promise<void> {
  if (inFlight.has(mediaId)) return;
  inFlight.add(mediaId);

  const client = getRedis();
  if (!client) {
    console.error("[media enqueue]", mediaId, "REDIS_URL is not configured");
    inFlight.delete(mediaId);
    return;
  }

  try {
    await client.rpush(MEDIA_CACHE_PENDING_LIST, mediaId);
  } catch (error) {
    console.error("[media enqueue]", mediaId, error);
  } finally {
    setTimeout(() => inFlight.delete(mediaId), 60_000);
  }
}
