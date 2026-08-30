import assert from "node:assert/strict";
import test from "node:test";

import { selectPrimaryMedia } from "./select-primary-media";

test("selectPrimaryMedia picks longest video", () => {
  const picked = selectPrimaryMedia([
    { type: "video", duration: 10, sortOrder: 0 },
    { type: "video", duration: 30, sortOrder: 1 },
    { type: "photo", width: 4000, height: 4000, sortOrder: 2 },
  ]);
  assert.equal(picked?.duration, 30);
});

test("selectPrimaryMedia picks animation when no video", () => {
  const picked = selectPrimaryMedia([
    { type: "photo", width: 100, height: 100, sortOrder: 0 },
    { type: "animation", width: 50, height: 50, sortOrder: 1 },
  ]);
  assert.equal(picked?.type, "animation");
});

test("selectPrimaryMedia picks largest photo", () => {
  const picked = selectPrimaryMedia([
    { type: "photo", width: 100, height: 100, sortOrder: 0 },
    { type: "photo", width: 200, height: 300, sortOrder: 1 },
  ]);
  assert.equal(picked?.width, 200);
});

test("selectPrimaryMedia returns null for empty", () => {
  assert.equal(selectPrimaryMedia([]), null);
});
