import type { TFunction } from "i18next";

import type { Locale } from "~/lib/i18n";

/**
 * Height (px) of the black band reserved at the bottom of every feed post.
 * Media (video/photo) is letterboxed ABOVE it; the caption, the track ticker and
 * the carousel dots live INSIDE it — so text/controls never overlap the content.
 */
export const FEED_INFO_INSET_PX = 124;

// M/K abbreviations are language-neutral (used as-is in both English and
// Ukrainian UI copy), so this doesn't need any i18n treatment.
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

/**
 * This module is a plain (non-React) function library, so it can't call
 * `useTranslation()` itself — the caller passes in its own `t` (from
 * `useTranslation()`) and `locale` (from `useAppConfig()`), the same pattern
 * used by `feed-media-state.ts` for pure modules that need i18n.
 */
export function formatRelativeTime(iso: string, locale: Locale, t: TFunction): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return t("feed.relativeTime.minutes", { count: Math.max(1, minutes) });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("feed.relativeTime.hours", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t("feed.relativeTime.days", { count: days });
  return date.toLocaleDateString(locale === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short" });
}

export function postCaption(post: {
  caption: string | null;
  text: string | null;
  displayText?: string | null;
}) {
  if (post.displayText?.trim()) return post.displayText;
  return post.caption ?? post.text ?? "";
}

export function postOriginalCaption(post: {
  caption: string | null;
  text: string | null;
  originalText?: string | null;
}) {
  if (post.originalText?.trim()) return post.originalText;
  return post.caption ?? post.text ?? "";
}

export function postHasTranslation(post: {
  translationAvailable?: boolean;
  displayText?: string | null;
}) {
  return Boolean(post.translationAvailable && post.displayText?.trim());
}

/**
 * A channel is public only if it has a non-numeric username.
 * Private channels use numeric "username" (or none) and have no public t.me link.
 */
export function isPublicChannel(channel: { username: string | null }): boolean {
  const u = channel.username;
  return !!u && !/^-?\d+$/.test(u);
}
