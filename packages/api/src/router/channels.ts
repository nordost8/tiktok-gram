import { and, asc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod/v4";

import {
  telegramChannels,
  telegramInterestCategories,
  telegramUserChannelSubscriptions,
  telegramUserHiddenChannels,
} from "@tiktok-gram/db/schema";

import { attachSubscriptionState } from "../lib/map-channel";
import { requireProfile } from "../lib/map-post";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const channelsRouter = createTRPCRouter({
  categories: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        slug: telegramInterestCategories.slug,
        title: telegramInterestCategories.title,
        emoji: telegramInterestCategories.emoji,
      })
      .from(telegramInterestCategories)
      .where(eq(telegramInterestCategories.isActive, true))
      .orderBy(asc(telegramInterestCategories.sortOrder));
  }),

  list: publicProcedure
    .input(z.object({ categorySlug: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const conditions = [eq(telegramChannels.status, "active")];
      if (input?.categorySlug) {
        conditions.push(eq(telegramChannels.categorySlug, input.categorySlug));
      }

      const rows = await ctx.db
        .select()
        .from(telegramChannels)
        .where(and(...conditions))
        .orderBy(asc(telegramChannels.title));

      return attachSubscriptionState(ctx.db, profile.id, rows);
    }),

  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      const q = `%${input.query.trim()}%`;
      const rows = await ctx.db
        .select()
        .from(telegramChannels)
        .where(
          and(
            eq(telegramChannels.status, "active"),
            or(
              ilike(telegramChannels.username, q),
              ilike(telegramChannels.title, q),
              ilike(telegramChannels.categorySlug, q),
            ),
          ),
        )
        .limit(30);

      return attachSubscriptionState(ctx.db, profile.id, rows);
    }),

  toggleSubscribe: publicProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const existing = await ctx.db.query.telegramUserChannelSubscriptions.findFirst(
        {
          where: (t, { and, eq: eqFn }) =>
            and(
              eqFn(t.profileId, profile.id),
              eqFn(t.channelId, input.channelId),
            ),
        },
      );

      if (existing) {
        await ctx.db
          .delete(telegramUserChannelSubscriptions)
          .where(eq(telegramUserChannelSubscriptions.id, existing.id));
        return { subscribed: false };
      }

      await ctx.db.insert(telegramUserChannelSubscriptions).values({
        profileId: profile.id,
        channelId: input.channelId,
      });

      return { subscribed: true };
    }),

  /** Hide a channel from the user's feed (reversible in Settings). */
  hideChannel: publicProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      await ctx.db
        .insert(telegramUserHiddenChannels)
        .values({
          profileId: profile.id,
          channelId: input.channelId,
        })
        .onConflictDoNothing();
      return { hidden: true };
    }),

  unhideChannel: publicProcedure
    .input(z.object({ channelId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);
      await ctx.db
        .delete(telegramUserHiddenChannels)
        .where(
          and(
            eq(telegramUserHiddenChannels.profileId, profile.id),
            eq(telegramUserHiddenChannels.channelId, input.channelId),
          ),
        );
      return { hidden: false };
    }),

  listHidden: publicProcedure.query(async ({ ctx }) => {
    const profile = requireProfile(ctx);
    const rows = await ctx.db
      .select({
        channelId: telegramChannels.id,
        title: telegramChannels.title,
        username: telegramChannels.username,
        avatarUrl: telegramChannels.avatarUrl,
      })
      .from(telegramUserHiddenChannels)
      .innerJoin(
        telegramChannels,
        eq(telegramUserHiddenChannels.channelId, telegramChannels.id),
      )
      .where(eq(telegramUserHiddenChannels.profileId, profile.id))
      .orderBy(asc(telegramChannels.title));

    return rows.map((r) => ({
      id: r.channelId,
      title: r.title,
      username: r.username,
      avatarUrl: r.avatarUrl,
    }));
  }),
});
