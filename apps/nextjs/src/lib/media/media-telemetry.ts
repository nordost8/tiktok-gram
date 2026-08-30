import { trackEvent } from "~/lib/analytics";

export interface MediaEventInput {
  outcome: "shown" | "error";
  postId: string;
  mediaId: string;
  mediaType?: string;
  channel?: string;
  cacheStatus?: string | null;
  /** Coarse failure reason, e.g. "video_error" / "image_error". */
  reason?: string;
  /** Where the URL pointed, without leaking the signed query string. */
  srcKind?: "r2_presigned" | "api_route" | "unknown";
  /** Full media URL (server strips the query string before persisting). */
  mediaUrl?: string;
  attempt?: number;
  /** Milliseconds from media mount to this outcome, when known. */
  loadMs?: number;
  /**
   * HTMLMediaElement.error.code (1 aborted, 2 network, 3 decode,
   * 4 src_not_supported). Code 4 is how a missing codec surfaces — that is what
   * an AV1 file looks like on iOS — so it separates "we shipped bytes the device
   * can't decode" from "the bytes never arrived" (code 2).
   */
  mediaErrorCode?: number;
  mediaErrorMessage?: string;
  /** True when the media had already been shown and then failed mid-playback. */
  afterShown?: boolean;
}

/**
 * Records whether a post's media was actually shown to the user or failed to
 * load. Successes go to PostHog only; failures additionally hit a server beacon
 * so they surface in `docker logs tiktok-gram-web` (grep `media-event`).
 *
 * Must never throw — telemetry can't be allowed to break playback.
 */
export function reportMediaEvent(e: MediaEventInput): void {
  try {
    trackEvent(e.outcome === "shown" ? "media_shown" : "media_unavailable", {
      ...e,
    });
  } catch {
    // ignore
  }

  if (e.outcome !== "error" || typeof navigator === "undefined") return;

  try {
    const body = JSON.stringify(e);
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(
        "/api/media-event",
        new Blob([body], { type: "application/json" }),
      );
    } else {
      void fetch("/api/media-event", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "application/json" },
      });
    }
  } catch {
    // ignore — never break the feed
  }
}

/** Classify a media URL without logging the (secret) signed query string. */
export function classifyMediaSrc(url: string): MediaEventInput["srcKind"] {
  if (!url) return "unknown";
  if (url.startsWith("/api/media/")) return "api_route";
  if (/^https?:\/\//.test(url)) return "r2_presigned";
  return "unknown";
}
