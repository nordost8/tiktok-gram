import { eq, sql } from "drizzle-orm";

import { db, dbPool, ingestPost } from "../src/index";
import { telegramChannels, telegramPostMedia, telegramPosts } from "../src/schema";

const TEST_CHANNEL_USERNAME = "__verify_step10__";

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

async function main() {
  await assertColumn("telegram_post_media", "url", "text", true);
  await assertColumn("telegram_post_media", "resolved_url", "text", true);
  await assertColumn(
    "telegram_post_media",
    "resolved_url_expires_at",
    "timestamp with time zone",
    true,
  );
  await assertColumn("telegram_post_media", "telegram_document_id", "text", true);
  await assertColumn("telegram_post_media", "telegram_access_hash", "text", true);
  await assertColumn("telegram_channels", "last_synced_message_id", "character varying", true);

  let channel = await db.query.telegramChannels.findFirst({
    where: eq(telegramChannels.username, TEST_CHANNEL_USERNAME),
  });

  if (!channel) {
    const [inserted] = await db
      .insert(telegramChannels)
      .values({
        username: TEST_CHANNEL_USERNAME,
        title: "Step 10 verify",
        status: "active",
      })
      .returning();
    channel = inserted!;
  }

  const refsMsgId = `verify-refs-${Date.now()}`;
  const refs = await ingestPost(db, {
    channelId: channel.id,
    telegramMessageId: refsMsgId,
    telegramUrl: `https://t.me/${TEST_CHANNEL_USERNAME}/${refsMsgId}`,
    publishedAt: new Date(),
    media: [
      {
        type: "video",
        telegramDocumentId: "1234567890123456789",
        telegramAccessHash: "9876543210987654321",
        telegramFileReference: "dGVzdC1yZWY=",
        telegramDcId: 2,
        mimeType: "video/mp4",
        width: 1280,
        height: 720,
        duration: 30,
        sizeBytes: 5_000_000,
      },
    ],
  });

  if (refs.status !== "ready") {
    throw new Error(`Refs ingest expected ready, got ${refs.status}`);
  }

  const refsMedia = await db.query.telegramPostMedia.findFirst({
    where: eq(telegramPostMedia.postId, refs.post!.id),
  });

  if (refsMedia?.url) {
    throw new Error("Refs ingest should not require url");
  }
  if (
    refsMedia?.telegramDocumentId !== "1234567890123456789" ||
    refsMedia.telegramAccessHash !== "9876543210987654321"
  ) {
    throw new Error("Refs ingest did not persist Telegram MTProto fields");
  }

  await db
    .delete(telegramPosts)
    .where(
      sql`${telegramPosts.channelId} = ${channel.id} AND ${telegramPosts.telegramMessageId} LIKE 'verify-%'`,
    );

  console.log(
    JSON.stringify({
      ok: true,
      refsPostId: refs.post?.id,
      refsMediaId: refsMedia?.id,
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
