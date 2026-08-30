import assert from "node:assert/strict";
import test from "node:test";

import {
  isMediaCaching,
  isMediaPolicyBlocked,
  mediaLoadingHint,
  mediaUnavailableMessage,
} from "./feed-media-state";

test("isMediaCaching", () => {
  assert.equal(isMediaCaching("needs_cache"), true);
  assert.equal(isMediaCaching("downloading"), true);
  assert.equal(isMediaCaching("ready"), false);
  assert.equal(isMediaCaching(null), false);
});

test("isMediaPolicyBlocked", () => {
  assert.equal(isMediaPolicyBlocked("skipped"), true);
  assert.equal(isMediaPolicyBlocked("failed"), false);
});

test("mediaUnavailableMessage", () => {
  assert.equal(mediaUnavailableMessage("skipped"), "feed.media.unavailable.tooLarge");
  assert.equal(mediaUnavailableMessage("failed"), "feed.media.unavailable.temporary");
  assert.equal(mediaUnavailableMessage("ready"), "feed.media.unavailable.generic");
});

test("mediaLoadingHint", () => {
  assert.equal(mediaLoadingHint("needs_cache", false), "feed.media.hint.caching");
  assert.equal(mediaLoadingHint("needs_cache", true), "feed.media.hint.cachingSlow");
  assert.equal(mediaLoadingHint("ready", false), null);
  assert.equal(mediaLoadingHint("ready", true), "feed.media.hint.loading");
});
