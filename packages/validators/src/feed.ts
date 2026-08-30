import { z } from "zod/v4";

export const feedInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(30).default(10),
});

export const mediaCacheStatusSchema = z.enum([
  "needs_cache",
  "downloading",
  "ready",
  "failed",
  "skipped",
]);

export const mediaDtoSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["photo", "video", "animation"]),
  url: z.string().startsWith("/api/media/"),
  thumbnailUrl: z.string().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  duration: z.number().nullable().optional(),
  cacheStatus: mediaCacheStatusSchema.nullable().optional(),
});

export const feedPostDtoSchema = z.object({
  id: z.string().uuid(),
  telegramUrl: z.string(),
  text: z.string().nullable(),
  caption: z.string().nullable(),
  displayText: z.string().nullable().optional(),
  originalText: z.string().nullable().optional(),
  translationAvailable: z.boolean().optional(),
  sourceLang: z.string().nullable().optional(),
  publishedAt: z.string(),
  channel: z.object({
    id: z.string().uuid(),
    title: z.string(),
    username: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  primaryMedia: mediaDtoSchema,
  stats: z.object({
    views: z.number(),
    likes: z.number(),
    saves: z.number(),
    shares: z.number(),
  }),
  viewerState: z.object({
    liked: z.boolean(),
    saved: z.boolean(),
    subscribed: z.boolean(),
  }),
});

export const feedEmptyReasonSchema = z.enum([
  "no_content",
  "all_viewed",
  "no_subscriptions",
]);

export const feedOutputSchema = z.object({
  items: z.array(feedPostDtoSchema),
  nextCursor: z.string().optional(),
  /** Set on first page when items is empty — distinguishes no videos vs all watched. */
  emptyReason: feedEmptyReasonSchema.optional(),
});
