import {
  and,
  count,
  desc,
  eq,
  inArray,
  lt,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { db as Db } from "@tiktok-gram/db/client";
import {
  telegramChannels,
  telegramInterestCategories,
  telegramPostDescriptions,
  telegramPostMedia,
  telegramProfileInterests,
  telegramUserChannelSubscriptions,
  telegramUserHiddenChannels,
  telegramUserPostLikes,
  telegramUserPostSaves,
  telegramUserPostViews,
} from "@tiktok-gram/db/schema";
import {
  feedAllowsPhotos,
  isVideoOnlyFeed,
} from "@tiktok-gram/db/select-primary-media";

import { mapPostToDto } from "./map-post";

/**
 * Single visibility gate: a post is shown iff its unified lifecycle status is
 * 'ready'. `status` is the only source of truth — video/mixed posts reach 'ready'
 * once their media caches; photo posts only once their music is attached. Posts
 * that are caching / awaiting-audio / fetching-audio / failed are hidden.
 */
export function buildVisibilityGate(): ReturnType<typeof sql> {
  return sql`${telegramPostDescriptions.status} = 'ready'`;
}

export function decodeCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { publishedAt: string; id: string };
    return { publishedAt: new Date(parsed.publishedAt), id: parsed.id };
  } catch {
    return null;
  }
}

export function encodeCursor(publishedAt: Date, id: string) {
  return Buffer.from(
    JSON.stringify({ publishedAt: publishedAt.toISOString(), id }),
  ).toString("base64url");
}

function buildPrimaryMediaCte(db: typeof Db, includeEvicted: boolean) {
  const conditions = [
    sql`${telegramPostMedia.telegramAccessHash} IS NOT NULL`,
  ];

  if (!includeEvicted) {
    conditions.push(eq(telegramPostMedia.cacheStatus, "ready"));
    if (isVideoOnlyFeed() && !feedAllowsPhotos()) {
      conditions.push(
        sql`${telegramPostMedia.type} IN ('video', 'animation')`,
      );
    }
  }

  return db.$with("primary_media").as(
    db
      .selectDistinctOn([telegramPostMedia.descId], {
        id: telegramPostMedia.id,
        descId: telegramPostMedia.descId,
        type: telegramPostMedia.type,
        thumbnailUrl: telegramPostMedia.thumbnailUrl,
        width: telegramPostMedia.width,
        height: telegramPostMedia.height,
        duration: telegramPostMedia.duration,
        mimeType: telegramPostMedia.mimeType,
        cacheStatus: telegramPostMedia.cacheStatus,
        storageKey: telegramPostMedia.storageKey,
        cacheRangeReady: telegramPostMedia.cacheRangeReady,
      })
      .from(telegramPostMedia)
      .where(and(...conditions))
      .orderBy(
        telegramPostMedia.descId,
        // For includeEvicted: prefer ready media over others
        sql`CASE WHEN ${telegramPostMedia.cacheStatus} = 'ready' THEN 0 ELSE 1 END`,
        // Prefer video > animation > photo
        sql`CASE WHEN ${telegramPostMedia.type} = 'video' THEN 1 WHEN ${telegramPostMedia.type} = 'animation' THEN 2 ELSE 3 END`,
        desc(telegramPostMedia.duration),
        desc(telegramPostMedia.sizeBytes),
      ),
  );
}

function notViewedByProfile(db: typeof Db, profileId: string) {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(telegramUserPostViews)
      .where(
        and(
          eq(telegramUserPostViews.descId, telegramPostDescriptions.id),
          eq(telegramUserPostViews.profileId, profileId),
        ),
      ),
  );
}

export function scorePost(
  post: {
    publishedAt: Date;
    internalLikesCount: number;
    internalSavesCount: number;
    internalViewsCount: number;
    categorySlug: string | null;
    mediaType: string;
    channelId: string;
  },
  interestSlugs: Set<string>,
  subscribedChannelIds: Set<string>,
) {
  const hoursAgo = (Date.now() - post.publishedAt.getTime()) / (1000 * 60 * 60);
  const freshness = Math.max(0, 72 - hoursAgo) / 72;
  const engagement =
    post.internalLikesCount * 3 +
    post.internalSavesCount * 4 +
    post.internalViewsCount * 0.1;
  const categoryBoost =
    post.categorySlug && interestSlugs.has(post.categorySlug) ? 20 : 0;
  const videoBoost = post.mediaType === "video" ? 35 : 0;
  const subscriptionBoost = subscribedChannelIds.has(post.channelId) ? 120 : 0;
  return (
    freshness * 30 + engagement + categoryBoost + videoBoost + subscriptionBoost
  );
}

export function applyDiversity<T extends { channelId: string }>(
  items: T[],
  limit: number,
) {
  const result: T[] = [];
  const channelCounts = new Map<string, number>();

  for (const item of items) {
    const countForChannel = channelCounts.get(item.channelId) ?? 0;
    if (countForChannel >= 2 && result.length < limit) continue;
    result.push(item);
    channelCounts.set(item.channelId, countForChannel + 1);
    if (result.length >= limit) break;
  }

  if (result.length < limit) {
    for (const item of items) {
      if (result.includes(item)) continue;
      result.push(item);
      if (result.length >= limit) break;
    }
  }

  return result;
}

/**
 * Enforces that photo posts are at most floor(limit * maxRatio) of the page.
 * Photos are interleaved evenly among non-photo posts.
 * Hard cap: never exceeds quota even if videos are scarce.
 * If total posts < limit, returns all posts (still capped by quota for photos).
 */
export function capPhotoRatio<T extends { primaryMedia: { type: string } }>(
  items: T[],
  limit: number,
  maxRatio = 0.5,
): T[] {
  const photoQuota = Math.floor(limit * maxRatio);
  const photos = items.filter((i) => i.primaryMedia.type === "photo");
  const nonPhotos = items.filter((i) => i.primaryMedia.type !== "photo");

  const usedPhotos = photos.slice(0, photoQuota);
  // Fill remaining slots with non-photos; total slots = min(limit, nonPhotos.length + usedPhotos.length)
  const nonPhotoSlots = Math.min(limit - usedPhotos.length, nonPhotos.length);
  const usedNonPhotos = nonPhotos.slice(0, nonPhotoSlots);

  if (usedPhotos.length === 0) return usedNonPhotos;
  if (usedNonPhotos.length === 0) return usedPhotos;

  // Interleave: spread photos evenly across non-photos
  const result: T[] = [];
  const totalResult = usedNonPhotos.length + usedPhotos.length;
  // Place photos at evenly-distributed positions
  const step = totalResult / usedPhotos.length;
  const photoPositions = new Set<number>();
  for (let i = 0; i < usedPhotos.length; i++) {
    photoPositions.add(Math.round(i * step + step / 2) - 1);
  }

  let photoIdx = 0;
  let nonPhotoIdx = 0;
  for (let pos = 0; pos < totalResult; pos++) {
    if (photoPositions.has(pos) && photoIdx < usedPhotos.length) {
      result.push(usedPhotos[photoIdx++]!);
    } else if (nonPhotoIdx < usedNonPhotos.length) {
      result.push(usedNonPhotos[nonPhotoIdx++]!);
    } else if (photoIdx < usedPhotos.length) {
      result.push(usedPhotos[photoIdx++]!);
    }
  }

  return result;
}

async function countPlayablePosts(
  db: typeof Db,
  profileId: string,
  opts: {
    channelIds?: string[];
    postIds?: string[];
    excludeViewed: boolean;
  },
): Promise<number> {
  const videoOnlyFilter = isVideoOnlyFeed() && !feedAllowsPhotos()
    ? sql`AND pm.type IN ('video', 'animation')`
    : sql``;

  const hiddenRows = await db
    .select({ channelId: telegramUserHiddenChannels.channelId })
    .from(telegramUserHiddenChannels)
    .where(eq(telegramUserHiddenChannels.profileId, profileId));
  const hiddenChannelIds = hiddenRows.map((h) => h.channelId);

  const conditions = [
    sql`EXISTS (
      SELECT 1 FROM telegram_post_media pm
      WHERE pm.desc_id = ${telegramPostDescriptions.id}
        AND pm.cache_status = 'ready'
        AND pm.telegram_access_hash IS NOT NULL
        ${videoOnlyFilter}
    )`,
  ];

  conditions.push(buildVisibilityGate());

  if (hiddenChannelIds.length > 0) {
    conditions.push(
      notInArray(telegramPostDescriptions.channelId, hiddenChannelIds),
    );
  }

  if (opts.channelIds?.length) {
    conditions.push(inArray(telegramPostDescriptions.channelId, opts.channelIds));
  }
  if (opts.postIds?.length) {
    conditions.push(inArray(telegramPostDescriptions.id, opts.postIds));
  }
  if (opts.excludeViewed) {
    conditions.push(notViewedByProfile(db, profileId));
  }

  const [row] = await db
    .select({ total: count() })
    .from(telegramPostDescriptions)
    .where(and(...conditions));

  return Number(row?.total ?? 0);
}

export async function fetchFeedPosts(opts: {
  db: typeof Db;
  profileId: string;
  limit: number;
  cursor?: string;
  channelIds?: string[];
  postIds?: string[];
  /** Main feed hides watched posts; saved/liked lists keep them. */
  excludeViewed?: boolean;
  /** Pass when subscriptions are already loaded upstream to avoid a second query. */
  preloadedSubscribedChannelIds?: string[];
  /** When provided, ready media gets a direct presigned URL instead of /api/media/{id}. */
  resolveMediaUrl?: (storageKey: string) => Promise<string>;
  /** Include evicted posts — used for liked/saved history screens. */
  includeEvicted?: boolean;
}) {
  const excludeViewed = opts.excludeViewed ?? true;
  const includeEvicted = opts.includeEvicted ?? false;
  const decoded = decodeCursor(opts.cursor);

  const subscriptionQuery = opts.preloadedSubscribedChannelIds
    ? Promise.resolve(
        opts.preloadedSubscribedChannelIds.map((channelId) => ({ channelId })),
      )
    : opts.db
        .select({ channelId: telegramUserChannelSubscriptions.channelId })
        .from(telegramUserChannelSubscriptions)
        .where(eq(telegramUserChannelSubscriptions.profileId, opts.profileId));

  const hiddenQuery = opts.db
    .select({ channelId: telegramUserHiddenChannels.channelId })
    .from(telegramUserHiddenChannels)
    .where(eq(telegramUserHiddenChannels.profileId, opts.profileId));

  const [interestRows, subscriptionRows, hiddenRows] = await Promise.all([
    opts.db
      .select({ slug: telegramInterestCategories.slug })
      .from(telegramProfileInterests)
      .innerJoin(
        telegramInterestCategories,
        eq(telegramProfileInterests.interestId, telegramInterestCategories.id),
      )
      .where(eq(telegramProfileInterests.profileId, opts.profileId)),
    subscriptionQuery,
    hiddenQuery,
  ]);

  const interestSlugs = new Set(interestRows.map((r) => r.slug));
  const subscribedChannelIds = new Set(
    subscriptionRows.map((s) => s.channelId),
  );
  const hiddenChannelIds = hiddenRows.map((h) => h.channelId);

  if (opts.postIds?.length === 0) {
    return { items: [], nextCursor: undefined };
  }

  const primaryMediaCte = buildPrimaryMediaCte(opts.db, includeEvicted);

  const conditions = [];

  conditions.push(buildVisibilityGate());

  if (hiddenChannelIds.length > 0) {
    conditions.push(
      notInArray(telegramPostDescriptions.channelId, hiddenChannelIds),
    );
  }

  if (opts.channelIds?.length) {
    conditions.push(inArray(telegramPostDescriptions.channelId, opts.channelIds));
  } else if (interestSlugs.size > 0) {
    const interestFilter = inArray(
      telegramChannels.categorySlug,
      Array.from(interestSlugs),
    );
    const subscribedIds = Array.from(subscribedChannelIds);
    conditions.push(
      subscribedIds.length > 0
        ? or(interestFilter, inArray(telegramPostDescriptions.channelId, subscribedIds))!
        : interestFilter,
    );
  }

  if (opts.postIds?.length) {
    conditions.push(inArray(telegramPostDescriptions.id, opts.postIds));
  }

  if (excludeViewed) {
    conditions.push(notViewedByProfile(opts.db, opts.profileId));
  }

  if (!excludeViewed && decoded) {
    const cursorCondition = or(
      lt(telegramPostDescriptions.publishedAt, decoded.publishedAt),
      and(
        eq(telegramPostDescriptions.publishedAt, decoded.publishedAt),
        lt(telegramPostDescriptions.id, decoded.id),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await opts.db
    .with(primaryMediaCte)
    .select({
      id: telegramPostDescriptions.id,
      channelId: telegramPostDescriptions.channelId,
      telegramUrl: telegramPostDescriptions.telegramUrl,
      text: telegramPostDescriptions.text,
      caption: telegramPostDescriptions.caption,
      textDisplayUk: telegramPostDescriptions.textDisplayUk,
      sourceLang: telegramPostDescriptions.sourceLang,
      captionTranslationStatus: telegramPostDescriptions.captionTranslationStatus,
      publishedAt: telegramPostDescriptions.publishedAt,
      internalViewsCount: telegramPostDescriptions.internalViewsCount,
      internalLikesCount: telegramPostDescriptions.internalLikesCount,
      internalSavesCount: telegramPostDescriptions.internalSavesCount,
      internalSharesCount: telegramPostDescriptions.internalSharesCount,
      categorySlug: telegramChannels.categorySlug,
      audioTitle: telegramPostDescriptions.audioTitle,
      audioAuthor: telegramPostDescriptions.audioAuthor,
      audioStorageKey: telegramPostDescriptions.audioStorageKey,
      status: telegramPostDescriptions.status,
      channel: {
        id: telegramChannels.id,
        title: telegramChannels.title,
        username: telegramChannels.username,
        avatarUrl: telegramChannels.avatarUrl,
      },
      primaryMedia: {
        id: primaryMediaCte.id,
        type: primaryMediaCte.type,
        thumbnailUrl: primaryMediaCte.thumbnailUrl,
        width: primaryMediaCte.width,
        height: primaryMediaCte.height,
        duration: primaryMediaCte.duration,
        mimeType: primaryMediaCte.mimeType,
        cacheStatus: primaryMediaCte.cacheStatus,
        storageKey: primaryMediaCte.storageKey,
        cacheRangeReady: primaryMediaCte.cacheRangeReady,
      },
    })
    .from(telegramPostDescriptions)
    .innerJoin(
      primaryMediaCte,
      eq(primaryMediaCte.descId, telegramPostDescriptions.id),
    )
    .innerJoin(
      telegramChannels,
      eq(telegramPostDescriptions.channelId, telegramChannels.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(
      desc(telegramPostDescriptions.publishedAt),
      desc(telegramPostDescriptions.id),
    )
    .limit(opts.limit * 3);

  const ranked = rows
    .map((row) => ({
      ...row,
      score: scorePost(
        {
          ...row,
          mediaType: row.primaryMedia.type,
        },
        interestSlugs,
        subscribedChannelIds,
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const diverseRaw = applyDiversity(ranked, opts.limit);
  // Direct id fetches (deeplinks) must return the exact posts — don't shape them
  // with the photo-ratio cap (which would drop a single photo post).
  const diverse = opts.postIds?.length
    ? diverseRaw
    : capPhotoRatio(diverseRaw, opts.limit);
  const postIds = diverse.map((p) => p.id);

  if (postIds.length === 0) {
    let emptyReason:
      | "no_content"
      | "all_viewed"
      | "no_subscriptions"
      | undefined;
    if (!decoded && excludeViewed) {
      const scope = {
        channelIds: opts.channelIds,
        postIds: opts.postIds,
        excludeViewed: false,
      };
      const totalPlayable = await countPlayablePosts(
        opts.db,
        opts.profileId,
        scope,
      );
      if (totalPlayable === 0) {
        emptyReason = "no_content";
      } else {
        const unviewed = await countPlayablePosts(opts.db, opts.profileId, {
          ...scope,
          excludeViewed: true,
        });
        emptyReason = unviewed === 0 ? "all_viewed" : "no_content";
      }
    }
    return { items: [], nextCursor: undefined, emptyReason };
  }

  const [likes, saves] = await Promise.all([
    opts.db
      .select({ descId: telegramUserPostLikes.descId })
      .from(telegramUserPostLikes)
      .where(
        and(
          eq(telegramUserPostLikes.profileId, opts.profileId),
          inArray(telegramUserPostLikes.descId, postIds),
        ),
      ),
    opts.db
      .select({ descId: telegramUserPostSaves.descId })
      .from(telegramUserPostSaves)
      .where(
        and(
          eq(telegramUserPostSaves.profileId, opts.profileId),
          inArray(telegramUserPostSaves.descId, postIds),
        ),
      ),
  ]);

  const likedSet = new Set(likes.map((l) => l.descId));
  const savedSet = new Set(saves.map((s) => s.descId));

  // Fetch all photo media rows for photo posts (when photos are enabled)
  const photoPostIds = feedAllowsPhotos()
    ? diverse.filter((p) => p.primaryMedia.type === "photo").map((p) => p.id)
    : [];

  const allPhotoMediaRows =
    photoPostIds.length > 0
      ? await opts.db
          .select({
            id: telegramPostMedia.id,
            descId: telegramPostMedia.descId,
            type: telegramPostMedia.type,
            width: telegramPostMedia.width,
            height: telegramPostMedia.height,
            mimeType: telegramPostMedia.mimeType,
            cacheStatus: telegramPostMedia.cacheStatus,
            storageKey: telegramPostMedia.storageKey,
            cacheRangeReady: telegramPostMedia.cacheRangeReady,
          })
          .from(telegramPostMedia)
          .where(
            and(
              inArray(telegramPostMedia.descId, photoPostIds),
              eq(telegramPostMedia.cacheStatus, "ready"),
              sql`${telegramPostMedia.telegramAccessHash} IS NOT NULL`,
              eq(telegramPostMedia.type, "photo"),
            ),
          )
          .orderBy(telegramPostMedia.createdAt, telegramPostMedia.id)
      : [];

  // Group photo media rows by descId
  const mediaItemsByDescId = new Map<
    string,
    typeof allPhotoMediaRows
  >();
  for (const row of allPhotoMediaRows) {
    const existing = mediaItemsByDescId.get(row.descId) ?? [];
    existing.push(row);
    mediaItemsByDescId.set(row.descId, existing);
  }

  // Resolve DIRECT R2 presigned URLs for ready VIDEO only. Photos stay on the
  // same-origin /api/media route (they live in Postgres, not R2, and Telegram
  // WebView is happiest with same-origin images). Video bytes must go
  // client→R2 directly so the Pi is never in the byte path.
  const resolvedMediaUrls = new Map<string, string>();
  const presignFailures: { mediaId: string; storageKey: string; err: string }[] =
    [];
  if (opts.resolveMediaUrl) {
    const primaryToResolve = diverse.filter(
      (p) =>
        (p.primaryMedia.type === "video" ||
          p.primaryMedia.type === "animation") &&
        p.primaryMedia.cacheStatus === "ready" &&
        p.primaryMedia.storageKey &&
        p.primaryMedia.cacheRangeReady,
    );

    await Promise.all(
      primaryToResolve.map(async (p) => {
        try {
          const url = await opts.resolveMediaUrl!(p.primaryMedia.storageKey!);
          resolvedMediaUrls.set(p.primaryMedia.id, url);
        } catch (err) {
          // Signing is local (HMAC, no network) so this should essentially
          // never happen for a ready video. If it does it's a real config
          // error — surface it loudly rather than silently proxying bytes.
          presignFailures.push({
            mediaId: p.primaryMedia.id,
            storageKey: p.primaryMedia.storageKey!,
            err: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  const items = diverse.map((post) =>
    mapPostToDto(
      post,
      {
        liked: likedSet.has(post.id),
        saved: savedSet.has(post.id),
        subscribed: subscribedChannelIds.has(post.channelId),
      },
      resolvedMediaUrls,
      mediaItemsByDescId.get(post.id),
    ),
  );

  let nextCursor: string | undefined;
  if (excludeViewed) {
    nextCursor =
      items.length > 0
        ? encodeCursor(diverse[0]!.publishedAt, diverse[0]!.id)
        : undefined;
  } else {
    const oldest = diverse.reduce((min, p) => {
      if (!min) return p;
      if (p.publishedAt < min.publishedAt) return p;
      if (p.publishedAt === min.publishedAt && p.id < min.id) return p;
      return min;
    }, diverse[0]);
    nextCursor =
      diverse.length === opts.limit && oldest
        ? encodeCursor(oldest.publishedAt, oldest.id)
        : undefined;
  }

  // Loud, structured log of EXACTLY what we hand back for this page, so a
  // screenshot of any broken post can be matched against the server's decision:
  //   docker logs tiktok-gram-web 2>&1 | grep feed-serve
  // src_kind tells us at a glance whether a video went direct-from-R2
  // ("r2_direct") or hit the emergency proxy path ("api_route" → presign
  // failed, see the presign_failed lines).
  logFeedServe({
    profileId: opts.profileId,
    requestedLimit: opts.limit,
    cursor: opts.cursor ?? null,
    nextCursor: nextCursor ?? null,
    returned: items.length,
    presignFailures,
    items,
  });

  return { items, nextCursor };
}

type ServedItem = ReturnType<typeof mapPostToDto>;

/** Strip query string so presigned signatures never land in logs. */
function redactUrlForLog(url: string | null | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?<redacted>`;
}

function classifyServedUrl(url: string | null | undefined): string {
  if (!url) return "none";
  if (url.startsWith("/api/")) return "api_route";
  if (/^https?:\/\//.test(url)) return "r2_direct";
  return "unknown";
}

function logFeedServe(info: {
  profileId: string;
  requestedLimit: number;
  cursor: string | null;
  nextCursor: string | null;
  returned: number;
  presignFailures: { mediaId: string; storageKey: string; err: string }[];
  items: ServedItem[];
}): void {
  try {
    for (const f of info.presignFailures) {
      console.error(
        "[feed-serve] presign_failed",
        JSON.stringify({ ...f, profileId: info.profileId }),
      );
    }
    console.log(
      JSON.stringify({
        tag: "feed-serve",
        ts: new Date().toISOString(),
        profileId: info.profileId,
        requestedLimit: info.requestedLimit,
        cursor: info.cursor,
        nextCursor: info.nextCursor,
        returned: info.returned,
        presignFailures: info.presignFailures.length,
        posts: info.items.map((p) => ({
          postId: p.id,
          channel: p.channel.title,
          mediaId: p.primaryMedia.id,
          type: p.primaryMedia.type,
          cacheStatus: p.primaryMedia.cacheStatus,
          srcKind: classifyServedUrl(p.primaryMedia.url),
          url: redactUrlForLog(p.primaryMedia.url),
          hasAudio: Boolean(p.audio),
          mediaItems: p.mediaItems?.length ?? 0,
        })),
      }),
    );
  } catch {
    // logging must never break the feed response
  }
}
