import { eq, sql } from "drizzle-orm";

import { db, dbPool, ingestPost } from "../src/index";
import { telegramChannels, telegramPostMedia, telegramPosts } from "../src/schema";

const TEST_CHANNEL_USERNAME = "__verify_step11__";

async function assertColumn(
  table: string,
  column: string,
  dataType: string,
  isNullable: boolean,
) {
  const result = await db.execute<{
    data_type: string;
    is_nullable: string;
  }>(sql`
    SELECT data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${table}
      AND column_name = ${column}
  `);

  const row = result.rows[0];
  if (!row) {
    throw new Error(`Missing column ${table}.${column}`);
  }
  if (row.data_type !== dataType) {
    throw new Error(
      `Column ${table}.${column}: expected type ${dataType}, got ${row.data_type}`,
    );
  }
  const nullable = row.is_nullable === "YES";
  if (nullable !== isNullable) {
    throw new Error(
      `Column ${table}.${column}: expected nullable=${isNullable}, got ${nullable}`,
    );
  }
}

async function assertEnumValues(enumName: string, expected: string[]) {
  const result = await db.execute<{ enumlabel: string }>(sql`
    SELECT e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = ${enumName}
    ORDER BY e.enumsortorder
  `);
  const labels = result.rows.map((r) => r.enumlabel);
  if (labels.join(",") !== expected.join(",")) {
    throw new Error(
      `Enum ${enumName}: expected [${expected.join(", ")}], got [${labels.join(", ")}]`,
    );
  }
}

async function main() {
  await assertEnumValues("telegram_media_cache_status", [
    "needs_cache",
    "downloading",
    "ready",
    "failed",
    "skipped",
  ]);

  await assertColumn("telegram_post_media", "cache_status", "USER-DEFINED", true);
  await assertColumn("telegram_post_media", "storage_backend", "character varying", true);
  await assertColumn("telegram_post_media", "storage_bucket", "text", true);
  await assertColumn("telegram_post_media", "storage_key", "text", true);
  await assertColumn("telegram_post_media", "cached_size_bytes", "integer", true);
  await assertColumn("telegram_post_media", "cached_mime_type", "text", true);
  await assertColumn(
    "telegram_post_media",
    "cache_download_started_at",
    "timestamp with time zone",
    true,
  );
  await assertColumn(
    "telegram_post_media",
    "cache_downloaded_at",
    "timestamp with time zone",
    true,
  );
  await assertColumn(
    "telegram_post_media",
    "cache_failed_at",
    "timestamp with time zone",
    true,
  );
  await assertColumn("telegram_post_media", "last_cache_error", "text", true);
  await assertColumn("telegram_post_media", "cache_attempt_count", "integer", false);
  await assertColumn("telegram_post_media", "cache_checksum", "text", true);
  await assertColumn("telegram_post_media", "cache_range_ready", "boolean", false);

  let channel = await db.query.telegramChannels.findFirst({
    where: eq(telegramChannels.username, TEST_CHANNEL_USERNAME),
  });

  if (!channel) {
    const [inserted] = await db
      .insert(telegramChannels)
      .values({
        username: TEST_CHANNEL_USERNAME,
        title: "Step 11 verify",
        status: "active",
      })
      .returning();
    channel = inserted!;
  }

  const msgId = `verify-step11-${Date.now()}`;
  const ingested = await ingestPost(db, {
    channelId: channel.id,
    telegramMessageId: msgId,
    telegramUrl: `https://t.me/${TEST_CHANNEL_USERNAME}/${msgId}`,
    publishedAt: new Date(),
    media: [
      {
        type: "video",
        telegramDocumentId: "111",
        telegramAccessHash: "222",
        telegramFileReference: "dGVzdA==",
        telegramDcId: 2,
        mimeType: "video/mp4",
        sizeBytes: 1024,
      },
    ],
  });

  if (ingested.status !== "awaiting_cache") {
    throw new Error(`Ingest expected awaiting_cache, got ${ingested.status}`);
  }

  const media = await db.query.telegramPostMedia.findFirst({
    where: eq(telegramPostMedia.postId, ingested.post!.id),
  });

  if (media?.cacheStatus !== "needs_cache") {
    throw new Error(
      `New media should start as needs_cache, got ${media?.cacheStatus ?? "null"}`,
    );
  }
  if (media?.cacheAttemptCount !== 0) {
    throw new Error(`cacheAttemptCount should be 0, got ${media?.cacheAttemptCount}`);
  }
  if (media?.cacheRangeReady !== false) {
    throw new Error(`cacheRangeReady should be false before cache, got ${media?.cacheRangeReady}`);
  }

  const downloadedAt = new Date("2026-05-17T12:00:00.000Z");
  const [ready] = await db
    .update(telegramPostMedia)
    .set({
      cacheStatus: "ready",
      storageBackend: "minio",
      storageBucket: "tiktok-gram-media",
      storageKey: `media/${media!.id}.mp4`,
      cachedSizeBytes: 1024,
      cachedMimeType: "video/mp4",
      cacheDownloadedAt: downloadedAt,
      cacheRangeReady: true,
      lastCacheError: null,
      cacheFailedAt: null,
    })
    .where(eq(telegramPostMedia.id, media!.id))
    .returning();

  if (
    ready?.cacheStatus !== "ready" ||
    ready.storageKey !== `media/${media!.id}.mp4` ||
    !ready.cacheRangeReady
  ) {
    throw new Error("Failed to persist ready cache metadata");
  }

  const [failed] = await db
    .update(telegramPostMedia)
    .set({
      cacheStatus: "failed",
      cacheFailedAt: new Date(),
      lastCacheError: "FloodWaitError: retry in 30s",
      cacheAttemptCount: 3,
      cacheRangeReady: false,
      storageKey: null,
      storageBucket: null,
    })
    .where(eq(telegramPostMedia.id, media!.id))
    .returning();

  if (failed?.cacheStatus !== "failed" || failed.cacheAttemptCount !== 3) {
    throw new Error("Failed to persist failed cache state");
  }

  const backfill = await db.execute<{ updated: string }>(sql`
    WITH updated AS (
      UPDATE telegram_post_media
      SET cache_status = 'needs_cache'
      WHERE cache_status IS NULL
        AND telegram_access_hash IS NOT NULL
        AND (telegram_document_id IS NOT NULL OR telegram_photo_id IS NOT NULL)
      RETURNING id
    )
    SELECT count(*)::text AS updated FROM updated
  `);

  await db
    .delete(telegramPosts)
    .where(
      sql`${telegramPosts.channelId} = ${channel.id} AND ${telegramPosts.telegramMessageId} LIKE 'verify-step11-%'`,
    );

  console.log(
    JSON.stringify({
      ok: true,
      testMediaId: media?.id,
      backfilledNeedsCache: backfill.rows[0]?.updated ?? "0",
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbPool.end();
  });
