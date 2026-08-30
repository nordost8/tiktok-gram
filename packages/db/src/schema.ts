import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const channelStatusEnum = pgEnum("telegram_channel_status", [
  "active",
  "paused",
  "blocked",
]);

export const mediaTypeEnum = pgEnum("telegram_media_type", [
  "photo",
  "video",
  "animation",
]);

export const mediaCacheStatusEnum = pgEnum("telegram_media_cache_status", [
  "needs_cache",
  "downloading",
  "ready",
  "failed",
  "skipped",
]);

// Lifecycle of a photo post's music-enrichment track (see
// packages/db/scripts/migrate-post-music-enrichment.sql). Default 'none' keeps every
// existing post behaving exactly as before (feature is off by default).
//   none          → not a qualifying photo post (video posts; default) — never music-gated
//   music_needed  → qualifying photo-only post awaiting music                 [HIDDEN]
//   music_pending → taken by a worker, pick in progress                       [HIDDEN]
//   ready         → mp3 in R2 + title/author written                         [VISIBLE]
//   failed        → 3 attempts exhausted (audio_last_error set)        [HIDDEN, loud]
// Single source of truth for a post's lifecycle / feed visibility. The feed shows
// iff status='ready'. Video/mixed posts go caching→ready as soon as media caches;
// photo posts go caching→needs_audio→fetching_audio→ready|failed when music is
// enabled, or caching→ready when MUSIC_ENRICHMENT_ENABLED=0.
//   caching        → media still downloading to R2                       [HIDDEN]
//   needs_audio    → photo-only post, media ready, awaiting music        [HIDDEN]
//   fetching_audio → music pick in progress                             [HIDDEN]
//   ready          → showable                                          [VISIBLE]
//   failed         → music failed 3× (photo only)               [HIDDEN, loud]
export const postStatusEnum = pgEnum("telegram_post_status", [
  "caching",
  "needs_audio",
  "fetching_audio",
  "ready",
  "failed",
]);

export const captionTranslationStatusEnum = pgEnum(
  "telegram_caption_translation_status",
  ["none", "skipped", "pending", "ready", "failed"],
);

export const telegramAppProfiles = pgTable(
  "telegram_app_profiles",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    telegramUserId: t.varchar({ length: 64 }),
    localAnonymousId: t.varchar({ length: 128 }),
    firstName: t.varchar({ length: 128 }),
    lastName: t.varchar({ length: 128 }),
    username: t.varchar({ length: 128 }),
    photoUrl: t.text(),
    onboardingCompleted: t.boolean().notNull().default(false),
    isAdmin: t.boolean().notNull().default(false),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    lastSeenAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_app_profiles_telegram_user_id_idx")
      .on(table.telegramUserId)
      .where(sql`${table.telegramUserId} is not null`),
    uniqueIndex("telegram_app_profiles_local_anonymous_id_idx")
      .on(table.localAnonymousId)
      .where(sql`${table.localAnonymousId} is not null`),
  ],
);

export const telegramInterestCategories = pgTable(
  "telegram_interest_categories",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    slug: t.varchar({ length: 64 }).notNull(),
    title: t.varchar({ length: 128 }).notNull(),
    description: t.text().notNull(),
    emoji: t.varchar({ length: 16 }).notNull(),
    sortOrder: t.integer().notNull().default(0),
    isActive: t.boolean().notNull().default(true),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }),
  (table) => [uniqueIndex("telegram_interest_categories_slug_idx").on(table.slug)],
);

export const telegramProfileInterests = pgTable(
  "telegram_profile_interests",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    interestId: t
      .uuid()
      .notNull()
      .references(() => telegramInterestCategories.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_profile_interests_profile_interest_idx").on(
      table.profileId,
      table.interestId,
    ),
  ],
);

export const telegramChannels = pgTable(
  "telegram_channels",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    telegramChannelId: t.varchar({ length: 64 }),
    username: t.varchar({ length: 128 }).notNull(),
    title: t.varchar({ length: 256 }).notNull(),
    description: t.text(),
    avatarUrl: t.text(),
    categorySlug: t.varchar({ length: 64 }),
    language: t.varchar({ length: 8 }).notNull().default("uk"),
    status: channelStatusEnum().notNull().default("active"),
    lastPostAt: t.timestamp({ mode: "date", withTimezone: true }),
    lastSyncedMessageId: t.varchar({ length: 64 }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }),
  (table) => [
    uniqueIndex("telegram_channels_username_idx").on(table.username),
    index("telegram_channels_category_slug_idx").on(table.categorySlug),
  ],
);

// One row per Telegram post or album. An album shares a telegram_grouped_id.
export const telegramPostDescriptions = pgTable(
  "telegram_post_descriptions",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    channelId: t
      .uuid()
      .notNull()
      .references(() => telegramChannels.id, { onDelete: "cascade" }),
    telegramMessageId: t.varchar({ length: 64 }).notNull(),
    telegramGroupedId: t.varchar({ length: 64 }),
    telegramUrl: t.text().notNull(),
    text: t.text(),
    caption: t.text(),
    publishedAt: t.timestamp({ mode: "date", withTimezone: true }).notNull(),
    ingestedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    internalViewsCount: t.integer().notNull().default(0),
    internalLikesCount: t.integer().notNull().default(0),
    internalSavesCount: t.integer().notNull().default(0),
    internalSharesCount: t.integer().notNull().default(0),
    // Single post-lifecycle status (see postStatusEnum). Feed shows iff 'ready'.
    status: postStatusEnum().notNull().default("caching"),
    // Music-enrichment hook — see services/music-enrichment/ (stubbed by
    // default). Track for photo posts, populated once status reaches 'ready'.
    audioTitle: t.text(),
    audioAuthor: t.text(),
    audioStorageKey: t.text(),
    /** Audio mp3 bytes stored in Postgres (bytea); mirrors telegramPostMedia.cachedData.
     *  R2 now holds only video; audio (like photos) lives in PG. audioStorageKey set to
     *  literal 'postgres' marker (non-null) so ready-audio serialization continues to work.
     */
    audioData: t.customType<{ data: Buffer | null; driverData: Buffer | null }>({
      dataType() {
        return "bytea";
      },
    })("audio_data"),
    audioAttempts: t.integer().notNull().default(0),
    audioLastError: t.text(),
    audioUpdatedAt: t.timestamp({ mode: "date", withTimezone: true }),
    sourceLang: t.varchar({ length: 16 }),
    textDisplayUk: t.text(),
    captionTranslationStatus: captionTranslationStatusEnum()
      .notNull()
      .default("none"),
    captionTranslateAttempts: t.integer().notNull().default(0),
    captionTranslateError: t.text(),
    captionTranslatedAt: t.timestamp({ mode: "date", withTimezone: true }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }),
  (table) => [
    uniqueIndex("telegram_post_descriptions_channel_message_idx").on(
      table.channelId,
      table.telegramMessageId,
    ),
    uniqueIndex("telegram_post_descriptions_channel_grouped_idx")
      .on(table.channelId, table.telegramGroupedId)
      .where(sql`${table.telegramGroupedId} is not null`),
    index("telegram_post_descriptions_published_at_idx").on(table.publishedAt),
    index("telegram_post_descriptions_channel_id_idx").on(table.channelId),
    index("telegram_post_descriptions_status_idx").on(table.status),
  ],
);

// Many media per description. Feed picks the best one via LATERAL JOIN.
export const telegramPostMedia = pgTable(
  "telegram_post_media",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    descId: t
      .uuid()
      .notNull()
      .references(() => telegramPostDescriptions.id, { onDelete: "cascade" }),
    type: mediaTypeEnum().notNull(),
    thumbnailUrl: t.text(),
    telegramFileId: t.text(),
    telegramDocumentId: t.text(),
    telegramPhotoId: t.text(),
    telegramAccessHash: t.text(),
    telegramFileReference: t.text(),
    telegramDcId: t.integer(),
    mimeType: t.text(),
    width: t.integer(),
    height: t.integer(),
    duration: t.integer(),
    sizeBytes: t.integer(),
    cacheStatus: mediaCacheStatusEnum().notNull().default("needs_cache"),
    /** Photo bytes when storageBackend='postgres'; video stays in R2. */
    cachedData: t.customType<{ data: Buffer | null; driverData: Buffer | null }>({
      dataType() {
        return "bytea";
      },
    })("cached_data"),
    storageBackend: t.varchar({ length: 16 }).notNull().default("r2"),
    storageKey: t.text(),
    cachedSizeBytes: t.integer(),
    cacheRangeReady: t.boolean().notNull().default(false),
    cacheAttemptCount: t.integer().notNull().default(0),
    lastCacheError: t.text(),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    index("telegram_post_media_desc_id_idx").on(table.descId),
    index("telegram_post_media_cache_status_idx").on(table.cacheStatus),
  ],
);

export const telegramUserHiddenChannels = pgTable(
  "telegram_user_hidden_channels",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    channelId: t
      .uuid()
      .notNull()
      .references(() => telegramChannels.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_user_hidden_channels_profile_channel_idx").on(
      table.profileId,
      table.channelId,
    ),
  ],
);

export const telegramUserChannelSubscriptions = pgTable(
  "telegram_user_channel_subscriptions",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    channelId: t
      .uuid()
      .notNull()
      .references(() => telegramChannels.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_user_channel_subscriptions_profile_channel_idx").on(
      table.profileId,
      table.channelId,
    ),
  ],
);

export const telegramUserPostLikes = pgTable(
  "telegram_user_post_likes",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    descId: t
      .uuid()
      .notNull()
      .references(() => telegramPostDescriptions.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_user_post_likes_profile_desc_idx").on(
      table.profileId,
      table.descId,
    ),
  ],
);

export const telegramUserPostSaves = pgTable(
  "telegram_user_post_saves",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    descId: t
      .uuid()
      .notNull()
      .references(() => telegramPostDescriptions.id, { onDelete: "cascade" }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
  (table) => [
    uniqueIndex("telegram_user_post_saves_profile_desc_idx").on(
      table.profileId,
      table.descId,
    ),
  ],
);

export const telegramUserPostViews = pgTable(
  "telegram_user_post_views",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .notNull()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    descId: t
      .uuid()
      .notNull()
      .references(() => telegramPostDescriptions.id, { onDelete: "cascade" }),
    viewedAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
    durationMs: t.integer(),
    completedPercent: t.integer(),
  }),
  (table) => [
    uniqueIndex("telegram_user_post_views_profile_desc_idx").on(
      table.profileId,
      table.descId,
    ),
  ],
);

export const channelSuggestions = pgTable(
  "channel_suggestions",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t
      .uuid()
      .references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    text: t.text().notNull(),
    contact: t.varchar({ length: 256 }),
    createdAt: t
      .timestamp({ mode: "date", withTimezone: true })
      .defaultNow()
      .notNull(),
  }),
);

// Temporary debug table — stores feed swipe events for diagnosing freezes/blocking bugs.
// Retention: 7 days (clean up manually or add a cron once the bugs are diagnosed).
export const feedDebugLogs = pgTable(
  "feed_debug_logs",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t.uuid().references(() => telegramAppProfiles.id, { onDelete: "cascade" }),
    eventType: t.varchar({ length: 64 }).notNull(),
    tab: t.varchar({ length: 32 }),
    activeIndex: t.integer(),
    totalPosts: t.integer(),
    pagesLoaded: t.integer(),
    hasNextPage: t.boolean(),
    isFetching: t.boolean(),
    postId: t.text(),
    cursorSnapshot: t.text(),
    blockReason: t.text(),
    extra: jsonb(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("feed_debug_logs_profile_created_idx").on(table.profileId, table.createdAt),
  ],
);

// Permanent media-playback telemetry. Every time a feed video/photo is shown
// or fails in a user's client, the frontend beacons here so we can answer
// "why did media X fail for user Y at time Z" from data, not guesses.
//
// Deliberately has NO foreign key on profile_id: these rows must survive
// profile deletion (kept forever for diagnostics), so nothing can cascade-delete
// them. profile_id is a loose reference only.
export const mediaEvents = pgTable(
  "media_events",
  (t) => ({
    id: t.uuid().primaryKey().defaultRandom(),
    profileId: t.uuid(),
    outcome: t.varchar({ length: 16 }).notNull(), // "shown" | "error"
    postId: t.text(),
    mediaId: t.text(),
    mediaType: t.varchar({ length: 16 }), // photo | video | animation
    channel: t.text(),
    cacheStatus: t.varchar({ length: 32 }),
    reason: t.text(), // video_error | image_error | policy_blocked | ...
    srcKind: t.varchar({ length: 32 }), // r2_presigned | api_route | unknown
    mediaUrl: t.text(), // stored WITHOUT query string (no leaked signatures)
    attempt: t.integer(),
    loadMs: t.integer(), // ms from mount to shown/error, when available
    userAgent: t.text(),
    extra: jsonb(),
    createdAt: t.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (table) => [
    index("media_events_outcome_created_idx").on(table.outcome, table.createdAt),
    index("media_events_created_idx").on(table.createdAt),
    index("media_events_post_idx").on(table.postId),
  ],
);

// Relations
export const telegramAppProfilesRelations = relations(
  telegramAppProfiles,
  ({ many }) => ({
    interests: many(telegramProfileInterests),
    subscriptions: many(telegramUserChannelSubscriptions),
    hiddenChannels: many(telegramUserHiddenChannels),
    likes: many(telegramUserPostLikes),
    saves: many(telegramUserPostSaves),
    views: many(telegramUserPostViews),
  }),
);

export const telegramInterestCategoriesRelations = relations(
  telegramInterestCategories,
  ({ many }) => ({
    profileInterests: many(telegramProfileInterests),
  }),
);

export const telegramProfileInterestsRelations = relations(
  telegramProfileInterests,
  ({ one }) => ({
    profile: one(telegramAppProfiles, {
      fields: [telegramProfileInterests.profileId],
      references: [telegramAppProfiles.id],
    }),
    interest: one(telegramInterestCategories, {
      fields: [telegramProfileInterests.interestId],
      references: [telegramInterestCategories.id],
    }),
  }),
);

export const telegramChannelsRelations = relations(
  telegramChannels,
  ({ many }) => ({
    descriptions: many(telegramPostDescriptions),
    subscriptions: many(telegramUserChannelSubscriptions),
    hiddenByUsers: many(telegramUserHiddenChannels),
  }),
);

export const telegramUserHiddenChannelsRelations = relations(
  telegramUserHiddenChannels,
  ({ one }) => ({
    profile: one(telegramAppProfiles, {
      fields: [telegramUserHiddenChannels.profileId],
      references: [telegramAppProfiles.id],
    }),
    channel: one(telegramChannels, {
      fields: [telegramUserHiddenChannels.channelId],
      references: [telegramChannels.id],
    }),
  }),
);

export const telegramPostDescriptionsRelations = relations(
  telegramPostDescriptions,
  ({ one, many }) => ({
    channel: one(telegramChannels, {
      fields: [telegramPostDescriptions.channelId],
      references: [telegramChannels.id],
    }),
    media: many(telegramPostMedia),
    likes: many(telegramUserPostLikes),
    saves: many(telegramUserPostSaves),
    views: many(telegramUserPostViews),
  }),
);

export const telegramPostMediaRelations = relations(
  telegramPostMedia,
  ({ one }) => ({
    description: one(telegramPostDescriptions, {
      fields: [telegramPostMedia.descId],
      references: [telegramPostDescriptions.id],
    }),
  }),
);
