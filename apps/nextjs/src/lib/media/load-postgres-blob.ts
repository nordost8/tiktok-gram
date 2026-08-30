import { eq } from "drizzle-orm";

import { db } from "@tiktok-gram/db/client";
import { telegramPostMedia } from "@tiktok-gram/db/schema";

export type MediaBlob = {
  data: Buffer;
  mimeType: string;
  sizeBytes: number;
};

export async function loadMediaBlobFromPostgres(
  mediaId: string,
): Promise<MediaBlob | null> {
  const rows = await db
    .select({
      data: telegramPostMedia.cachedData,
      mimeType: telegramPostMedia.mimeType,
      sizeBytes: telegramPostMedia.cachedSizeBytes,
    })
    .from(telegramPostMedia)
    .where(eq(telegramPostMedia.id, mediaId))
    .limit(1);

  const row = rows[0];
  if (!row?.data) {
    return null;
  }

  const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
  return {
    data,
    mimeType: row.mimeType ?? "image/jpeg",
    sizeBytes: row.sizeBytes ?? data.length,
  };
}
