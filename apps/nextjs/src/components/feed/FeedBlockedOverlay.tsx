"use client";

import { useTranslation } from "react-i18next";

export interface BlockDebugState {
  reason: string;
  activeIndex: number;
  totalPosts: number;
  pagesLoaded: number | undefined;
  hasNextPage: boolean;
  isFetching: boolean;
  cursor: string | null | undefined;
  tab: string;
  timestamp: string;
}

interface FeedBlockedOverlayProps {
  state: BlockDebugState | null;
  onDismiss: () => void;
}

// Same reason codes as VerticalFeedSwiper's BLOCK_MESSAGE_KEYS — kept as a
// single source of truth in lib/i18n/messages/*.json under `feed.swipeBlock`
// (previously this overlay had its own, differently-worded copy).
const REASON_KEYS: Record<string, string> = {
  fetching_next_page: "feed.swipeBlock.fetchingNextPage",
  all_viewed: "feed.swipeBlock.allViewed",
  at_first_post: "feed.swipeBlock.atFirstPost",
  swipe_too_weak: "feed.swipeBlock.swipeTooWeak",
  slide_height_zero: "feed.swipeBlock.initializing",
};

export function FeedBlockedOverlay({ state, onDismiss }: FeedBlockedOverlayProps) {
  const { t } = useTranslation();
  if (!state) return null;

  const reasonKey = REASON_KEYS[state.reason] ?? "feed.swipeBlock.generic";
  const label = t(reasonKey);
  const isFetching = state.reason === "fetching_next_page";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-28 z-50 flex justify-center px-4 animate-in slide-in-from-bottom-4 duration-200"
    >
      <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-yellow-500/30 bg-zinc-900/95 p-4 backdrop-blur-md shadow-xl">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isFetching ? (
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
            ) : (
              <span className="text-yellow-400 text-sm">⚠</span>
            )}
            <span className="text-xs font-semibold uppercase tracking-wide text-yellow-400">
              {t("feed.swipeBlock.title")}
            </span>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="text-zinc-500 text-sm leading-none hover:text-zinc-300"
            aria-label={t("common.close")}
          >
            ✕
          </button>
        </div>

        {/* User-facing reason */}
        <p className="mb-3 text-sm text-zinc-100">{label}</p>

        {/* Debug variables */}
        <div className="space-y-1 font-mono text-[11px] text-zinc-400">
          <div className="flex justify-between">
            <span className="text-zinc-500">reason</span>
            <span className="text-yellow-300">{state.reason}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">index</span>
            <span>{state.activeIndex + 1} / {state.totalPosts}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">pages</span>
            <span>{state.pagesLoaded ?? "—"}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">hasNextPage</span>
            <span className={state.hasNextPage ? "text-green-400" : "text-red-400"}>
              {String(state.hasNextPage)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">isFetching</span>
            <span className={state.isFetching ? "text-blue-400" : "text-zinc-400"}>
              {String(state.isFetching)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">tab</span>
            <span>{state.tab}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="shrink-0 text-zinc-500">cursor</span>
            <span className="truncate text-right">
              {state.cursor ? state.cursor.slice(0, 24) + "…" : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">at</span>
            <span>{state.timestamp}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
