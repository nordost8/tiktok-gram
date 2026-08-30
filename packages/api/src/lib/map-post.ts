import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "../context";

type PostRow = {
  id: string;
  telegramUrl: string;
  text: string | null;
  caption: string | null;
  textDisplayUk: string | null;
  sourceLang: string | null;
  captionTranslationStatus:
    | "none"
    | "skipped"
    | "pending"
    | "ready"
    | "failed"
    | null;
  publishedAt: Date;
  internalViewsCount: number;
  internalLikesCount: number;
  internalSavesCount: number;
  internalSharesCount: number;
  audioTitle: string | null;
  audioAuthor: string | null;
  audioStorageKey: string | null;
  status:
    | "caching"
    | "needs_audio"
    | "fetching_audio"
    | "ready"
    | "failed";
  channel: {
    id: string;
    title: string;
    username: string;
    avatarUrl: string | null;
  };
  primaryMedia: {
    id: string;
    type: "photo" | "video" | "animation";
    thumbnailUrl: string | null;
    width: number | null;
    height: number | null;
    duration: number | null;
    mimeType: string | null;
    cacheStatus:
      | "needs_cache"
      | "downloading"
      | "ready"
      | "failed"
      | "skipped"
      | null;
    storageKey: string | null;
    cacheRangeReady: boolean;
  };
};

export function mediaApiPath(mediaId: string) {
  return `/api/media/${mediaId}`;
}

export function channelAvatarApiPath(channelId: string) {
  return `/api/channel-avatar/${channelId}`;
}

export function postAudioApiPath(descId: string) {
  return `/api/post-audio/${descId}`;
}

type MediaItemRow = {
  id: string;
  type: "photo" | "video" | "animation";
  width: number | null;
  height: number | null;
  mimeType: string | null;
  cacheStatus:
    | "needs_cache"
    | "downloading"
    | "ready"
    | "failed"
    | "skipped"
    | null;
  storageKey: string | null;
};

export function mapPostToDto(
  post: PostRow,
  viewerState: { liked: boolean; saved: boolean; subscribed: boolean },
  resolvedMediaUrls?: Map<string, string>,
  mediaItemRows?: MediaItemRow[],
) {
  const mediaItems =
    mediaItemRows && mediaItemRows.length > 0
      ? mediaItemRows.map((m) => ({
          id: m.id,
          type: m.type,
          url: resolvedMediaUrls?.get(m.id) ?? mediaApiPath(m.id),
          width: m.width,
          height: m.height,
          mimeType: m.mimeType,
        }))
      : undefined;

  // Music-enrichment hook — see services/music-enrichment/ (stubbed by default).
  // Present only when the post is ready AND has a track (audioStorageKey is the
  // non-null 'postgres' marker for photo posts now in PG). Video posts are
  // 'ready' with no audioStorageKey → no audio. Always use the PG-backed
  // /api/post-audio route (no R2 presigned URLs for audio).
  const audio =
    post.status === "ready" && post.audioStorageKey
      ? {
          url: postAudioApiPath(post.id),
          title: post.audioTitle,
          author: post.audioAuthor,
        }
      : undefined;

  return {
    id: post.id,
    telegramUrl: post.telegramUrl,
    text: post.text,
    caption: post.caption,
    displayText:
      post.captionTranslationStatus === "ready" && post.textDisplayUk
        ? post.textDisplayUk
        : null,
    originalText: post.caption ?? post.text ?? null,
    translationAvailable:
      post.captionTranslationStatus === "ready" &&
      Boolean(post.textDisplayUk?.trim()),
    sourceLang: post.sourceLang,
    publishedAt: post.publishedAt.toISOString(),
    channel: {
      id: post.channel.id,
      title: post.channel.title,
      username: post.channel.username,
      avatarUrl: channelAvatarApiPath(post.channel.id),
    },
    primaryMedia: {
      id: post.primaryMedia.id,
      type: post.primaryMedia.type,
      url: resolvedMediaUrls?.get(post.primaryMedia.id) ?? mediaApiPath(post.primaryMedia.id),
      thumbnailUrl: post.primaryMedia.thumbnailUrl,
      width: post.primaryMedia.width,
      height: post.primaryMedia.height,
      duration: post.primaryMedia.duration,
      mimeType: post.primaryMedia.mimeType,
      cacheStatus: post.primaryMedia.cacheStatus,
    },
    stats: {
      views: post.internalViewsCount,
      likes: post.internalLikesCount,
      saves: post.internalSavesCount,
      shares: post.internalSharesCount,
    },
    viewerState,
    audio,
    ...(mediaItems !== undefined ? { mediaItems } : {}),
  };
}

export function requireProfile(ctx: TRPCContext) {
  if (!ctx.profile) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Profile required: x-telegram-user-id or x-local-anonymous-id header",
    });
  }
  return ctx.profile;
}
