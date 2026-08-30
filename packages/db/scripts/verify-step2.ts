import { sql } from "drizzle-orm";

import { db, dbPool, getOrCreateProfile } from "../src/index";

async function main() {
  const tables = await db.execute<{ tablename: string }>(sql`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'telegram_%'
    ORDER BY tablename
  `);

  const names = tables.rows.map((r) => r.tablename);
  const expected = [
    "telegram_app_profiles",
    "telegram_channels",
    "telegram_interest_categories",
    "telegram_post_media",
    "telegram_posts",
    "telegram_profile_interests",
    "telegram_user_channel_subscriptions",
    "telegram_user_post_likes",
    "telegram_user_post_saves",
    "telegram_user_post_views",
  ];

  for (const table of expected) {
    if (!names.includes(table)) {
      throw new Error(`Missing table: ${table}`);
    }
  }

  const tgProfile = await getOrCreateProfile(db, {
    telegramUserId: "verify-tg-123",
  });
  const localProfile = await getOrCreateProfile(db, {
    localAnonymousId: "verify-local-456",
  });
  const tgAgain = await getOrCreateProfile(db, {
    telegramUserId: "verify-tg-123",
  });

  if (tgProfile.id !== tgAgain.id) {
    throw new Error("getOrCreateProfile should return same telegram profile");
  }

  console.log(
    JSON.stringify({
      ok: true,
      tables: names.length,
      telegramProfileId: tgProfile.id,
      localProfileId: localProfile.id,
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
