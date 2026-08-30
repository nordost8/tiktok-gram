import { eq } from "drizzle-orm";

import type { Db } from "./profile";
import { isVideoOnlyFeed } from "./select-primary-media";
import { mediaTypeEnum, telegramPostDescriptions, telegramPostMedia } from "./schema";

export type IngestMediaInput = {
  type: (typeof mediaTypeEnum.enumValues)[number];
  thumbnailUrl?: string | null;
  telegramFileId?: string | null;
  telegramDocumentId?: string | null;
  telegramPhotoId?: string | null;
  telegramAccessHash?: string | null;
  telegramFileReference?: string | null;
  telegramDcId?: number | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  sizeBytes?: number | null;
};

export type IngestPostInput = {
  channelId: string;
  telegramMessageId: string;
  groupedId?: string | null;
  telegramUrl: string;
  text?: string | null;
  caption?: string | null;
  publishedAt: Date;
  media: IngestMediaInput[];
};

function mediaHasResolvableSource(media: IngestMediaInput): boolean {
  if (!media.telegramAccessHash) return false;
  return Boolean(media.telegramDocumentId ?? media.telegramPhotoId);
}

export async function ingestPost(
  db: Db,
  input: IngestPostInput,
): Promise<{ descId: string | null; isNew: boolean; mediaIds: string[] }> {
  const validMedia = input.media.filter(mediaHasResolvableSource);

  if (validMedia.length === 0) return { descId: null, isNew: false, mediaIds: [] };

  if (isVideoOnlyFeed()) {
    const hasVideo = validMedia.some(
      (m) => m.type === "video" || m.type === "animation",
    );
    if (!hasVideo) return { descId: null, isNew: false, mediaIds: [] };
  }

  return db.transaction(async (tx) => {
    let descId: string;
    let isNew = false;

    if (input.groupedId) {
      const existing = await tx.query.telegramPostDescriptions.findFirst({
        where: (d, { and: andFn, eq: eqFn }) =>
          andFn(
            eqFn(d.channelId, input.channelId),
            eqFn(d.telegramGroupedId, input.groupedId!),
          ),
      });

      if (existing) {
        descId = existing.id;
        if (!existing.text && (input.text ?? input.caption)) {
          await tx
            .update(telegramPostDescriptions)
            .set({ text: input.text, caption: input.caption })
            .where(eq(telegramPostDescriptions.id, existing.id));
        }
      } else {
        const [desc] = await tx
          .insert(telegramPostDescriptions)
          .values({
            channelId: input.channelId,
            telegramMessageId: input.telegramMessageId,
            telegramGroupedId: input.groupedId,
            telegramUrl: input.telegramUrl,
            text: input.text,
            caption: input.caption,
            publishedAt: input.publishedAt,
          })
          .returning();
        descId = desc!.id;
        isNew = true;
      }
    } else {
      const [desc] = await tx
        .insert(telegramPostDescriptions)
        .values({
          channelId: input.channelId,
          telegramMessageId: input.telegramMessageId,
          telegramUrl: input.telegramUrl,
          text: input.text,
          caption: input.caption,
          publishedAt: input.publishedAt,
        })
        .onConflictDoNothing()
        .returning();

      if (!desc) return { descId: null, isNew: false, mediaIds: [] };
      descId = desc.id;
      isNew = true;
    }

    const mediaRows = await tx
      .insert(telegramPostMedia)
      .values(
        validMedia.map((m) => ({
          descId,
          type: m.type,
          thumbnailUrl: m.thumbnailUrl,
          telegramFileId: m.telegramFileId,
          telegramDocumentId: m.telegramDocumentId,
          telegramPhotoId: m.telegramPhotoId,
          telegramAccessHash: m.telegramAccessHash,
          telegramFileReference: m.telegramFileReference,
          telegramDcId: m.telegramDcId,
          mimeType: m.mimeType,
          width: m.width,
          height: m.height,
          duration: m.duration,
          sizeBytes: m.sizeBytes,
          cacheStatus: "needs_cache" as const,
        })),
      )
      .returning({ id: telegramPostMedia.id });

    return { descId, isNew, mediaIds: mediaRows.map((m) => m.id) };
  });
}
