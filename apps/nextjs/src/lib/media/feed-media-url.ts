const MEDIA_API_PREFIX = "/api/media/";

export function feedMediaApiPath(mediaId: string, refresh = 0): string {
  if (refresh > 0) {
    return `${MEDIA_API_PREFIX}${mediaId}?refresh=${refresh}`;
  }
  return `${MEDIA_API_PREFIX}${mediaId}`;
}

/**
 * Canonical same-origin media URL for `<video>` / `<img>` / prefetch.
 * Telegram WebView is unreliable with bare relative paths and cross-origin R2
 * presigned URLs — always derive from media id + current origin.
 */
export function feedMediaApiUrl(mediaId: string, refresh = 0): string {
  const path = feedMediaApiPath(mediaId, refresh);
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).href;
}

export function feedPostAudioApiUrl(descId: string): string {
  const path = `/api/post-audio/${descId}`;
  if (typeof window === "undefined") return path;
  return new URL(path, window.location.origin).href;
}

/** Ignore presigned / stale payload URLs — always stream via our API route. */
export function coerceFeedMediaUrl(
  mediaId: string,
  refresh = 0,
): string {
  return feedMediaApiUrl(mediaId, refresh);
}

/**
 * Resolve a server-provided media URL for use in the client.
 *
 * - Absolute URLs (presigned R2 — `https://…`) are used AS-IS so video bytes go
 *   client→R2 directly (the Pi is never in the byte path).
 * - Relative URLs (`/api/media/…`, e.g. Postgres-backed photos or the rare
 *   presign-failure emergency path) are absolutized against the current origin,
 *   which Telegram WebView handles more reliably than bare relative paths.
 */
export function toClientMediaUrl(serverUrl: string): string {
  if (/^https?:\/\//.test(serverUrl)) return serverUrl;
  if (typeof window === "undefined") return serverUrl;
  return new URL(serverUrl, window.location.origin).href;
}
