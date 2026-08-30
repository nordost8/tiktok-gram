"use client";

import { useEffect, useRef, useState } from "react";

import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";

import { FeedCard } from "~/components/feed/FeedCard";
import type { FeedPost } from "~/components/feed/types";

interface GridPage {
  items: FeedPost[];
  nextCursor?: string;
}

interface PostGridListProps {
  title: string;
  emptyText: string;
  query: UseInfiniteQueryResult<
    {
      pages: GridPage[];
      pageParams: unknown[];
    },
    unknown
  >;
  selectedPost: FeedPost | null;
  onSelectPost: (post: FeedPost | null) => void;
  onBack: () => void;
}

const COLS = 3;
const GAP = 2; // px between cells, matches the old grid's thin separators

function GridThumb({
  post,
  onSelect,
}: {
  post: FeedPost;
  onSelect: (post: FeedPost) => void;
}) {
  const isVideo =
    post.primaryMedia.type === "video" || post.primaryMedia.type === "animation";
  const isEvicted =
    post.primaryMedia.cacheStatus === "needs_cache" ||
    post.primaryMedia.cacheStatus === "failed";
  const thumb = post.primaryMedia.thumbnailUrl ?? (!isVideo ? post.primaryMedia.url : null);
  const showVideoFallback = isVideo && !thumb && !isEvicted;

  return (
    <button
      type="button"
      onClick={() => onSelect(post)}
      className="relative h-full w-full overflow-hidden bg-zinc-950"
    >
      {thumb && !isEvicted ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : showVideoFallback ? (
        <video
          src={post.primaryMedia.url}
          preload="metadata"
          muted
          playsInline
          className="h-full w-full object-cover"
          aria-hidden
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = 0.1;
          }}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <svg
            viewBox="0 0 24 24"
            className="h-8 w-8 text-zinc-700"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 5v14l11-7L8 5z" />
          </svg>
        </div>
      )}
      {isEvicted ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
      ) : isVideo ? (
        <div className="absolute bottom-1.5 right-1.5">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]"
            fill="currentColor"
            aria-hidden
          >
            <path d="M8 5v14l11-7L8 5z" />
          </svg>
        </div>
      ) : null}
    </button>
  );
}

export function PostGridList({ title, emptyText, query: postsQuery, selectedPost, onSelectPost, onBack: _onBack }: PostGridListProps) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [muted, setMuted] = useState(true);

  // Cell size (square) derived from the scroll container width → keeps the grid
  // responsive inside the phone-width frame.
  const [cellSize, setCellSize] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      if (w > 0) setCellSize((w - GAP * (COLS - 1)) / COLS);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const posts = postsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  const rowCount = Math.ceil(posts.length / COLS);
  const rowHeight = cellSize + GAP;

  // Virtualize ROWS — only the visible rows (+ small overscan) are mounted, so
  // memory stays flat no matter how long the history is.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });

  // Re-measure virtual rows whenever the cell size changes (e.g. resize/rotate).
  useEffect(() => {
    rowVirtualizer.measure();
  }, [rowHeight, rowVirtualizer]);

  // Infinite scroll: fetch the next page as the last virtual rows come into view.
  const virtualRows = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (!last) return;
    if (
      last.index >= rowCount - 2 &&
      postsQuery.hasNextPage &&
      !postsQuery.isFetchingNextPage
    ) {
      void postsQuery.fetchNextPage();
    }
  }, [virtualRows, rowCount, postsQuery]);

  if (selectedPost) {
    return (
      <div className="relative h-full w-full">
        <FeedCard
          post={selectedPost}
          isActive={true}
          mountMedia={true}
          muted={muted}
          overlayVisible={overlayVisible}
          onToggleMute={() => setMuted((m) => !m)}
          onToggleOverlay={() => setOverlayVisible((v) => !v)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="flex shrink-0 items-center justify-center border-b border-zinc-900 px-4 py-4">
        <h1 className="text-lg font-semibold">{title}</h1>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {posts.length === 0 && !postsQuery.isLoading ? (
          <p className="py-8 px-6 text-center text-sm text-zinc-500">{emptyText}</p>
        ) : cellSize > 0 ? (
          <>
            <div
              className="relative w-full"
              style={{ height: rowVirtualizer.getTotalSize() }}
            >
              {virtualRows.map((vRow) => {
                const start = vRow.index * COLS;
                const rowPosts = posts.slice(start, start + COLS);
                return (
                  <div
                    key={vRow.key}
                    className="absolute left-0 top-0 grid w-full grid-cols-3"
                    style={{
                      height: cellSize,
                      gap: GAP,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                  >
                    {rowPosts.map((post) => (
                      <GridThumb key={post.id} post={post} onSelect={onSelectPost} />
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="py-4 text-center">
              {postsQuery.isFetchingNextPage ? (
                <p className="text-xs text-zinc-500">{t("common.loading")}</p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
