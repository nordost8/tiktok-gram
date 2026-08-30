import { sql } from "drizzle-orm";

import { db, dbPool } from "../src/client";
import { telegramChannels, telegramInterestCategories } from "../src/schema";

// Canonical (English) category copy — the DB's source of truth and the
// fallback whenever a viewer's locale has no override. Ukrainian overrides,
// keyed by the same `slug`, live in
// apps/nextjs/src/lib/i18n/category-labels.ts (categories are DB content, not
// static UI copy, so they can't go through the normal t() catalog — see
// docs/i18n.md).
const INTERESTS = [
  {
    slug: "it-tech",
    emoji: "💻",
    title: "IT & Tech",
    description: "Habr, AI, programming, startups, crypto",
    sortOrder: 1,
  },
  {
    slug: "business-finance",
    emoji: "💼",
    title: "Business & Finance",
    description: "Business news, investing, real estate",
    sortOrder: 2,
  },
  {
    slug: "creativity",
    emoji: "🎨",
    title: "Creativity",
    description: "Film, music, art, photography",
    sortOrder: 3,
  },
  {
    slug: "lifestyle",
    emoji: "🌸",
    title: "Lifestyle",
    description: "Fashion, food, travel, cars, life style",
    sortOrder: 4,
  },
  {
    slug: "psychology",
    emoji: "🧠",
    title: "Psychology & Growth",
    description: "Motivation, relationships, parenting, self-development",
    sortOrder: 5,
  },
  {
    slug: "sport-games",
    emoji: "🏃",
    title: "Sport & Games",
    description: "Sports, esports, fitness, health",
    sortOrder: 6,
  },
  {
    slug: "science-edu",
    emoji: "🔬",
    title: "Science & Education",
    description: "Popular science, education, courses",
    sortOrder: 7,
  },
  {
    slug: "humor-memes",
    emoji: "😂",
    title: "Humor & Memes",
    description: "Jokes, memes, trending comedy",
    sortOrder: 8,
  },
  {
    slug: "news",
    emoji: "📰",
    title: "News",
    description: "Daily highlights, politics, society",
    sortOrder: 9,
  },
  {
    slug: "war-osint",
    emoji: "🪖",
    title: "War & OSINT",
    description: "Frontline updates, analysis, investigations, security",
    sortOrder: 10,
  },
  {
    slug: "local",
    emoji: "🏙",
    title: "Local",
    description: "Cities, events, local news",
    sortOrder: 11,
  },
  {
    slug: "video",
    emoji: "🎬",
    title: "Video",
    description: "Short videos, clips, highlights",
    sortOrder: 12,
  },
  {
    slug: "gaming",
    emoji: "🎮",
    title: "Gaming",
    description: "Games, esports, streaming",
    sortOrder: 13,
  },
  {
    slug: "entertainment",
    emoji: "🌟",
    title: "Entertainment",
    description: "Celebrities, TV shows, showbiz",
    sortOrder: 14,
  },
  {
    slug: "culinary",
    emoji: "🍽️",
    title: "Culinary",
    description: "Recipes, dishes, cooking tips",
    sortOrder: 15,
  },
  {
    slug: "auto-moto",
    emoji: "🚗",
    title: "Auto & Moto",
    description: "Cars, motorcycles, test drives",
    sortOrder: 16,
  },
  {
    slug: "medicine",
    emoji: "🩺",
    title: "Medicine",
    description: "Health, medical advice, medicine news",
    sortOrder: 17,
  },
  {
    slug: "sports",
    emoji: "⚽",
    title: "Sports",
    description: "Football, Formula 1, sports news",
    sortOrder: 18,
  },
  {
    slug: "nostalgia",
    emoji: "🕰️",
    title: "Nostalgia",
    description: "Memories, retro, the past",
    sortOrder: 19,
  },
  {
    slug: "fashion",
    emoji: "👗",
    title: "Fashion",
    description: "Style, clothing, trends",
    sortOrder: 20,
  },
  {
    slug: "design",
    emoji: "✏️",
    title: "Design",
    description: "Graphic design, UI/UX, creative work",
    sortOrder: 21,
  },
] as const;

const CHANNELS = [
  { username: "devua", title: "Dev.ua", categorySlug: "it-tech" },
  { username: "babel", title: "Babel", categorySlug: "news" },
  { username: "suspilnenews", title: "Суспільне Новини", categorySlug: "news" },
  { username: "tsnua", title: "ТСН", categorySlug: "news" },
  { username: "ukrinform_ua", title: "Укрінформ", categorySlug: "news" },
  { username: "enjoy_digital", title: "Enjoy Digital", categorySlug: "it-tech" },
  { username: "memes_ukraine", title: "Меми України", categorySlug: "humor-memes" },
  { username: "sport_ua", title: "Спорт UA", categorySlug: "sport-games" },
  { username: "kyiv_city", title: "Київ", categorySlug: "local" },
  { username: "lviv_city", title: "Львів", categorySlug: "local" },
  { username: "science_pop_ua", title: "Наука UA", categorySlug: "science-edu" },
  { username: "biz_ua", title: "Бізнес UA", categorySlug: "business-finance" },
  { username: "psy_ua", title: "Психологія UA", categorySlug: "psychology" },
  { username: "lifestyle_ua", title: "Лайфстайл UA", categorySlug: "lifestyle" },
  { username: "cinema_ua", title: "Кіно UA", categorySlug: "creativity" },
  { username: "osint_ua", title: "OSINT UA", categorySlug: "war-osint" },
  { username: "shorts_ua", title: "Shorts UA", categorySlug: "video" },
  { username: "whackdoor", title: "Бэкдор", categorySlug: "war-osint" },
  { username: "tech_digest", title: "Tech Digest", categorySlug: "it-tech" },
  { username: "crypto_ua", title: "Крипто UA", categorySlug: "business-finance" },
] as const;

async function seedInterests() {
  for (const interest of INTERESTS) {
    await db
      .insert(telegramInterestCategories)
      .values({ ...interest, isActive: true })
      .onConflictDoUpdate({
        target: telegramInterestCategories.slug,
        set: {
          title: interest.title,
          description: interest.description,
          emoji: interest.emoji,
          sortOrder: interest.sortOrder,
          isActive: true,
        },
      });
  }
}

async function seedChannels() {
  const rows = [];
  for (const ch of CHANNELS) {
    const [row] = await db
      .insert(telegramChannels)
      .values({
        username: ch.username,
        title: ch.title,
        categorySlug: ch.categorySlug,
        language: "uk",
        status: "active",
        avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${ch.username}`,
        description: `Український публічний канал @${ch.username}`,
      })
      .onConflictDoUpdate({
        target: telegramChannels.username,
        set: {
          title: ch.title,
          categorySlug: ch.categorySlug,
          status: "active",
        },
      })
      .returning();
    if (row) rows.push(row);
  }
  return rows;
}

async function main() {
  await seedInterests();
  const channels = await seedChannels();

  const stats = await db.execute<{
    interests: string;
    channels: string;
    ready: string;
    ready_refs: string;
  }>(sql`
    SELECT
      (SELECT count(*)::text FROM telegram_interest_categories) AS interests,
      (SELECT count(*)::text FROM telegram_channels WHERE status = 'active') AS channels,
      (SELECT count(*)::text FROM telegram_post_descriptions WHERE status = 'ready') AS ready,
      (SELECT count(*)::text FROM telegram_post_media m
        INNER JOIN telegram_post_descriptions p ON p.id = m.desc_id
        WHERE p.status = 'ready'
          AND m.telegram_access_hash IS NOT NULL) AS ready_refs
  `);

  const row = stats.rows[0];
  console.log(
    JSON.stringify({
      ok: true,
      channels: channels.length,
      interests: row?.interests,
      activeChannels: row?.channels,
      readyPosts: row?.ready,
      readyWithTelegramRefs: row?.ready_refs,
      hint:
        Number(row?.ready_refs ?? 0) < 5
          ? "Run: pnpm channel:add babel && python3 scripts/collector-sync.py"
          : undefined,
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
