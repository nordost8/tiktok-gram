import { count, desc, eq } from "drizzle-orm";
import { z } from "zod/v4";

import {
  channelSuggestions,
  telegramChannels,
  telegramInterestCategories,
  telegramProfileInterests,
  telegramUserChannelSubscriptions,
  telegramUserPostLikes,
  telegramUserPostSaves,
  telegramUserPostViews,
} from "@tiktok-gram/db/schema";

import { fetchFeedPosts } from "../lib/feed-query";
import { requireProfile } from "../lib/map-post";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const profileRouter = createTRPCRouter({
  me: publicProcedure.query(async ({ ctx }) => {
    const profile = requireProfile(ctx);

    const [[likes], [saves], [subs], selectedInterests] = await Promise.all([
      ctx.db
        .select({ value: count() })
        .from(telegramUserPostLikes)
        .where(eq(telegramUserPostLikes.profileId, profile.id)),
      ctx.db
        .select({ value: count() })
        .from(telegramUserPostSaves)
        .where(eq(telegramUserPostSaves.profileId, profile.id)),
      ctx.db
        .select({ value: count() })
        .from(telegramUserChannelSubscriptions)
        .where(eq(telegramUserChannelSubscriptions.profileId, profile.id)),
      ctx.db
        .select({
          id: telegramInterestCategories.id,
          slug: telegramInterestCategories.slug,
          title: telegramInterestCategories.title,
          emoji: telegramInterestCategories.emoji,
        })
        .from(telegramProfileInterests)
        .innerJoin(
          telegramInterestCategories,
          eq(telegramProfileInterests.interestId, telegramInterestCategories.id),
        )
        .where(eq(telegramProfileInterests.profileId, profile.id)),
    ]);

    return {
      profile: {
        id: profile.id,
        onboardingCompleted: profile.onboardingCompleted,
      },
      counters: {
        saved: saves?.value ?? 0,
        liked: likes?.value ?? 0,
        subscriptions: subs?.value ?? 0,
      },
      selectedInterests,
    };
  }),

  saved: publicProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const saves = await ctx.db
        .select({ descId: telegramUserPostSaves.descId })
        .from(telegramUserPostSaves)
        .where(eq(telegramUserPostSaves.profileId, profile.id));

      return fetchFeedPosts({
        db: ctx.db,
        profileId: profile.id,
        limit: input.limit,
        cursor: input.cursor,
        postIds: saves.map((s) => s.descId),
        excludeViewed: false,
        includeEvicted: true,
      });
    }),

  liked: publicProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const likes = await ctx.db
        .select({ descId: telegramUserPostLikes.descId })
        .from(telegramUserPostLikes)
        .where(eq(telegramUserPostLikes.profileId, profile.id));

      return fetchFeedPosts({
        db: ctx.db,
        profileId: profile.id,
        limit: input.limit,
        cursor: input.cursor,
        postIds: likes.map((l) => l.descId),
        excludeViewed: false,
        includeEvicted: true,
      });
    }),

  history: publicProcedure
    .input(z.object({ cursor: z.string().optional(), limit: z.number().default(20) }))
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      // Select ordered by viewedAt desc for newest-viewed-first intent.
      // fetchFeedPosts does NOT preserve postIds order (DB orderBy publishedAt + score sort + diversity);
      // parity with `liked` behavior. Ordering source: viewedAt in this select + feed-query post-filter.
      const views = await ctx.db
        .select({ descId: telegramUserPostViews.descId })
        .from(telegramUserPostViews)
        .where(eq(telegramUserPostViews.profileId, profile.id))
        .orderBy(desc(telegramUserPostViews.viewedAt));

      return fetchFeedPosts({
        db: ctx.db,
        profileId: profile.id,
        limit: input.limit,
        cursor: input.cursor,
        postIds: views.map((v) => v.descId),
        excludeViewed: false,
        includeEvicted: true,
      });
    }),

  suggestChannel: publicProcedure
    .input(z.object({ text: z.string().min(1).max(500), contact: z.string().max(128).optional() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const text = input.text.trim();
      const contact = input.contact?.trim() || null;
      await ctx.db.insert(channelSuggestions).values({
        profileId: profile.id,
        text,
        contact,
      });

      const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
      const adminChatId = process.env.ADMIN_CHAT_ID?.trim();
      if (token && adminChatId) {
        const from = profile.telegramUserId
          ? `<a href="tg://user?id=${profile.telegramUserId}">tg://user?id=${profile.telegramUserId}</a>`
          : `anonymous (${profile.localAnonymousId ?? profile.id})`;
        const contactLine = contact ? `\n📞 Contact: ${contact}` : "";
        const msg = `📢 Channel suggestion\n\nFrom: ${from}${contactLine}\n\n${text}`;
        void fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: adminChatId, text: msg, parse_mode: "HTML" }),
        }).catch(() => undefined);
      }

      return { ok: true };
    }),

  subscriptions: publicProcedure.query(async ({ ctx }) => {
    const profile = requireProfile(ctx);
    return ctx.db
      .select({
        id: telegramChannels.id,
        username: telegramChannels.username,
        title: telegramChannels.title,
        avatarUrl: telegramChannels.avatarUrl,
        categorySlug: telegramChannels.categorySlug,
      })
      .from(telegramUserChannelSubscriptions)
      .innerJoin(
        telegramChannels,
        eq(telegramUserChannelSubscriptions.channelId, telegramChannels.id),
      )
      .where(eq(telegramUserChannelSubscriptions.profileId, profile.id));
  }),
});
