/**
 * Feed engine unit tests — runs under Node.js 22 via tsx.
 *
 * All DOM APIs (rAF, pointer events) are bypassed:
 *  - AnimationDriver.runSync() is used instead of animate()
 *  - PointerGestureHandler.simulateDrag() is used instead of real events
 *  - FeedController accepts an injected SyncAnimationDriver
 *
 * Run: pnpm test:feed-engine
 */
import assert from "node:assert/strict";
import test from "node:test";

import { AnimationDriver } from "./AnimationDriver";
import { FeedController } from "./FeedController";
import { PointerGestureHandler } from "./PointerGestureHandler";
import { PostRepository } from "./PostRepository";
import type { FeedPost } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** AnimationDriver that executes synchronously — no rAF needed in tests. */
class SyncAnimationDriver extends AnimationDriver {
  override animate(opts: Parameters<AnimationDriver["animate"]>[0]): void {
    this.runSync({ ...opts, steps: 10 });
  }
  override get isRunning(): boolean {
    return false;
  }
}

function makePost(index: number): FeedPost {
  return {
    id: `post-${index}`,
    text: `Post ${index}`,
    primaryMedia: {
      url: `https://example.com/video-${index}.mp4`,
      type: "video",
      cacheStatus: "ready",
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      thumbnailUrl: null,
      fileSize: null,
    },
    channel: {
      id: `ch-${index}`,
      title: `Channel ${index}`,
      username: `channel${index}`,
      avatarUrl: null,
    },
    publishedAt: new Date("2025-01-01"),
    viewCount: null,
    reactionCount: null,
    groupedId: null,
    descriptionId: `desc-${index}`,
  } as unknown as FeedPost;
}

function makePosts(count: number): FeedPost[] {
  return Array.from({ length: count }, (_, i) => makePost(i));
}

function makeController(slideHeight = 800): FeedController {
  const ctrl = new FeedController(new SyncAnimationDriver());
  ctrl.setSlideHeight(slideHeight);
  return ctrl;
}

// ─── PostRepository tests ─────────────────────────────────────────────────────

test("PostRepository — sync deduplicates by id", () => {
  const repo = new PostRepository();
  const posts = makePosts(5);

  const r1 = repo.sync(posts);
  assert.equal(r1.added, 5);
  assert.equal(repo.totalLoaded, 5);

  // Same posts again — should add 0
  const r2 = repo.sync(posts);
  assert.equal(r2.added, 0);
  assert.equal(repo.totalLoaded, 5);

  // 5 new + 2 already seen
  const r3 = repo.sync([...posts.slice(0, 2), ...makePosts(5).map((p, i) => ({ ...p, id: `new-${i}` }))]);
  assert.equal(r3.added, 5);
  assert.equal(repo.totalLoaded, 10);
});

test("PostRepository — get returns null for out-of-bounds and negative", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(3));

  assert.equal(repo.get(0)?.id, "post-0");
  assert.equal(repo.get(2)?.id, "post-2");
  assert.equal(repo.get(3), null);   // beyond loaded
  assert.equal(repo.get(-1), null);  // before start
});

test("PostRepository — getSlotPosts returns prev/current/next", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(5));

  const [prev, cur, next] = repo.getSlotPosts(2);
  assert.equal(prev?.id, "post-1");
  assert.equal(cur?.id, "post-2");
  assert.equal(next?.id, "post-3");
});

test("PostRepository — getSlotPosts handles boundaries gracefully", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(3));

  const [prevFirst] = repo.getSlotPosts(0);
  assert.equal(prevFirst, null); // no post before index 0

  const [, , nextLast] = repo.getSlotPosts(2);
  assert.equal(nextLast, null); // no post after last
});

test("PostRepository — checkPrefetch fires when within threshold", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(10));
  repo.prefetchThreshold = 3;

  let fired = false;
  repo.onNearEnd = () => { fired = true; };

  repo.checkPrefetch(5); // 10 - 1 - 5 = 4 > threshold
  assert.equal(fired, false);

  repo.checkPrefetch(7); // 10 - 1 - 7 = 2 ≤ threshold
  assert.equal(fired, true);
});

test("PostRepository — checkPrefetch is suppressed while fetching", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(5));
  repo.setStatus("fetching");

  let fired = false;
  repo.onNearEnd = () => { fired = true; };
  repo.checkPrefetch(4);
  assert.equal(fired, false);
});

test("PostRepository — reset clears all state", () => {
  const repo = new PostRepository();
  repo.sync(makePosts(10));
  repo.reset();

  assert.equal(repo.totalLoaded, 0);
  assert.equal(repo.status, "idle");
  assert.equal(repo.get(0), null);
  // Can sync again cleanly
  const { added } = repo.sync(makePosts(3));
  assert.equal(added, 3);
});

// ─── AnimationDriver tests ────────────────────────────────────────────────────

test("AnimationDriver — runSync calls onFrame N times then onComplete", () => {
  const driver = new AnimationDriver();
  const frames: number[] = [];
  let completed = false;

  driver.runSync({
    from: 0,
    to: 100,
    duration: 300,
    steps: 5,
    onFrame: (v) => frames.push(v),
    onComplete: () => { completed = true; },
  });

  assert.equal(frames.length, 5);
  assert.equal(completed, true);
  // Last frame should reach exactly toValue
  assert.equal(frames[4], 100);
});

test("AnimationDriver — easeOutCubic returns 0 at t=0 and 1 at t=1", () => {
  assert.equal(AnimationDriver.easeOutCubic(0), 0);
  assert.equal(AnimationDriver.easeOutCubic(1), 1);
});

// ─── PointerGestureHandler tests ──────────────────────────────────────────────

test("PointerGestureHandler — simulateDrag fires start/move/end callbacks", () => {
  const handler = new PointerGestureHandler();
  let started = false;
  const deltas: number[] = [];
  let endVelocity = 0;
  let endDelta = 0;

  handler.onDragStart = () => { started = true; };
  handler.onDragMove = (d) => deltas.push(d);
  handler.onDragEnd = (v, d) => { endVelocity = v; endDelta = d; };

  handler.simulateDrag({ startY: 400, endY: 0, durationMs: 200 });

  assert.equal(started, true);
  assert.ok(deltas.length > 0, "should emit move events");
  assert.equal(endDelta, -400); // endY - startY = 0 - 400 = -400
  // upward swipe → negative velocity
  assert.ok(endVelocity < 0, `velocity should be negative, got ${endVelocity}`);
});

test("PointerGestureHandler — downward drag produces positive velocity", () => {
  const handler = new PointerGestureHandler();
  let endVelocity = 0;
  handler.onDragEnd = (v) => { endVelocity = v; };

  handler.simulateDrag({ startY: 0, endY: 400, durationMs: 200 });
  assert.ok(endVelocity > 0, `expected positive velocity, got ${endVelocity}`);
});

// ─── PointerGestureHandler — axis-lock tests ──────────────────────────────────

test("PointerGestureHandler — vertical drag (|dy|>|dx|) locks to vertical axis", () => {
  const handler = new PointerGestureHandler();
  let verticalStarted = false;
  let horizontalStarted = false;
  const verticalDeltas: number[] = [];
  const horizontalDeltas: number[] = [];
  let endDeltaY = 0;

  handler.onDragStart = () => { verticalStarted = true; };
  handler.onDragMove = (d) => verticalDeltas.push(d);
  handler.onDragEnd = (_, d) => { endDeltaY = d; };
  handler.onHorizontalDragStart = () => { horizontalStarted = true; };
  handler.onHorizontalDragMove = (d) => horizontalDeltas.push(d);

  // Clearly vertical: dy=200, dx=10
  handler.simulateDrag({ startY: 0, endY: 200, startX: 0, endX: 10, durationMs: 200 });

  assert.equal(verticalStarted, true, "vertical start callback must fire");
  assert.equal(horizontalStarted, false, "horizontal start callback must NOT fire");
  assert.ok(verticalDeltas.length > 0, "vertical move events must fire");
  assert.equal(horizontalDeltas.length, 0, "horizontal move events must NOT fire");
  assert.equal(endDeltaY, 200);
});

test("PointerGestureHandler — horizontal drag (|dx|>|dy|) locks to horizontal axis", () => {
  const handler = new PointerGestureHandler();
  let verticalStarted = false;
  let horizontalStarted = false;
  const verticalDeltas: number[] = [];
  const horizontalDeltas: number[] = [];
  let endDeltaX = 0;
  let endVelocityX = 0;

  handler.onDragStart = () => { verticalStarted = true; };
  handler.onDragMove = (d) => verticalDeltas.push(d);
  handler.onHorizontalDragStart = () => { horizontalStarted = true; };
  handler.onHorizontalDragMove = (d) => horizontalDeltas.push(d);
  handler.onHorizontalDragEnd = (vx, dx) => { endVelocityX = vx; endDeltaX = dx; };

  // Clearly horizontal: dx=150, dy=5
  handler.simulateDrag({ startY: 0, endY: 5, startX: 0, endX: 150, durationMs: 200 });

  assert.equal(horizontalStarted, true, "horizontal start callback must fire");
  assert.equal(verticalStarted, false, "vertical start callback must NOT fire");
  assert.ok(horizontalDeltas.length > 0, "horizontal move events must fire");
  assert.equal(verticalDeltas.length, 0, "vertical move events must NOT fire");
  assert.equal(endDeltaX, 150);
  assert.ok(endVelocityX > 0, `expected positive horizontal velocity, got ${endVelocityX}`);
});

test("PointerGestureHandler — explicit axis=vertical overrides delta dominance", () => {
  const handler = new PointerGestureHandler();
  let verticalStarted = false;
  let horizontalStarted = false;

  handler.onDragStart = () => { verticalStarted = true; };
  handler.onHorizontalDragStart = () => { horizontalStarted = true; };

  // dx > dy but axis forced to vertical
  handler.simulateDrag({ startY: 0, endY: 0, startX: 0, endX: 200, axis: "vertical" });

  assert.equal(verticalStarted, true, "forced vertical must fire onDragStart");
  assert.equal(horizontalStarted, false, "forced vertical must NOT fire horizontal start");
});

test("PointerGestureHandler — explicit axis=horizontal overrides delta dominance", () => {
  const handler = new PointerGestureHandler();
  let verticalStarted = false;
  let horizontalStarted = false;

  handler.onDragStart = () => { verticalStarted = true; };
  handler.onHorizontalDragStart = () => { horizontalStarted = true; };

  // dy > dx but axis forced to horizontal
  handler.simulateDrag({ startY: 0, endY: 200, startX: 0, endX: 0, axis: "horizontal" });

  assert.equal(horizontalStarted, true, "forced horizontal must fire onHorizontalDragStart");
  assert.equal(verticalStarted, false, "forced horizontal must NOT fire vertical start");
});

test("FeedController — horizontal consumer receives horizontal drag events", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  let consumerStarted = false;
  const consumerMoves: number[] = [];
  let consumerEndDeltaX = 0;

  ctrl.setHorizontalConsumer({
    onStart: () => { consumerStarted = true; },
    onMove: (dx) => consumerMoves.push(dx),
    onEnd: (dx) => { consumerEndDeltaX = dx; },
  });

  // Horizontal swipe: dx=150, dy=5
  ctrl.gesture.simulateDrag({ startY: 0, endY: 5, startX: 0, endX: 150, durationMs: 200 });

  assert.equal(consumerStarted, true, "consumer.onStart must be called");
  assert.ok(consumerMoves.length > 0, "consumer.onMove must fire for horizontal drag");
  assert.equal(consumerEndDeltaX, 150, "consumer.onEnd deltaX must match total horizontal delta");
});

test("FeedController — vertical swipe does not trigger horizontal consumer", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  let consumerStarted = false;
  ctrl.setHorizontalConsumer({
    onStart: () => { consumerStarted = true; },
  });

  // Purely vertical swipe (upward)
  ctrl.gesture.simulateDrag({ startY: 400, endY: 0, startX: 0, endX: 0 });

  assert.equal(consumerStarted, false, "consumer.onStart must NOT fire for vertical drag");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1, "vertical nav must still work");
});

test("FeedController — setHorizontalConsumer(null) stops routing", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  let consumerStarted = false;
  ctrl.setHorizontalConsumer({ onStart: () => { consumerStarted = true; } });
  ctrl.setHorizontalConsumer(null); // unregister

  ctrl.gesture.simulateDrag({ startY: 0, endY: 5, startX: 0, endX: 150, durationMs: 200 });

  assert.equal(consumerStarted, false, "consumer must not fire after being set to null");
});

// ─── FeedController — slot rotation tests ────────────────────────────────────

test("FeedController — initial state has slot 1 as active with 3 slot positions", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  const snap = ctrl.getSnapshot();
  assert.equal(snap.activeSlot, 1);
  assert.equal(snap.activeAbsoluteIndex, 0);

  // Slot 1 at 0 (active), slot 2 at +800 (next), slot 0 at -800 (prev)
  assert.equal(snap.baseY[1], 0);
  assert.equal(snap.baseY[2], 800);
  assert.equal(snap.baseY[0], -800);

  // Slot contents: slot 0 = empty (index -1), slot 1 = post 0, slot 2 = post 1
  assert.equal(snap.absoluteIndices[0], -1);
  assert.equal(snap.absoluteIndices[1], 0);
  assert.equal(snap.absoluteIndices[2], 1);
});

test("FeedController — forward swipe rotates slots correctly", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  let slotsChangeFired = 0;
  let lastActiveIndex = -1;
  ctrl.onSlotsChange = () => { slotsChangeFired++; };
  ctrl.onActiveIndexChange = (i) => { lastActiveIndex = i; };

  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 }); // fast upward → forward

  const snap = ctrl.getSnapshot();
  assert.equal(snap.activeAbsoluteIndex, 1);
  assert.equal(lastActiveIndex, 1);

  // After forward: new active slot is old nextSlot = (1+1)%3 = 2
  assert.equal(snap.activeSlot, 2);

  // Active slot always at 0
  assert.equal(snap.baseY[snap.activeSlot], 0);

  // Slot 2 (active) has post index 1
  assert.equal(snap.absoluteIndices[2], 1);
  // Slot 1 (old current, now prev) still has post 0
  assert.equal(snap.absoluteIndices[1], 0);
  // Slot 0 (recycled from empty prev) now has post 2
  assert.equal(snap.absoluteIndices[0], 2);

  // sharedOffset resets to 0 after commit
  assert.equal(snap.sharedOffset, 0);

  assert.ok(slotsChangeFired >= 1);
});

test("FeedController — backward swipe rotates slots correctly", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  // First go forward to index 1
  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1);

  // Now go backward
  ctrl.gesture.simulateDrag({ startY: 0, endY: 400 }); // downward

  const snap = ctrl.getSnapshot();
  assert.equal(snap.activeAbsoluteIndex, 0);
  assert.equal(snap.baseY[snap.activeSlot], 0);
  assert.equal(snap.sharedOffset, 0);
});

test("FeedController — 10 forward swipes stay memory-bounded (only 3 slots)", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(15));

  for (let i = 0; i < 10; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 10);

  // Still exactly 3 slot positions — no growing list
  const snap = ctrl.getSnapshot();
  assert.equal(snap.absoluteIndices.length, 3);
  assert.equal(snap.baseY.length, 3);

  // Active slot always at baseY=0
  assert.equal(snap.baseY[snap.activeSlot], 0);

  // Slots contain post 9 (prev), 10 (current), 11 (next)
  const activeIdx = snap.absoluteIndices[snap.activeSlot];
  const prevSlot = ((snap.activeSlot + 2) % 3) as 0 | 1 | 2;
  const nextSlot = ((snap.activeSlot + 1) % 3) as 0 | 1 | 2;
  assert.equal(activeIdx, 10);
  assert.equal(snap.absoluteIndices[prevSlot], 9);
  assert.equal(snap.absoluteIndices[nextSlot], 11);
});

test("FeedController — slot content matches repository posts", () => {
  const ctrl = makeController(800);
  const posts = makePosts(10);
  ctrl.syncPosts(posts);

  for (let i = 0; i < 4; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  const snap = ctrl.getSnapshot();
  for (let slot = 0; slot < 3; slot++) {
    const absIdx = snap.absoluteIndices[slot]!;
    const postFromRepo = ctrl.repo.get(absIdx);
    if (absIdx >= 0 && absIdx < posts.length) {
      assert.equal(postFromRepo?.id, `post-${absIdx}`);
    } else {
      assert.equal(postFromRepo, null);
    }
  }
});

// ─── FeedController — swipe blocking tests ───────────────────────────────────

test("FeedController — swipe forward blocked at_first_post when going backward from 0", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  let blockedReason: string | null = null;
  ctrl.onSwipeBlocked = (reason) => { blockedReason = reason; };

  // Try to swipe backward (down) from index 0
  ctrl.gesture.simulateDrag({ startY: 0, endY: 400 });
  assert.equal(blockedReason, "at_first_post");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 0); // didn't move
});

test("FeedController — swipe blocked all_viewed when exhausted at last post", () => {
  const ctrl = makeController(800);
  const posts = makePosts(3);
  ctrl.syncPosts(posts);
  ctrl.syncStatus(false, true); // exhausted

  // Go to last post (index 2)
  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);

  let blockedReason: string | null = null;
  ctrl.onSwipeBlocked = (reason) => { blockedReason = reason; };

  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 }); // try to go past end
  assert.equal(blockedReason, "all_viewed");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);
});

test("FeedController — swipe blocked fetching_next_page when at last loaded post", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(2));
  ctrl.syncStatus(true, false); // fetching

  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 }); // go to index 1

  let blockedReason: string | null = null;
  ctrl.onSwipeBlocked = (reason) => { blockedReason = reason; };

  ctrl.gesture.simulateDrag({ startY: 400, endY: 0 }); // try beyond last
  assert.equal(blockedReason, "fetching_next_page");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1);
});

// ─── FeedController — prefetch tests ─────────────────────────────────────────

test("FeedController — prefetch triggered when approaching end", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(10));
  ctrl.repo.prefetchThreshold = 3;

  let nearEndFired = 0;
  ctrl.onNearEnd = () => { nearEndFired++; };

  // Go to index 6 — 10-1-6=3 = threshold, should trigger
  for (let i = 0; i < 6; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  assert.ok(nearEndFired >= 1, `nearEnd should have fired, count: ${nearEndFired}`);
});

test("FeedController — prefetch not triggered far from end", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(10));
  ctrl.repo.prefetchThreshold = 2;

  let nearEndFired = 0;
  ctrl.onNearEnd = () => { nearEndFired++; };

  // Go to index 3 — 10-1-3=6 > threshold, no trigger
  for (let i = 0; i < 3; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  assert.equal(nearEndFired, 0);
});

// ─── FeedController — onSlotsChange callback integrity ───────────────────────

test("FeedController — onSlotsChange provides consistent SlotInfo after each swipe", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(8));

  const infos: ReturnType<typeof ctrl.getSnapshot>[] = [];
  ctrl.onSlotsChange = () => {
    infos.push(ctrl.getSnapshot());
  };

  for (let i = 0; i < 5; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  // After every commit: active slot's baseY must be 0
  for (const info of infos) {
    assert.equal(
      info.baseY[info.activeSlot],
      0,
      `After commit, active slot baseY must be 0, got ${info.baseY[info.activeSlot]}`,
    );
    assert.equal(info.sharedOffset, 0, "sharedOffset must be 0 after commit");
  }
});

test("FeedController — onActiveIndexChange fires sequentially", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(6));

  const indices: number[] = [];
  ctrl.onActiveIndexChange = (i) => indices.push(i);

  for (let i = 0; i < 5; i++) {
    ctrl.gesture.simulateDrag({ startY: 400, endY: 0 });
  }

  assert.deepEqual(indices, [1, 2, 3, 4, 5]);
});

// ─── FeedController — goForward / goBackward programmatic API ─────────────────

test("FeedController — goForward increments active index", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  ctrl.goForward();
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1);

  ctrl.goForward();
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);
});

test("FeedController — goBackward decrements active index", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  ctrl.goForward();
  ctrl.goForward();
  ctrl.goBackward();
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1);
});

test("FeedController — goForward stops at last loaded post", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(3));

  ctrl.goForward();
  ctrl.goForward();
  ctrl.goForward(); // beyond end — should be ignored
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);
});

test("FeedController — goBackward stops at first post", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  ctrl.goBackward(); // at 0, should be no-op
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 0);
});

// ─── FeedController — syncPosts / syncStatus ─────────────────────────────────

test("FeedController — syncPosts fires onActiveIndexChange for first load", () => {
  const ctrl = makeController(800);

  let reportedIndex = -1;
  ctrl.onActiveIndexChange = (i) => { reportedIndex = i; };

  ctrl.syncPosts(makePosts(5));
  assert.equal(reportedIndex, 0);
});

test("FeedController — syncPosts is idempotent for duplicates", () => {
  const ctrl = makeController(800);
  const posts = makePosts(5);

  ctrl.syncPosts(posts);
  assert.equal(ctrl.repo.totalLoaded, 5);

  ctrl.syncPosts(posts); // same posts again
  assert.equal(ctrl.repo.totalLoaded, 5);
});

test("FeedController — syncStatus sets repo status correctly", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(5));

  ctrl.syncStatus(true, false);
  assert.equal(ctrl.repo.status, "fetching");

  ctrl.syncStatus(false, true);
  assert.equal(ctrl.repo.status, "exhausted");

  ctrl.syncStatus(false, false);
  assert.equal(ctrl.repo.status, "idle");
});

// ─── FeedController — reset ───────────────────────────────────────────────────

test("FeedController — reset restores initial state", () => {
  const ctrl = makeController(800);
  ctrl.syncPosts(makePosts(10));

  for (let i = 0; i < 5; i++) ctrl.goForward();
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 5);

  ctrl.reset();

  const snap = ctrl.getSnapshot();
  assert.equal(snap.activeAbsoluteIndex, 0);
  assert.equal(snap.activeSlot, 1);
  assert.equal(snap.sharedOffset, 0);
  assert.equal(snap.totalLoaded, 0);
});
