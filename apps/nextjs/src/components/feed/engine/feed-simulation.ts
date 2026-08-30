/**
 * Feed simulation — realistic user session.
 *
 * Uses ONLY production code imports. No helper classes or stubs.
 * The only test setup: ctrl.animation.animate is replaced with runSync()
 * on each controller instance — no production code modified.
 *
 * All navigation goes through PointerGestureHandler.simulateDrag() —
 * the same code path real touch events trigger.
 *
 * Run: pnpm sim:feed
 */
import assert from "node:assert/strict";
import test from "node:test";

import { FeedController } from "./FeedController";
import type { SlotInfo } from "./FeedController";
import type { SwipeBlockReason } from "./FeedState";
import type { FeedPost } from "../types";

// ─── Test fixture — mirrors real API response shape ───────────────────────────

function makePost(index: number): FeedPost {
  return {
    id: `post-${index}`,
    text: `Caption for post ${index}`,
    primaryMedia: {
      url: `https://cdn.example.com/videos/${index}.mp4`,
      type: "video" as const,
      cacheStatus: "ready" as const,
      mimeType: "video/mp4",
      width: 1080,
      height: 1920,
      thumbnailUrl: null,
      fileSize: null,
    },
    channel: {
      id: `ch-${index % 5}`,
      title: `Channel ${index % 5}`,
      username: `ch${index % 5}`,
      avatarUrl: null,
    },
    publishedAt: new Date(Date.now() - index * 3600_000).toISOString(),
    viewCount: null,
    reactionCount: null,
    groupedId: null,
    descriptionId: `desc-${index}`,
  } as unknown as FeedPost;
}

function makePage(start: number, count: number): FeedPost[] {
  return Array.from({ length: count }, (_, i) => makePost(start + i));
}

// ─── Factory: real FeedController, sync animations ───────────────────────────

const SLIDE_H = 844; // iPhone 13 viewport height

function makeCtrl(): FeedController {
  const ctrl = new FeedController();
  // Override animate() on this instance so rAF-based code runs synchronously
  // in Node.js. runSync() is a real production method — no stubs, no subclasses.
  ctrl.animation.animate = function(opts) { this.runSync(opts); };
  ctrl.setSlideHeight(SLIDE_H);
  return ctrl;
}

// ─── Gesture helpers — call the real PointerGestureHandler ───────────────────

/** Swipe up = next post (fast, unambiguous). */
function swipeForward(ctrl: FeedController) {
  ctrl.gesture.simulateDrag({ startY: 600, endY: 100, durationMs: 180 });
}

/** Swipe down = previous post. */
function swipeBackward(ctrl: FeedController) {
  ctrl.gesture.simulateDrag({ startY: 200, endY: 700, durationMs: 180 });
}

/** Barely moved — must cancel, not navigate. */
function weakSwipe(ctrl: FeedController) {
  ctrl.gesture.simulateDrag({ startY: 400, endY: 370, durationMs: 300 });
}

// ─── Invariant checker — verifies the 3-slot carousel contract ───────────────

function assertInvariants(ctrl: FeedController, label: string) {
  const s = ctrl.getSnapshot();

  assert.equal(s.absoluteIndices.length, 3, `${label}: must have 3 slots`);
  assert.equal(s.baseY[s.activeSlot], 0, `${label}: active slot baseY must be 0`);
  assert.equal(s.sharedOffset, 0, `${label}: sharedOffset must be 0 after gesture`);
  assert.equal(
    s.absoluteIndices[s.activeSlot], s.activeAbsoluteIndex,
    `${label}: active slot index mismatch`,
  );

  const prev = ((s.activeSlot + 2) % 3) as 0 | 1 | 2;
  const next = ((s.activeSlot + 1) % 3) as 0 | 1 | 2;
  assert.equal(s.baseY[prev], -SLIDE_H, `${label}: prev slot must be at -slideHeight`);
  assert.equal(s.baseY[next], SLIDE_H, `${label}: next slot must be at +slideHeight`);
  assert.equal(s.absoluteIndices[prev], s.activeAbsoluteIndex - 1, `${label}: prev slot index`);
  assert.equal(s.absoluteIndices[next], s.activeAbsoluteIndex + 1, `${label}: next slot index`);

  // All three slot indices must be distinct (no slot can hold two posts simultaneously)
  const unique = new Set(s.absoluteIndices.filter((i) => i >= 0));
  assert.equal(unique.size, s.absoluteIndices.filter((i) => i >= 0).length, `${label}: absoluteIndices must be unique`);
}

// ─── Observer helper ─────────────────────────────────────────────────────────

function observe(ctrl: FeedController) {
  const activeChanges: number[] = [];
  const blocked: SwipeBlockReason[] = [];
  const slots: SlotInfo[] = [];
  let nearEndCount = 0;

  ctrl.onActiveIndexChange = (i) => activeChanges.push(i);
  ctrl.onSwipeBlocked = (r) => blocked.push(r);
  ctrl.onSlotsChange = (info) => slots.push(info);
  ctrl.onNearEnd = () => nearEndCount++;

  return {
    activeChanges,
    blocked,
    slots,
    get nearEndCount() { return nearEndCount; },
  };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

test("Scenario: feed loads — first post reported as active", () => {
  const ctrl = makeCtrl();
  const obs = observe(ctrl);

  ctrl.syncPosts(makePage(0, 10));
  ctrl.syncStatus(false, false);

  assert.ok(obs.activeChanges.includes(0), "must report post 0 as active on first load");
  assert.equal(ctrl.repo.totalLoaded, 10);
  assertInvariants(ctrl, "after load");
});

test("Scenario: swipe through full first page, invariants hold every step", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));
  ctrl.syncStatus(false, false);
  ctrl.repo.prefetchThreshold = 3;
  const obs = observe(ctrl);

  for (let i = 0; i < 9; i++) {
    swipeForward(ctrl);
    assertInvariants(ctrl, `swipe ${i + 1}`);
    assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, i + 1);
  }

  assert.ok(obs.nearEndCount >= 1, "nearEnd must fire before end of page");
});

test("Scenario: second page arrives mid-session, user continues seamlessly", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));
  ctrl.syncStatus(false, false);
  ctrl.repo.prefetchThreshold = 3;

  for (let i = 0; i < 7; i++) swipeForward(ctrl);
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 7);

  ctrl.syncStatus(true, false);
  ctrl.syncPosts(makePage(0, 20)); // page 2 arrives (deduped → 20 total)
  ctrl.syncStatus(false, false);

  assert.equal(ctrl.repo.totalLoaded, 20);

  for (let i = 0; i < 5; i++) {
    swipeForward(ctrl);
    assertInvariants(ctrl, `after page 2, swipe ${i + 1}`);
  }

  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 12);
});

test("Scenario: backward swipe always works, slot content correct", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));
  ctrl.syncStatus(false, false);

  for (let i = 0; i < 5; i++) swipeForward(ctrl);
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 5);

  for (let i = 0; i < 3; i++) {
    swipeBackward(ctrl);
    assertInvariants(ctrl, `backward ${i + 1}`);
  }

  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);

  const s = ctrl.getSnapshot();
  const post = ctrl.repo.get(s.absoluteIndices[s.activeSlot]!);
  assert.equal(post?.id, "post-2", "active slot must contain the post the user sees");
});

test("Scenario: backward at first post → blocked, at_first_post reason", () => {
  const ctrl = makeCtrl();
  const obs = observe(ctrl);
  ctrl.syncPosts(makePage(0, 5));

  swipeBackward(ctrl);

  assert.equal(obs.blocked.at(-1), "at_first_post");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 0);
  assertInvariants(ctrl, "after blocked backward");
});

test("Scenario: forward at last post while fetching → fetching_next_page", () => {
  const ctrl = makeCtrl();
  const obs = observe(ctrl);
  ctrl.syncPosts(makePage(0, 3));
  ctrl.syncStatus(true, false);

  swipeForward(ctrl);
  swipeForward(ctrl);
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);

  swipeForward(ctrl);
  assert.equal(obs.blocked.at(-1), "fetching_next_page");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);
});

test("Scenario: forward at last post when exhausted → all_viewed", () => {
  const ctrl = makeCtrl();
  const obs = observe(ctrl);
  ctrl.syncPosts(makePage(0, 3));
  ctrl.syncStatus(false, true);

  swipeForward(ctrl);
  swipeForward(ctrl);
  swipeForward(ctrl);

  assert.equal(obs.blocked.at(-1), "all_viewed");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 2);
});

test("Scenario: weak gesture cancels, does not navigate", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));

  weakSwipe(ctrl);

  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 0, "weak gesture must not move");
  assertInvariants(ctrl, "after weak gesture");
});

test("Scenario: 50 swipes — exactly 3 slots every frame, correct post always shown", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 60));
  ctrl.syncStatus(false, false);

  for (let i = 0; i < 50; i++) {
    swipeForward(ctrl);
    assertInvariants(ctrl, `swipe ${i + 1}`);

    const s = ctrl.getSnapshot();
    assert.equal(s.absoluteIndices.length, 3, `swipe ${i + 1}: must have 3 slots`);

    const shown = ctrl.repo.get(s.absoluteIndices[s.activeSlot]!);
    assert.equal(shown?.id, `post-${i + 1}`, `swipe ${i + 1}: wrong post in active slot`);
  }

  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 50);
});

test("Scenario: zigzag — 20 steps forward/backward, always correct post", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 20));

  const steps = ["f","f","f","b","f","f","b","b","f","f","f","f","b","f","f","f","b","f","f","b"];
  let expected = 0;

  for (const [i, step] of steps.entries()) {
    if (step === "f") {
      swipeForward(ctrl);
      expected = Math.min(expected + 1, ctrl.repo.totalLoaded - 1);
    } else {
      swipeBackward(ctrl);
      expected = Math.max(expected - 1, 0);
    }

    assertInvariants(ctrl, `step ${i + 1} (${step})`);
    assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, expected, `step ${i + 1}: wrong index`);

    const s = ctrl.getSnapshot();
    const post = ctrl.repo.get(s.absoluteIndices[s.activeSlot]!);
    assert.equal(post?.id, `post-${expected}`, `step ${i + 1}: wrong post in slot`);
  }
});

test("Scenario: prefetch fires at threshold, not before", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));
  ctrl.repo.prefetchThreshold = 2;
  const obs = observe(ctrl);

  for (let i = 0; i < 6; i++) swipeForward(ctrl);
  assert.equal(obs.nearEndCount, 0, "must not fire at post 6 (distance=3 > threshold=2)");

  swipeForward(ctrl); // post 7, distance = 10-1-7 = 2 = threshold
  assert.ok(obs.nearEndCount >= 1, "must fire at post 7");
});

test("Scenario: active index reported in order, no skips", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 8));
  const obs = observe(ctrl);

  for (let i = 0; i < 7; i++) swipeForward(ctrl);

  assert.deepEqual(obs.activeChanges, [1, 2, 3, 4, 5, 6, 7]);
});

test("Scenario: new drag while animation runs — no offset jump", () => {
  const ctrl = makeCtrl();
  ctrl.syncPosts(makePage(0, 10));
  ctrl.syncStatus(false, false);

  // Override animate: advance halfway, then stop (do NOT call onComplete).
  // This leaves _sharedOffset at a mid-animation value, simulating an
  // interrupted forward animation.
  const midOffset = -SLIDE_H / 2;
  ctrl.animation.animate = function(opts) {
    opts.onFrame(midOffset); // moves halfway
    // intentionally skip onComplete → commit never fires, sharedOffset stays mid
  };

  // Trigger a forward gesture — animation starts, stops mid-way
  ctrl.gesture.simulateDrag({ startY: 600, endY: 100, durationMs: 180 });

  assert.equal(
    ctrl.getSnapshot().sharedOffset, midOffset,
    "sharedOffset must be mid-animation after interrupted animate",
  );

  // Restore sync animation for the next gesture
  ctrl.animation.animate = function(opts) { this.runSync(opts); };

  // Now start a new drag. Without the dragBaseOffset fix this would jump to
  // near-zero on the first onDragMove tick.
  let firstMoveOffset: number | null = null;
  const origOnOffsetChange = ctrl.onOffsetChange;
  ctrl.onOffsetChange = (v) => {
    if (firstMoveOffset === null) firstMoveOffset = v;
    origOnOffsetChange?.(v);
  };

  // Simulate just the start of a new drag (2px move) — offset must stay near midOffset
  ctrl.gesture.onDragStart!(400);
  ctrl.gesture.onDragMove!(-2);

  assert.ok(
    firstMoveOffset !== null && Math.abs(firstMoveOffset - midOffset) < 10,
    `first move after interruption must continue from midOffset (${midOffset}), got ${firstMoveOffset}`,
  );

  // Complete the gesture — should commit forward normally
  ctrl.gesture.onDragEnd!(-1, -400);
  assertInvariants(ctrl, "after interrupted-then-completed drag");
  assert.equal(ctrl.getSnapshot().activeAbsoluteIndex, 1);
});
