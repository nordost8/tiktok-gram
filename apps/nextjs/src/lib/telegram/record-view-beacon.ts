import { getTrpcProfileHeaders } from "./trpc-headers";

interface RecordViewInput {
  postId: string;
  durationMs?: number;
  completedPercent?: number;
}

/**
 * Production-grade reliable delivery of `interactions.recordView` for moments
 * when the React tree is tearing down (FeedScreen unmount, `visibilitychange`
 * to "hidden", `pagehide`).
 *
 * Uses `fetch(..., { keepalive: true })` instead of `navigator.sendBeacon`
 * because we need to send profile headers (`x-telegram-user-id` /
 * `x-local-anonymous-id`) for `requireProfile` on the server — sendBeacon
 * cannot set arbitrary request headers, fetch+keepalive can. Modern browsers
 * keep the request alive for the standard 64KiB / a few seconds even after
 * the document is gone.
 *
 * Wire format: tRPC v11 non-batched POST with SuperJSON transformer →
 * body is `{"json": <input>}` (no `meta` needed for plain JSON values).
 */
export function recordViewBeacon(input: RecordViewInput): void {
  if (typeof window === "undefined") return;

  const profileHeaders = getTrpcProfileHeaders();
  const hasProfile =
    "x-telegram-user-id" in profileHeaders ||
    "x-local-anonymous-id" in profileHeaders;
  if (!hasProfile) return;

  const body = JSON.stringify({
    json: {
      postId: input.postId,
      durationMs: input.durationMs,
      completedPercent: input.completedPercent,
    },
  });

  try {
    void fetch("/api/trpc/interactions.recordView", {
      method: "POST",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        ...profileHeaders,
      },
      body,
    });
  } catch {
    // Best-effort: page may be unloading and errors here are not observable.
  }
}
