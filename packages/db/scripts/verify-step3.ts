import { sql } from "drizzle-orm";

import { db, dbPool } from "../src/client";

async function main() {
  const stats = await db.execute<{
    interests: string;
    channels: string;
    ready: string;
    ready_refs: string;
  }>(sql`
    SELECT
      (SELECT count(*)::text FROM telegram_interest_categories WHERE is_active) AS interests,
      (SELECT count(*)::text FROM telegram_channels WHERE status = 'active') AS channels,
      (SELECT count(*)::text FROM telegram_posts WHERE status = 'ready') AS ready,
      (SELECT count(*)::text FROM telegram_post_media m
        INNER JOIN telegram_posts p ON p.id = m.post_id
        WHERE p.status = 'ready'
          AND m.telegram_access_hash IS NOT NULL) AS ready_refs
  `);

  const row = stats.rows[0];
  const interests = Number(row?.interests ?? 0);
  const channels = Number(row?.channels ?? 0);
  const ready = Number(row?.ready ?? 0);
  const readyRefs = Number(row?.ready_refs ?? 0);

  if (interests < 12) throw new Error(`Expected 12 interests, got ${interests}`);
  if (channels < 15) throw new Error(`Expected >=15 channels, got ${channels}`);
  if (readyRefs < 5) {
    throw new Error(
      `Expected >=5 ready posts with Telegram refs (run pnpm telegram:collect babel), got ${readyRefs}`,
    );
  }

  console.log(JSON.stringify({ ok: true, interests, channels, ready, readyRefs }));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbPool.end();
  });
