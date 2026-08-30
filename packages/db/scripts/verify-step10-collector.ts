import { eq, sql } from "drizzle-orm";

import { db, dbPool } from "../src/index";
import { telegramChannels, telegramPostMedia, telegramPosts } from "../src/schema";

const CHANNEL = "babel";

async function main() {
  const channel = await db.query.telegramChannels.findFirst({
    where: eq(telegramChannels.username, CHANNEL),
  });

  if (!channel) {
    throw new Error(`Missing @${CHANNEL} in telegram_channels`);
  }

  if (!channel.lastSyncedMessageId) {
    throw new Error(
      `@${CHANNEL} has no lastSyncedMessageId — run: pnpm telegram:collect ${CHANNEL}`,
    );
  }

  const refsCount = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM telegram_post_media m
    INNER JOIN telegram_posts p ON p.id = m.post_id
    WHERE p.channel_id = ${channel.id}
      AND p.status = 'ready'
      AND m.url IS NULL
      AND m.telegram_access_hash IS NOT NULL
  `);

  const refs = Number(refsCount.rows[0]?.count ?? 0);
  if (refs < 3) {
    throw new Error(
      `Expected >=3 ready @${CHANNEL} media rows with Telegram refs (no url), got ${refs}`,
    );
  }

  const seedOnly = await db.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count
    FROM telegram_post_media m
    INNER JOIN telegram_posts p ON p.id = m.post_id
    WHERE p.channel_id = ${channel.id}
      AND p.status = 'ready'
      AND m.url IS NOT NULL
      AND m.telegram_access_hash IS NULL
  `);

  console.log(
    JSON.stringify({
      ok: true,
      channel: CHANNEL,
      lastSyncedMessageId: channel.lastSyncedMessageId,
      readyWithTelegramRefs: refs,
      readyWithSeedUrls: Number(seedOnly.rows[0]?.count ?? 0),
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
