import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";

import {
  telegramAppProfiles,
  telegramInterestCategories,
  telegramProfileInterests,
} from "@tiktok-gram/db/schema";
import { saveInterestsInputSchema } from "@tiktok-gram/validators";

import { requireProfile } from "../lib/map-post";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const onboardingRouter = createTRPCRouter({
  getStatus: publicProcedure.query(async ({ ctx }) => {
    const profile = requireProfile(ctx);

    const available = await ctx.db
      .select()
      .from(telegramInterestCategories)
      .where(eq(telegramInterestCategories.isActive, true))
      .orderBy(asc(telegramInterestCategories.sortOrder));

    const selected = await ctx.db
      .select({
        id: telegramInterestCategories.id,
        slug: telegramInterestCategories.slug,
        title: telegramInterestCategories.title,
        description: telegramInterestCategories.description,
        emoji: telegramInterestCategories.emoji,
      })
      .from(telegramProfileInterests)
      .innerJoin(
        telegramInterestCategories,
        eq(telegramProfileInterests.interestId, telegramInterestCategories.id),
      )
      .where(eq(telegramProfileInterests.profileId, profile.id));

    return {
      onboardingCompleted: profile.onboardingCompleted,
      isAdmin: profile.isAdmin,
      selectedInterests: selected,
      availableInterests: available.map((i) => ({
        id: i.id,
        slug: i.slug,
        title: i.title,
        description: i.description,
        emoji: i.emoji,
      })),
    };
  }),

  saveInterests: publicProcedure
    .input(saveInterestsInputSchema)
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const found = await ctx.db
        .select({ id: telegramInterestCategories.id })
        .from(telegramInterestCategories)
        .where(inArray(telegramInterestCategories.id, input.interestIds));

      if (found.length !== input.interestIds.length) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid interest ids",
        });
      }

      await ctx.db
        .delete(telegramProfileInterests)
        .where(eq(telegramProfileInterests.profileId, profile.id));

      await ctx.db.insert(telegramProfileInterests).values(
        input.interestIds.map((interestId) => ({
          profileId: profile.id,
          interestId,
        })),
      );

      const [updated] = await ctx.db
        .update(telegramAppProfiles)
        .set({ onboardingCompleted: true })
        .where(eq(telegramAppProfiles.id, profile.id))
        .returning();

      return {
        onboardingCompleted: updated?.onboardingCompleted ?? true,
        profileId: profile.id,
      };
    }),

  /**
   * Full wipe: delete the profile row. Every user-owned table
   * (interests, subscriptions, likes, saves, views, suggestions) references the
   * profile with `onDelete: "cascade"`, so this removes all of the user's data
   * from the server. A fresh profile is auto-created on the next request, so the
   * user starts onboarding from a clean slate.
   */
  resetEverything: publicProcedure.mutation(async ({ ctx }) => {
    const profile = requireProfile(ctx);
    await ctx.db
      .delete(telegramAppProfiles)
      .where(eq(telegramAppProfiles.id, profile.id));
    return { ok: true };
  }),
});
