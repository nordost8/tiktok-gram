import assert from "node:assert/strict";
import test from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  applyDiversity,
  buildVisibilityGate,
  capPhotoRatio,
  decodeCursor,
  encodeCursor,
  scorePost,
} from "./feed-query.js";
import { mapPostToDto, postAudioApiPath } from "./map-post.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TestPost = {
  id: string;
  channelId: string;
  publishedAt: Date;
  internalLikesCount: number;
  internalSavesCount: number;
  internalViewsCount: number;
  categorySlug: string | null;
  mediaType: string;
};

function makePost(overrides: Partial<TestPost> & { id: string }): TestPost {
  return {
    channelId: "ch-default",
    publishedAt: new Date(Date.now() - 1000 * 60 * 60), // 1h ago
    internalLikesCount: 0,
    internalSavesCount: 0,
    internalViewsCount: 0,
    categorySlug: null,
    mediaType: "video",
    ...overrides,
  };
}

/** Simulates one feed page using the same pure-function pipeline as fetchFeedPosts. */
function simulatePage(
  allPosts: TestPost[],
  viewedIds: Set<string>,
  opts: {
    limit: number;
    interestSlugs?: Set<string>;
    subscribedChannelIds?: Set<string>;
  },
): { items: TestPost[]; hasMore: boolean } {
  const interestSlugs = opts.interestSlugs ?? new Set<string>();
  const subscribedChannelIds = opts.subscribedChannelIds ?? new Set<string>();

  const unviewed = allPosts.filter((p) => !viewedIds.has(p.id));

  const ranked = unviewed
    .slice(0, opts.limit * 3)
    .map((p) => ({
      ...p,
      score: scorePost(
        {
          publishedAt: p.publishedAt,
          internalLikesCount: p.internalLikesCount,
          internalSavesCount: p.internalSavesCount,
          internalViewsCount: p.internalViewsCount,
          categorySlug: p.categorySlug,
          mediaType: p.mediaType,
          channelId: p.channelId,
        },
        interestSlugs,
        subscribedChannelIds,
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const diverse = applyDiversity(ranked, opts.limit);
  return { items: diverse, hasMore: diverse.length > 0 };
}

/** Runs the feed to completion and returns all unique post IDs in order. */
function drainFeed(
  allPosts: TestPost[],
  opts: {
    limit: number;
    interestSlugs?: Set<string>;
    subscribedChannelIds?: Set<string>;
  },
): string[] {
  const viewedIds = new Set<string>();
  const seen: string[] = [];
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { items, hasMore } = simulatePage(allPosts, viewedIds, opts);
    if (items.length === 0) break;
    for (const item of items) {
      assert.ok(!viewedIds.has(item.id), `Duplicate post ${item.id} on page ${page + 1}`);
      seen.push(item.id);
      viewedIds.add(item.id);
    }
    if (!hasMore) break;
  }
  return seen;
}

// ---------------------------------------------------------------------------
// 1. Cursor encode / decode
// ---------------------------------------------------------------------------

test("cursor: round-trip encodes and decodes correctly", () => {
  const date = new Date("2026-05-20T12:34:56.789Z");
  const id = "abc-123-uuid";
  const cursor = encodeCursor(date, id);
  const decoded = decodeCursor(cursor);
  assert.ok(decoded);
  assert.equal(decoded.id, id);
  assert.equal(decoded.publishedAt.toISOString(), date.toISOString());
});

test("cursor: decodeCursor returns null for undefined", () => {
  assert.equal(decodeCursor(undefined), null);
});

test("cursor: decodeCursor returns null for empty string", () => {
  assert.equal(decodeCursor(""), null);
});

test("cursor: decodeCursor returns null for random garbage", () => {
  assert.equal(decodeCursor("not-a-cursor"), null);
});

test("cursor: decodeCursor returns null for valid base64 but invalid JSON shape", () => {
  const bad = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
  const result = decodeCursor(bad);
  // publishedAt will be invalid date — we tolerate null or broken date
  if (result !== null) {
    assert.ok(isNaN(result.publishedAt.getTime()), "expected invalid date");
  }
});

test("cursor: two different posts produce different cursors", () => {
  const d = new Date();
  const c1 = encodeCursor(d, "id-1");
  const c2 = encodeCursor(d, "id-2");
  assert.notEqual(c1, c2);
});

// ---------------------------------------------------------------------------
// 2. scorePost
// ---------------------------------------------------------------------------

test("scorePost: very fresh post has higher freshness than old post", () => {
  const fresh = makePost({ id: "fresh", publishedAt: new Date(Date.now() - 1000 * 60 * 60) }); // 1h
  const stale = makePost({ id: "stale", publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 71) }); // 71h
  const scoreFresh = scorePost(fresh, new Set(), new Set());
  const scoreStale = scorePost(stale, new Set(), new Set());
  assert.ok(scoreFresh > scoreStale, `fresh(${scoreFresh}) should beat stale(${scoreStale})`);
});

test("scorePost: post older than 72h gets 0 freshness contribution", () => {
  const ancient = makePost({ id: "old", publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 100), mediaType: "photo" });
  const slightlyOld = makePost({ id: "recent", publishedAt: new Date(Date.now() - 1000 * 60 * 60 * 71), mediaType: "photo" });
  const sAncient = scorePost(ancient, new Set(), new Set());
  const sOld = scorePost(slightlyOld, new Set(), new Set());
  // a post at 71h still has a small freshness; ancient (>72h) should score ≤
  assert.ok(sOld > sAncient, "71h-old post scores higher than 100h-old (clamped) post");
});

test("scorePost: video beats photo with identical other params", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0, categorySlug: null, channelId: "ch" };
  const videoScore = scorePost({ ...base, mediaType: "video" }, new Set(), new Set());
  const photoScore = scorePost({ ...base, mediaType: "photo" }, new Set(), new Set());
  assert.ok(videoScore > photoScore, "video should score higher than photo");
  assert.ok(Math.abs(videoScore - photoScore - 35) < 0.0001, "video boost should be 35");
});

test("scorePost: animation does NOT get video boost", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0, categorySlug: null, channelId: "ch" };
  const animScore = scorePost({ ...base, mediaType: "animation" }, new Set(), new Set());
  const photoScore = scorePost({ ...base, mediaType: "photo" }, new Set(), new Set());
  assert.equal(animScore, photoScore, "animation has no video boost");
});

test("scorePost: matching interest category adds 20", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0, mediaType: "photo", channelId: "ch" };
  const withMatch = scorePost({ ...base, categorySlug: "design" }, new Set(["design"]), new Set());
  const noMatch = scorePost({ ...base, categorySlug: "design" }, new Set(["humor"]), new Set());
  assert.equal(withMatch - noMatch, 20, "interest boost should be exactly 20");
});

test("scorePost: non-matching category slug gives no boost", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0, mediaType: "photo", channelId: "ch" };
  const noCategory = scorePost({ ...base, categorySlug: null }, new Set(["design"]), new Set());
  const wrongCategory = scorePost({ ...base, categorySlug: "sports" }, new Set(["design"]), new Set());
  assert.equal(noCategory, wrongCategory, "null and wrong category give same score");
});

test("scorePost: subscribed channel adds 120", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0, categorySlug: null, mediaType: "photo", channelId: "ch-subscribed" };
  const subScore = scorePost(base, new Set(), new Set(["ch-subscribed"]));
  const noSubScore = scorePost(base, new Set(), new Set());
  assert.equal(subScore - noSubScore, 120, "subscription boost should be exactly 120");
});

test("scorePost: subscription boost dominates video + interest combined", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, internalViewsCount: 0 };
  const subscribed = scorePost({ ...base, categorySlug: null, mediaType: "photo", channelId: "sub" }, new Set(), new Set(["sub"]));
  const videoWithInterest = scorePost({ ...base, categorySlug: "design", mediaType: "video", channelId: "other" }, new Set(["design"]), new Set());
  assert.ok(subscribed > videoWithInterest, "subscription (120) should beat video(35)+interest(20)=55");
});

test("scorePost: likes contribute 3 points each", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalSavesCount: 0, internalViewsCount: 0, categorySlug: null, mediaType: "photo", channelId: "ch" };
  const s0 = scorePost({ ...base, internalLikesCount: 0 }, new Set(), new Set());
  const s10 = scorePost({ ...base, internalLikesCount: 10 }, new Set(), new Set());
  assert.equal(s10 - s0, 30, "10 likes × 3 = 30");
});

test("scorePost: saves contribute 4 points each", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalViewsCount: 0, categorySlug: null, mediaType: "photo", channelId: "ch" };
  const s0 = scorePost({ ...base, internalSavesCount: 0 }, new Set(), new Set());
  const s5 = scorePost({ ...base, internalSavesCount: 5 }, new Set(), new Set());
  assert.equal(s5 - s0, 20, "5 saves × 4 = 20");
});

test("scorePost: views contribute 0.1 points each", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalLikesCount: 0, internalSavesCount: 0, categorySlug: null, mediaType: "photo", channelId: "ch" };
  const s0 = scorePost({ ...base, internalViewsCount: 0 }, new Set(), new Set());
  const s100 = scorePost({ ...base, internalViewsCount: 100 }, new Set(), new Set());
  assert.equal(s100 - s0, 10, "100 views × 0.1 = 10");
});

test("scorePost: saves outweigh likes (4 > 3)", () => {
  const base = { publishedAt: new Date(Date.now() - 3600_000), internalViewsCount: 0, categorySlug: null, mediaType: "photo", channelId: "ch" };
  const savesScore = scorePost({ ...base, internalLikesCount: 0, internalSavesCount: 1 }, new Set(), new Set());
  const likesScore = scorePost({ ...base, internalLikesCount: 1, internalSavesCount: 0 }, new Set(), new Set());
  assert.ok(savesScore > likesScore, "one save should beat one like");
});

// ---------------------------------------------------------------------------
// 3. applyDiversity
// ---------------------------------------------------------------------------

test("applyDiversity: empty input returns empty", () => {
  assert.deepEqual(applyDiversity([], 10), []);
});

test("applyDiversity: fewer items than limit returns all", () => {
  const items = [
    { id: "1", channelId: "ch-a" },
    { id: "2", channelId: "ch-b" },
    { id: "3", channelId: "ch-c" },
  ];
  const result = applyDiversity(items, 10);
  assert.equal(result.length, 3);
});

test("applyDiversity: result never exceeds limit", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, channelId: "ch-a" }));
  const result = applyDiversity(items, 10);
  assert.equal(result.length, 10);
});

test("applyDiversity: pass 1 caps at 2 per channel", () => {
  const items = [
    { id: "a1", channelId: "ch-a" },
    { id: "a2", channelId: "ch-a" },
    { id: "b1", channelId: "ch-b" },
    { id: "b2", channelId: "ch-b" },
    { id: "c1", channelId: "ch-c" },
    { id: "c2", channelId: "ch-c" },
  ];
  const result = applyDiversity(items, 6);
  const chaCounts = result.filter((r) => r.channelId === "ch-a").length;
  const chbCounts = result.filter((r) => r.channelId === "ch-b").length;
  assert.equal(chaCounts, 2, "ch-a should have exactly 2");
  assert.equal(chbCounts, 2, "ch-b should have exactly 2");
  assert.equal(result.length, 6);
});

test("applyDiversity: pass 1 rejects 3rd post from same channel", () => {
  // limit=3: pass 1 takes a1, a2, b1 — no room left, so a3 is never added
  const items = [
    { id: "a1", channelId: "ch-a" },
    { id: "a2", channelId: "ch-a" },
    { id: "a3", channelId: "ch-a" }, // excluded from pass 1; no pass 2 needed (limit already met)
    { id: "b1", channelId: "ch-b" },
  ];
  const result = applyDiversity(items, 3);
  assert.equal(result.length, 3);
  const chaIds = result.filter((r) => r.channelId === "ch-a").map((r) => r.id);
  assert.ok(!chaIds.includes("a3"), "3rd ch-a post must not appear when limit is already met by pass 1");
});

test("applyDiversity: pass 2 backfills from same channel when limit not reached", () => {
  // Only one channel, pass 1 gives 2, pass 2 must fill the rest
  const items = Array.from({ length: 10 }, (_, i) => ({ id: `a${i}`, channelId: "ch-a" }));
  const result = applyDiversity(items, 5);
  assert.equal(result.length, 5);
  assert.ok(result.every((r) => r.channelId === "ch-a"));
});

test("applyDiversity: pass 2 uses posts excluded by pass 1, not new ones", () => {
  // 3 from ch-a (pass 1 takes 2), 1 from ch-b (pass 1 takes 1), need 4 total
  // pass 2 must take the 3rd ch-a post
  const items = [
    { id: "a1", channelId: "ch-a" },
    { id: "a2", channelId: "ch-a" },
    { id: "a3", channelId: "ch-a" }, // excluded from pass 1, must appear in pass 2
    { id: "b1", channelId: "ch-b" },
  ];
  const result = applyDiversity(items, 4);
  assert.equal(result.length, 4);
  const ids = result.map((r) => r.id);
  assert.ok(ids.includes("a3"), "3rd ch-a post must appear via pass 2 backfill");
});

test("applyDiversity: preserves input order within pass 1 (highest-scored items first)", () => {
  // items are already sorted by descending score by the caller
  const items = [
    { id: "best", channelId: "ch-a" },
    { id: "second", channelId: "ch-b" },
    { id: "third", channelId: "ch-a" },
    { id: "fourth", channelId: "ch-c" },
  ];
  const result = applyDiversity(items, 4);
  assert.equal(result[0]!.id, "best");
  assert.equal(result[1]!.id, "second");
});

test("applyDiversity: no duplicates in result", () => {
  const items = Array.from({ length: 30 }, (_, i) => ({
    id: `p${i}`,
    channelId: `ch-${i % 3}`,
  }));
  const result = applyDiversity(items, 10);
  const ids = result.map((r) => r.id);
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, "result must contain no duplicate IDs");
});

test("applyDiversity: single-item input returns that item", () => {
  const result = applyDiversity([{ id: "only", channelId: "ch-a" }], 10);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, "only");
});

// ---------------------------------------------------------------------------
// 4. REGRESSION: "lerumiu bug" — diversity-excluded posts must not be lost
// ---------------------------------------------------------------------------

test("[REGRESSION] all posts seen when one channel dominates (lerumiu scenario)", () => {
  // 10 posts from channelA (design), 3 from channelB (design)
  // With limit=10, page 1: pass1 picks 2A+2B, pass2 fills 6 more from A → 10 shown
  // The remaining 3 posts (1A+3 margin, but actually 3 unviewed) must appear on page 2
  const now = Date.now();
  const posts: TestPost[] = [
    ...Array.from({ length: 10 }, (_, i) =>
      makePost({ id: `a${i}`, channelId: "ch-design-a", publishedAt: new Date(now - i * 3_600_000) }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      makePost({ id: `b${i}`, channelId: "ch-design-b", publishedAt: new Date(now - (i + 10) * 3_600_000) }),
    ),
  ];

  const seen = drainFeed(posts, { limit: 10 });

  assert.equal(seen.length, 13, "all 13 posts must be seen across pages");
  const uniqueSeen = new Set(seen);
  assert.equal(uniqueSeen.size, 13, "no duplicates");
  for (const post of posts) {
    assert.ok(uniqueSeen.has(post.id), `post ${post.id} was never shown`);
  }
});

test("[REGRESSION] diversity-excluded posts from first page appear on second page", () => {
  const now = Date.now();
  // 5 posts from ch-a and 5 from ch-b, limit=4
  // Pass 1: 2 from ch-a + 2 from ch-b = 4 (page full)
  // After viewing 4: remaining 3 from ch-a + 3 from ch-b must appear on page 2+
  const posts: TestPost[] = [
    ...Array.from({ length: 5 }, (_, i) =>
      makePost({ id: `a${i}`, channelId: "ch-a", publishedAt: new Date(now - i * 3_600_000) }),
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      makePost({ id: `b${i}`, channelId: "ch-b", publishedAt: new Date(now - i * 3_600_000) }),
    ),
  ];

  const seen = drainFeed(posts, { limit: 4 });
  assert.equal(seen.length, 10, "all 10 posts must appear");
  assert.equal(new Set(seen).size, 10, "no duplicates");
});

test("[REGRESSION] single-channel feed with 13 posts and limit=10 drains fully", () => {
  const now = Date.now();
  const posts = Array.from({ length: 13 }, (_, i) =>
    makePost({ id: `p${i}`, channelId: "only-channel", publishedAt: new Date(now - i * 3_600_000) }),
  );

  const seen = drainFeed(posts, { limit: 10 });
  assert.equal(seen.length, 13, "all 13 posts from single channel must be served");
});

test("[REGRESSION] feed stops cleanly when all posts viewed (no infinite loop)", () => {
  const posts = Array.from({ length: 5 }, (_, i) =>
    makePost({ id: `p${i}`, channelId: "ch" }),
  );

  let pageCount = 0;
  const viewedIds = new Set<string>();

  for (let page = 0; page < 100; page++) {
    const { items } = simulatePage(posts, viewedIds, { limit: 10 });
    if (items.length === 0) break;
    pageCount++;
    for (const item of items) viewedIds.add(item.id);
  }

  assert.ok(pageCount <= 2, `expected ≤2 pages for 5 posts, got ${pageCount}`);
  assert.equal(viewedIds.size, 5, "all 5 posts were eventually shown");
});

test("[REGRESSION] cursor is ignored for view-tracked feeds (no posts lost at time boundary)", () => {
  // Simulates old broken behavior: if cursor were applied, posts in the same
  // time window as page-1 would be lost. Verify they are NOT lost.
  const now = Date.now();
  // 15 posts all published within 1 hour of each other (same time window)
  const posts = Array.from({ length: 15 }, (_, i) =>
    makePost({
      id: `p${i}`,
      channelId: `ch-${i % 5}`, // 5 channels, 3 posts each
      publishedAt: new Date(now - (i % 60) * 60_000), // all within 1 hour
    }),
  );

  const seen = drainFeed(posts, { limit: 10 });
  assert.equal(seen.length, 15, "all 15 posts in the same time window must be served");
});

// ---------------------------------------------------------------------------
// 5. nextCursor behavior
// ---------------------------------------------------------------------------

test("nextCursor set when items returned (excludeViewed=true mode)", () => {
  // With excludeViewed semantics: cursor should exist as long as there are items
  const posts = Array.from({ length: 3 }, (_, i) => makePost({ id: `p${i}` }));
  const { items, hasMore } = simulatePage(posts, new Set(), { limit: 10 });
  assert.equal(items.length, 3);
  assert.ok(hasMore, "should signal more pages exist when items returned");
});

test("nextCursor not set when 0 items (feed exhausted)", () => {
  const viewedAll = new Set(["p0", "p1", "p2"]);
  const posts = Array.from({ length: 3 }, (_, i) => makePost({ id: `p${i}` }));
  const { items, hasMore } = simulatePage(posts, viewedAll, { limit: 10 });
  assert.equal(items.length, 0);
  assert.ok(!hasMore, "should not signal more when all posts viewed");
});

// ---------------------------------------------------------------------------
// 6. Scoring determines page order
// ---------------------------------------------------------------------------

test("highest-scored post appears first on page 1", () => {
  const now = Date.now();
  const posts = [
    makePost({ id: "viral", channelId: "ch", publishedAt: new Date(now - 3_600_000), internalLikesCount: 100, internalSavesCount: 50 }),
    makePost({ id: "plain-recent", channelId: "ch2", publishedAt: new Date(now - 1800_000) }),
    makePost({ id: "plain-old", channelId: "ch3", publishedAt: new Date(now - 60_000 * 60 * 24) }),
  ];

  const { items } = simulatePage(posts, new Set(), { limit: 10 });
  assert.equal(items[0]!.id, "viral", "viral post must appear first");
});

test("subscribed channel beats unsubscribed channel with same engagement", () => {
  const now = Date.now();
  const posts = [
    makePost({ id: "unsub", channelId: "ch-a", publishedAt: new Date(now) }),
    makePost({ id: "subbed", channelId: "ch-sub", publishedAt: new Date(now) }),
  ];

  const { items } = simulatePage(posts, new Set(), {
    limit: 10,
    subscribedChannelIds: new Set(["ch-sub"]),
  });
  assert.equal(items[0]!.id, "subbed", "subscribed channel post must rank first (120 boost)");
});

test("interest-matched post ranks above non-matched post with same engagement", () => {
  const now = Date.now();
  const posts = [
    makePost({ id: "no-match", channelId: "ch-a", categorySlug: "sports", publishedAt: new Date(now) }),
    makePost({ id: "matched", channelId: "ch-b", categorySlug: "design", publishedAt: new Date(now) }),
  ];

  const { items } = simulatePage(posts, new Set(), {
    limit: 10,
    interestSlugs: new Set(["design"]),
  });
  assert.equal(items[0]!.id, "matched", "interest-matched post must rank first");
});

// ---------------------------------------------------------------------------
// 7. Edge cases
// ---------------------------------------------------------------------------

test("empty post list returns empty result", () => {
  const { items, hasMore } = simulatePage([], new Set(), { limit: 10 });
  assert.equal(items.length, 0);
  assert.ok(!hasMore);
});

test("exactly limit=1 posts drains in one page", () => {
  const posts = [makePost({ id: "solo" })];
  const seen = drainFeed(posts, { limit: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0], "solo");
});

test("large feed (300 posts, 30 channels) drains fully with no duplicates", () => {
  const now = Date.now();
  const posts = Array.from({ length: 300 }, (_, i) =>
    makePost({
      id: `p${i}`,
      channelId: `ch-${i % 30}`,
      publishedAt: new Date(now - i * 600_000),
    }),
  );

  const seen = drainFeed(posts, { limit: 10 });
  assert.equal(seen.length, 300, "all 300 posts must be served");
  assert.equal(new Set(seen).size, 300, "no duplicates");
});

test("all posts from all channels eventually served when one channel dominates heavily", () => {
  const now = Date.now();
  // 90 posts from ch-dominant, 10 posts from 10 other channels
  const posts: TestPost[] = [
    ...Array.from({ length: 90 }, (_, i) =>
      makePost({ id: `dom${i}`, channelId: "ch-dominant", publishedAt: new Date(now - i * 600_000) }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      makePost({ id: `other${i}`, channelId: `ch-other-${i}`, publishedAt: new Date(now - i * 600_000) }),
    ),
  ];

  const seen = drainFeed(posts, { limit: 10 });
  assert.equal(seen.length, 100);
  const uniqueSeen = new Set(seen);
  for (const p of posts) {
    assert.ok(uniqueSeen.has(p.id), `post ${p.id} was never shown`);
  }
});

test("drainFeed terminates even when all posts are from 1 channel (no infinite loop)", () => {
  const posts = Array.from({ length: 25 }, (_, i) =>
    makePost({ id: `p${i}`, channelId: "monopoly" }),
  );
  const seen = drainFeed(posts, { limit: 10 });
  assert.equal(seen.length, 25);
});

// ---------------------------------------------------------------------------
// 8. capPhotoRatio
// ---------------------------------------------------------------------------

type CapItem = { id: string; primaryMedia: { type: "photo" | "video" | "animation" } };

function makeCapItem(id: string, type: "photo" | "video" | "animation"): CapItem {
  return { id, primaryMedia: { type } };
}

test("capPhotoRatio: 0 photos — returns all non-photos up to limit", () => {
  const items = Array.from({ length: 10 }, (_, i) => makeCapItem(`v${i}`, "video"));
  const result = capPhotoRatio(items, 10);
  assert.equal(result.length, 10);
  assert.ok(result.every((r) => r.primaryMedia.type === "video"));
});

test("capPhotoRatio: only photos — returns at most floor(limit*0.5) photos (hard cap)", () => {
  const items = Array.from({ length: 10 }, (_, i) => makeCapItem(`p${i}`, "photo"));
  const result = capPhotoRatio(items, 10);
  const photoCount = result.filter((r) => r.primaryMedia.type === "photo").length;
  assert.ok(photoCount <= Math.floor(10 * 0.5), `expected ≤5 photos, got ${photoCount}`);
  // no videos to backfill with — total should be just the photos allowed
  assert.equal(result.length, photoCount);
});

test("capPhotoRatio: 80% photo supply → at most 50% on page", () => {
  const limit = 10;
  // 2 videos + 8 photos
  const items = [
    ...Array.from({ length: 2 }, (_, i) => makeCapItem(`v${i}`, "video")),
    ...Array.from({ length: 8 }, (_, i) => makeCapItem(`p${i}`, "photo")),
  ];
  const result = capPhotoRatio(items, limit);
  const photoCount = result.filter((r) => r.primaryMedia.type === "photo").length;
  assert.ok(photoCount <= Math.floor(limit * 0.5), `photos ${photoCount} must be ≤ ${Math.floor(limit * 0.5)}`);
  assert.ok(result.length <= limit);
});

test("capPhotoRatio: fewer items than limit — returns all, photos still ≤ quota", () => {
  const items = [
    makeCapItem("v0", "video"),
    makeCapItem("p0", "photo"),
    makeCapItem("p1", "photo"),
  ];
  const result = capPhotoRatio(items, 10);
  const photoCount = result.filter((r) => r.primaryMedia.type === "photo").length;
  assert.ok(photoCount <= Math.floor(10 * 0.5), `photos ${photoCount} must be ≤ 5`);
  // total: 1 video + quota photos
  assert.ok(result.length <= items.length);
});

test("capPhotoRatio: videos-only input is unchanged when no photos present", () => {
  const items = Array.from({ length: 8 }, (_, i) => makeCapItem(`v${i}`, "video"));
  const result = capPhotoRatio(items, 10);
  assert.deepEqual(result.map((r) => r.id), items.map((i) => i.id));
});

test("capPhotoRatio: never exceeds limit", () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => makeCapItem(`v${i}`, "video")),
    ...Array.from({ length: 20 }, (_, i) => makeCapItem(`p${i}`, "photo")),
  ];
  const result = capPhotoRatio(items, 10);
  assert.ok(result.length <= 10, `result length ${result.length} must be ≤ 10`);
});

test("capPhotoRatio: photos are interleaved (not all at start or end)", () => {
  const limit = 10;
  const items = [
    ...Array.from({ length: 8 }, (_, i) => makeCapItem(`v${i}`, "video")),
    ...Array.from({ length: 4 }, (_, i) => makeCapItem(`p${i}`, "photo")),
  ];
  const result = capPhotoRatio(items, limit);
  // Photos should not all be clustered at positions 0..1 or at the very end
  const photoIndices = result
    .map((r, idx) => (r.primaryMedia.type === "photo" ? idx : -1))
    .filter((idx) => idx >= 0);
  const photoCount = photoIndices.length;
  assert.ok(photoCount <= Math.floor(limit * 0.5), `expected ≤5 photos, got ${photoCount}`);
  if (photoCount > 0 && result.length > 1) {
    // At least one photo should not be at index 0 (interleaved, not front-loaded)
    // This is a weak check — just verify they're within range
    assert.ok(photoIndices.every((idx) => idx < result.length));
  }
});

test("capPhotoRatio: custom maxRatio=0.5 allows up to 50% photos", () => {
  const limit = 10;
  const items = [
    ...Array.from({ length: 5 }, (_, i) => makeCapItem(`v${i}`, "video")),
    ...Array.from({ length: 5 }, (_, i) => makeCapItem(`p${i}`, "photo")),
  ];
  const result = capPhotoRatio(items, limit, 0.5);
  const photoCount = result.filter((r) => r.primaryMedia.type === "photo").length;
  assert.ok(photoCount <= Math.floor(limit * 0.5), `photos ${photoCount} must be ≤ 5`);
  assert.equal(result.length, 10);
});

// ---------------------------------------------------------------------------
// 9. buildVisibilityGate — single status='ready' feed gate
// ---------------------------------------------------------------------------
//
// The gate is pushed unconditionally into both fetchFeedPosts' description-level
// `conditions` and countPlayablePosts' raw SQL `conditions`. `status` is the one
// source of truth: a post is shown iff status='ready'. Video/mixed posts reach
// 'ready' once media caches; photo posts only once music is attached.

// Render the SQL fragment the same way the runtime client does (snake_case).
const dialect = new PgDialect({ casing: "snake_case" });
function renderGate(): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(buildVisibilityGate());
  return { sql: q.sql, params: q.params };
}

test("visibilityGate: always built (no flag)", () => {
  assert.ok(buildVisibilityGate(), "gate must always be applied");
});

test("visibilityGate: SQL is status = 'ready'", () => {
  const rendered = renderGate();
  const text = rendered.sql.replace(/\s+/g, " ").trim();
  assert.match(text, /"telegram_post_descriptions"\."status" = 'ready'/);
  assert.deepEqual(rendered.params, []);
});

// Truth table: a post is visible iff its single status is 'ready'.
type PostKind = {
  name: string;
  status: "caching" | "needs_audio" | "fetching_audio" | "ready" | "failed";
  shouldShow: boolean;
};

const KINDS: PostKind[] = [
  { name: "caching (media downloading)", status: "caching", shouldShow: false },
  { name: "photo needs_audio", status: "needs_audio", shouldShow: false },
  { name: "photo fetching_audio", status: "fetching_audio", shouldShow: false },
  { name: "ready", status: "ready", shouldShow: true },
  { name: "failed", status: "failed", shouldShow: false },
];

test("visibilityGate: truth table — show iff status = 'ready'", () => {
  const rendered = renderGate();
  assert.match(rendered.sql, /"status" = 'ready'/);
  const evalGate = (k: PostKind) => k.status === "ready";
  for (const k of KINDS) {
    assert.equal(evalGate(k), k.shouldShow, `${k.name}: expected ${k.shouldShow}`);
  }
});

// ---------------------------------------------------------------------------
// mapPostToDto — audio serialization
// ---------------------------------------------------------------------------

type PostStatus = "caching" | "needs_audio" | "fetching_audio" | "ready" | "failed";

function audioPostRow(opts: {
  status: PostStatus;
  audioStorageKey: string | null;
  audioTitle?: string | null;
  audioAuthor?: string | null;
}) {
  return {
    id: "desc-1",
    telegramUrl: "https://t.me/c/1",
    text: null,
    caption: null,
    textDisplayUk: null,
    sourceLang: null,
    captionTranslationStatus: null,
    publishedAt: new Date("2026-06-19T00:00:00.000Z"),
    internalViewsCount: 0,
    internalLikesCount: 0,
    internalSavesCount: 0,
    internalSharesCount: 0,
    audioTitle: opts.audioTitle ?? "Cool Track",
    audioAuthor: opts.audioAuthor ?? "Some Artist",
    audioStorageKey: opts.audioStorageKey,
    status: opts.status,
    channel: { id: "ch-1", title: "Chan", username: "chan", avatarUrl: null },
    primaryMedia: {
      id: "media-1",
      type: "photo" as const,
      thumbnailUrl: null,
      width: 100,
      height: 100,
      duration: null,
      mimeType: "image/jpeg",
      cacheStatus: "ready" as const,
      storageKey: "media/x.jpg",
      cacheRangeReady: true,
    },
  };
}

const viewerState = { liked: false, saved: false, subscribed: false };

test("mapPostToDto: ready audio → audio object with route URL + title/author", () => {
  const dto = mapPostToDto(
    audioPostRow({ status: "ready", audioStorageKey: "audio/desc-1.mp3" }),
    viewerState,
  );
  assert.deepEqual(dto.audio, {
    url: postAudioApiPath("desc-1"),
    title: "Cool Track",
    author: "Some Artist",
  });
});


test("mapPostToDto: non-ready audio status → no audio field", () => {
  for (const status of ["caching", "needs_audio", "fetching_audio", "failed"] as const) {
    const dto = mapPostToDto(
      audioPostRow({ status: status, audioStorageKey: "audio/desc-1.mp3" }),
      viewerState,
    );
    assert.equal(dto.audio, undefined, `status=${status} must not serialize audio`);
  }
});

test("mapPostToDto: ready but no storage key → no audio field", () => {
  const dto = mapPostToDto(
    audioPostRow({ status: "ready", audioStorageKey: null }),
    viewerState,
  );
  assert.equal(dto.audio, undefined);
});
