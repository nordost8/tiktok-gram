import { eq } from "drizzle-orm";
import { z } from "zod/v4";

import { feedDebugLogs, telegramUserChannelSubscriptions } from "@tiktok-gram/db/schema";
import { feedInputSchema } from "@tiktok-gram/validators";

import { fetchFeedPosts } from "../lib/feed-query";
import { requireProfile } from "../lib/map-post";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const feedRouter = createTRPCRouter({
  forYou: publicProcedure.input(feedInputSchema).query(async ({ ctx, input }) => {
    const profile = requireProfile(ctx);
    return fetchFeedPosts({
      db: ctx.db,
      profileId: profile.id,
      limit: input.limit,
      cursor: input.cursor,
      resolveMediaUrl: ctx.resolveMediaUrl,
    });
  }),

  /** Fetch a single post by id — used by share deeplinks (?startapp=post_<id>). */
  byId: publicProcedure
    .input(z.object({ postId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const res = await fetchFeedPosts({
        db: ctx.db,
        profileId: profile.id,
        limit: 1,
        postIds: [input.postId],
        excludeViewed: false,
        includeEvicted: true,
        resolveMediaUrl: ctx.resolveMediaUrl,
      });
      return res.items[0] ?? null;
    }),

  subscriptions: publicProcedure
    .input(feedInputSchema)
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const subs = await ctx.db
        .select({ channelId: telegramUserChannelSubscriptions.channelId })
        .from(telegramUserChannelSubscriptions)
        .where(eq(telegramUserChannelSubscriptions.profileId, profile.id));

      if (subs.length === 0) {
        return {
          items: [],
          nextCursor: undefined,
          emptyReason: "no_subscriptions" as const,
        };
      }

      const channelIds = subs.map((s) => s.channelId);
      return fetchFeedPosts({
        db: ctx.db,
        profileId: profile.id,
        limit: input.limit,
        cursor: input.cursor,
        channelIds,
        preloadedSubscribedChannelIds: channelIds,
        resolveMediaUrl: ctx.resolveMediaUrl,
      });
    }),

  logEvent: publicProcedure
    .input(
      z.object({
        eventType: z.enum([
          "swipe_next",
          "swipe_prev",
          "swipe_blocked",
          "feed_loaded",
          "feed_exhausted",
          "page_fetched",
        ]),
        tab: z.enum(["forYou", "subscriptions"]).optional(),
        activeIndex: z.number().int().optional(),
        totalPosts: z.number().int().optional(),
        pagesLoaded: z.number().int().optional(),
        hasNextPage: z.boolean().optional(),
        isFetching: z.boolean().optional(),
        postId: z.string().optional(),
        cursorSnapshot: z.string().optional(),
        blockReason: z.string().optional(),
        extra: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(feedDebugLogs).values({
        profileId: ctx.profile?.id ?? null,
        ...input,
      });
      return { ok: true };
    }),
});
