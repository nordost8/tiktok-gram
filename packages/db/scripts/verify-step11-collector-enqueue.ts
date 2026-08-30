import { eq } from "drizzle-orm";

import {
  db,
  dbPool,
  enqueueMediaCache,
  ingestPost,
} from "../src/index";
import { telegramChannels } from "../src/schema";

const CHANNEL = "__verify_step11_enqueue__";

async function ensureChannel() {
  const existing = await db.query.telegramChannels.findFirst({
    where: eq(telegramChannels.username, CHANNEL),
  });
  if (existing) return existing;

  const [inserted] = await db
    .insert(telegramChannels)
    .values({
      username: CHANNEL,
      title: "Enqueue verify",
      status: "active",
    })
    .returning();
  return inserted!;
}

async function main() {
  if (!process.env.REDIS_URL) {
    throw new Error("REDIS_URL required for enqueue verify");
  }

  const channel = await ensureChannel();
  const msgId = `enqueue-verify-${Date.now()}`;

  const result = await ingestPost(db, {
    channelId: channel.id,
    telegramMessageId: msgId,
    telegramUrl: `https://t.me/${CHANNEL}/${msgId}`,
    publishedAt: new Date(),
    media: [
      {
        type: "photo",
        telegramPhotoId: "999",
        telegramAccessHash: "888",
        telegramFileReference: "dGVzdA==",
        telegramDcId: 2,
        mimeType: "image/jpeg",
      },
    ],
  });

  if (result.status !== "awaiting_cache" || !result.isNew || !result.primaryMediaId) {
    throw new Error(
      `expected new awaiting_cache ingest, got ${JSON.stringify(result)}`,
    );
  }

  const enqueue = enqueueMediaCache(result.primaryMediaId);
  if (!enqueue.enqueued) {
    throw new Error(`enqueueMediaCache failed: ${JSON.stringify(enqueue)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      mediaId: result.primaryMediaId,
      jobId: enqueue.jobId,
      ingest: { status: result.status, isNew: result.isNew },
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
