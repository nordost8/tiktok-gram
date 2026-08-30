import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";

import {
  telegramPostDescriptions,
  telegramPostMedia,
  telegramUserPostLikes,
  telegramUserPostSaves,
  telegramUserPostViews,
} from "@tiktok-gram/db/schema";

import { requireProfile } from "../lib/map-post";
import { createPreparedShareMessage } from "../lib/telegram-prepared-share";
import { createTRPCRouter, publicProcedure } from "../trpc";

export const interactionsRouter = createTRPCRouter({
  toggleLike: publicProcedure
    .input(z.object({ postId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const inserted = await ctx.db
        .insert(telegramUserPostLikes)
        .values({ profileId: profile.id, descId: input.postId })
        .onConflictDoNothing()
        .returning({ id: telegramUserPostLikes.id });

      if (inserted.length > 0) {
        await ctx.db
          .update(telegramPostDescriptions)
          .set({
            internalLikesCount: sql`${telegramPostDescriptions.internalLikesCount} + 1`,
          })
          .where(eq(telegramPostDescriptions.id, input.postId));
        return { liked: true };
      }

      const deleted = await ctx.db
        .delete(telegramUserPostLikes)
        .where(
          and(
            eq(telegramUserPostLikes.profileId, profile.id),
            eq(telegramUserPostLikes.descId, input.postId),
          ),
        )
        .returning({ id: telegramUserPostLikes.id });

      if (deleted.length > 0) {
        await ctx.db
          .update(telegramPostDescriptions)
          .set({
            internalLikesCount: sql`GREATEST(${telegramPostDescriptions.internalLikesCount} - 1, 0)`,
          })
          .where(eq(telegramPostDescriptions.id, input.postId));
      }

      return { liked: false };
    }),

  toggleSave: publicProcedure
    .input(z.object({ postId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const inserted = await ctx.db
        .insert(telegramUserPostSaves)
        .values({ profileId: profile.id, descId: input.postId })
        .onConflictDoNothing()
        .returning({ id: telegramUserPostSaves.id });

      if (inserted.length > 0) {
        await ctx.db
          .update(telegramPostDescriptions)
          .set({
            internalSavesCount: sql`${telegramPostDescriptions.internalSavesCount} + 1`,
          })
          .where(eq(telegramPostDescriptions.id, input.postId));
        return { saved: true };
      }

      const deleted = await ctx.db
        .delete(telegramUserPostSaves)
        .where(
          and(
            eq(telegramUserPostSaves.profileId, profile.id),
            eq(telegramUserPostSaves.descId, input.postId),
          ),
        )
        .returning({ id: telegramUserPostSaves.id });

      if (deleted.length > 0) {
        await ctx.db
          .update(telegramPostDescriptions)
          .set({
            internalSavesCount: sql`GREATEST(${telegramPostDescriptions.internalSavesCount} - 1, 0)`,
          })
          .where(eq(telegramPostDescriptions.id, input.postId));
      }

      return { saved: false };
    }),

  recordView: publicProcedure
    .input(
      z.object({
        postId: z.string().uuid(),
        durationMs: z.number().int().optional(),
        completedPercent: z.number().int().min(0).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const [row] = await ctx.db
        .insert(telegramUserPostViews)
        .values({
          profileId: profile.id,
          descId: input.postId,
          durationMs: input.durationMs,
          completedPercent: input.completedPercent,
        })
        .onConflictDoUpdate({
          target: [
            telegramUserPostViews.profileId,
            telegramUserPostViews.descId,
          ],
          set: {
            viewedAt: sql`now()`,
            durationMs: sql`GREATEST(
              COALESCE(${telegramUserPostViews.durationMs}, 0),
              COALESCE(${input.durationMs ?? null}, 0)
            )`,
            completedPercent: sql`GREATEST(
              COALESCE(${telegramUserPostViews.completedPercent}, 0),
              COALESCE(${input.completedPercent ?? null}, 0)
            )`,
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` });

      if (row?.inserted) {
        await ctx.db
          .update(telegramPostDescriptions)
          .set({
            internalViewsCount: sql`${telegramPostDescriptions.internalViewsCount} + 1`,
          })
          .where(eq(telegramPostDescriptions.id, input.postId));
      }

      return { ok: true, firstView: row?.inserted ?? false };
    }),

  recordShare: publicProcedure
    .input(z.object({ postId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const profile = requireProfile(ctx);

      const post = await ctx.db.query.telegramPostDescriptions.findFirst({
        where: eq(telegramPostDescriptions.id, input.postId),
        with: { channel: true },
      });

      if (!post) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Post not found" });
      }

      await ctx.db
        .update(telegramPostDescriptions)
        .set({
          internalSharesCount: sql`${telegramPostDescriptions.internalSharesCount} + 1`,
        })
        .where(eq(telegramPostDescriptions.id, input.postId));

      let preparedMessageId: string | null = null;
      if (profile.telegramUserId) {
        // Derive isPhoto from primary media (type "photo" when no video/animation wins the
        // selection: access hash present + ready-first + video>anim>photo order, same as feed-query CTE).
        const primaryMediaRows = await ctx.db
          .select({ type: telegramPostMedia.type })
          .from(telegramPostMedia)
          .where(
            and(
              eq(telegramPostMedia.descId, input.postId),
              sql`${telegramPostMedia.telegramAccessHash} IS NOT NULL`,
            ),
          )
          .orderBy(
            sql`CASE WHEN ${telegramPostMedia.cacheStatus} = 'ready' THEN 0 ELSE 1 END`,
            sql`CASE WHEN ${telegramPostMedia.type} = 'video' THEN 1 WHEN ${telegramPostMedia.type} = 'animation' THEN 2 ELSE 3 END`,
            desc(telegramPostMedia.duration),
            desc(telegramPostMedia.sizeBytes),
          )
          .limit(1);
        const primaryType = primaryMediaRows[0]?.type;
        const isPhoto = primaryType === "photo";

        preparedMessageId = await createPreparedShareMessage(
          profile.telegramUserId,
          {
            postId: post.id,
            channelTitle: post.channel.title,
            telegramUrl: post.telegramUrl,
            text: post.text,
            caption: post.caption,
            hasAudio: post.status === "ready" && Boolean(post.audioStorageKey),
            isPhoto,
          },
        );
      }

      return { shareUrl: post.telegramUrl, preparedMessageId };
    }),
});
