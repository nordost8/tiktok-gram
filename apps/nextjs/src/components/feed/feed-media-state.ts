export type MediaCacheStatus =
  | "needs_cache"
  | "downloading"
  | "ready"
  | "failed"
  | "skipped"
  | null
  | undefined;

export function isMediaCaching(status: MediaCacheStatus): boolean {
  return status === "needs_cache" || status === "downloading";
}

export function isMediaPolicyBlocked(status: MediaCacheStatus): boolean {
  return status === "skipped";
}

/**
 * Returns an i18n key (see lib/i18n/messages/*.json under `feed.media.unavailable`),
 * not display text — this module has no React/i18next dependency so it stays
 * unit-testable in isolation. Callers translate with `t(key)`.
 */
export function mediaUnavailableMessage(status: MediaCacheStatus): string {
  if (status === "skipped") {
    return "feed.media.unavailable.tooLarge";
  }
  if (status === "failed") {
    return "feed.media.unavailable.temporary";
  }
  return "feed.media.unavailable.generic";
}

/**
 * Returns an i18n key (see `feed.media.hint` in lib/i18n/messages/*.json) or
 * `null` when no hint should show. Callers translate with `t(key)`.
 */
export function mediaLoadingHint(
  status: MediaCacheStatus,
  slow: boolean,
): string | null {
  if (isMediaCaching(status)) {
    if (slow) {
      return "feed.media.hint.cachingSlow";
    }
    return "feed.media.hint.caching";
  }
  if (slow) {
    return "feed.media.hint.loading";
  }
  return null;
}
