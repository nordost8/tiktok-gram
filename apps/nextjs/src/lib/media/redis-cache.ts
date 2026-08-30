import { Redis } from "ioredis";

import { env } from "~/env";

export type CachedMediaAccess = {
  resolvedUrl: string | null;
  resolvedUrlExpiresAt: string | null;
  telegramDocumentId: string | null;
  telegramPhotoId: string | null;
  telegramAccessHash: string | null;
  telegramFileReference: string | null;
  telegramDcId: number | null;
  mimeType: string | null;
};

const TTL_SECONDS = 50 * 60;

let client: Redis | null = null;

function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 2,
      lazyConnect: true,
    });
  }
  return client;
}

function cacheKey(mediaId: string) {
  return `media:${mediaId}:access`;
}

export async function readMediaCache(
  mediaId: string,
): Promise<CachedMediaAccess | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    if (redis.status !== "ready") await redis.connect();
    const raw = await redis.get(cacheKey(mediaId));
    if (!raw) return null;
    return JSON.parse(raw) as CachedMediaAccess;
  } catch {
    return null;
  }
}

export async function writeMediaCache(
  mediaId: string,
  data: CachedMediaAccess,
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.set(cacheKey(mediaId), JSON.stringify(data), "EX", TTL_SECONDS);
  } catch {
    // optional cache
  }
}

export async function clearMediaCache(mediaId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    if (redis.status !== "ready") await redis.connect();
    await redis.del(cacheKey(mediaId));
  } catch {
    // optional
  }
}

export function isResolvedUrlValid(
  url: string | null | undefined,
  expiresAt: string | Date | null | undefined,
): boolean {
  if (!url || !expiresAt) return false;
  const exp =
    expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return exp.getTime() > Date.now();
}
