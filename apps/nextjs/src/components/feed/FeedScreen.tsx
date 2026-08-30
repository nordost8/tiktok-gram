"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { recordViewBeacon } from "~/lib/telegram/record-view-beacon";
import { useTRPC } from "~/trpc/react";
import { trackEvent } from "~/lib/analytics";
import { useFeedLogger } from "~/hooks/use-feed-logger";
import { viewedPostsStore } from "~/lib/feed/viewed-posts-store";
import { useAppConfig } from "~/components/app/AppConfigProvider";

import { hapticImpact } from "~/lib/telegram/haptic";
import { FeedMuteProvider } from "./FeedMuteContext";
import { FeedPullPanel, PULL_PX } from "./FeedPullPanel";
import { FeedTabs } from "./FeedTabs";
import { FeedBlockedOverlay } from "./FeedBlockedOverlay";
import type { BlockDebugState } from "./FeedBlockedOverlay";
import type { FeedPost, FeedTab } from "./types";
import { VerticalFeedSwiper } from "./VerticalFeedSwiper";
import { isForceImagesEnabled } from "./feed-navigation";
import type { CarouselMediaItem } from "./FeedImageCarousel";

interface FeedScreenProps {
  onOpenHistory?: () => void;
}

function viewMetrics(startedAt: number): {
  durationMs: number;
  completedPercent: number;
} {
  const durationMs = Math.max(0, Date.now() - startedAt);
  return {
    durationMs,
    // Heuristic: 100% at ~30s, scaled linearly. Same behaviour as before.
    completedPercent: Math.min(100, Math.round(durationMs / 300)),
  };
}

/** Synthetic photo items used when ?tiktokGramForceImages=1 */
const SYNTHETIC_MEDIA_ITEMS: CarouselMediaItem[] = [
  { id: "synthetic-photo-a", type: "photo", url: "https://picsum.photos/seed/tiktok-gram-a/1080/1920", width: 1080, height: 1920, mimeType: "image/jpeg" },
  { id: "synthetic-photo-b", type: "photo", url: "https://picsum.photos/seed/tiktok-gram-b/1080/1920", width: 1080, height: 1920, mimeType: "image/jpeg" },
  { id: "synthetic-photo-c", type: "photo", url: "https://picsum.photos/seed/tiktok-gram-c/1080/1920", width: 1080, height: 1920, mimeType: "image/jpeg" },
  { id: "synthetic-photo-d", type: "photo", url: "https://picsum.photos/seed/tiktok-gram-d/1080/1920", width: 1080, height: 1920, mimeType: "image/jpeg" },
];

type FeedPostWithAlbum = FeedPost & { mediaItems?: CarouselMediaItem[] };

function makeSyntheticPhotoPost(): FeedPostWithAlbum {
  return {
    id: "synthetic-photo-post-dev",
    telegramUrl: "https://t.me/tiktok_gram_dev/1",
    text: "[DEV] Synthetic photo album — ?tiktokGramForceImages=1",
    caption: null,
    displayText: null,
    originalText: "[DEV] Synthetic photo album — ?tiktokGramForceImages=1",
    translationAvailable: false,
    sourceLang: null,
    publishedAt: new Date().toISOString(),
    channel: {
      id: "synthetic-channel-dev",
      title: "TiktokGram Dev",
      username: "tiktok_gram_dev",
      avatarUrl: "/api/channel-avatar/synthetic-channel-dev",
    },
    primaryMedia: {
      id: "synthetic-photo-a",
      type: "photo",
      url: "https://picsum.photos/seed/tiktok-gram-a/1080/1920",
      thumbnailUrl: null,
      width: 1080,
      height: 1920,
      duration: null,
      mimeType: "image/jpeg",
      cacheStatus: "ready",
    },
    stats: { views: 0, likes: 0, saves: 0, shares: 0 },
    viewerState: { liked: false, saved: false, subscribed: false },
    // No real TikTok track for the synthetic dev post (the ticker just won't show).
    audio: undefined,
    mediaItems: SYNTHETIC_MEDIA_ITEMS,
  };
}

export function FeedScreen({ onOpenHistory }: FeedScreenProps) {
  const { t } = useTranslation();
  const { locale } = useAppConfig();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<FeedTab>("forYou");
  const [blockOverlay, setBlockOverlay] = useState<BlockDebugState | null>(null);
  // True while the pull-down panel is revealed (user tried to go back at the first post).
  const [pulled, setPulled] = useState(false);
  // Evaluated once at mount — reads window.location.search (client-only)
  const [forceImages] = useState(() => isForceImagesEnabled());
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const log = useFeedLogger();

  const activePostIdRef = useRef<string | null>(null);
  const prevIndexRef = useRef<number>(-1);
  const viewStartedAtRef = useRef<number>(0);

  const recordViewMutation = useMutation(
    trpc.interactions.recordView.mutationOptions(),
  );
  const recordViewMutateRef = useRef(recordViewMutation.mutate);
  useEffect(() => {
    recordViewMutateRef.current = recordViewMutation.mutate;
  }, [recordViewMutation.mutate]);

  // TikTok-style hard reset on every FeedScreen mount: drop all cached pages
  // BEFORE the infinite queries subscribe so the very first render is already
  // in the loading state and never flashes the previous session's posts.
  // useState lazy init runs synchronously before the first render — critical to
  // avoid a 1-frame flash of stale data that useEffect([], []) would cause.
  // It also runs on every new mount (including remount after Interests nav).
  useState(() => {
    queryClient.removeQueries({ queryKey: trpc.feed.forYou.infiniteQueryKey() });
    queryClient.removeQueries({ queryKey: trpc.feed.subscriptions.infiniteQueryKey() });
    return null;
  });

  const forYouQuery = useInfiniteQuery(
    trpc.feed.forYou.infiniteQueryOptions(
      { limit: 15 },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );

  const subsQuery = useInfiniteQuery(
    trpc.feed.subscriptions.infiniteQueryOptions(
      { limit: 15 },
      { getNextPageParam: (last) => last.nextCursor },
    ),
  );

  const query = tab === "forYou" ? forYouQuery : subsQuery;

  const pages = query.data?.pages;
  const posts = useMemo<FeedPostWithAlbum[]>(() => {
    const seen = new Set<string>();
    const result: FeedPostWithAlbum[] = [];
    // Prepend synthetic photo post in dev/force-images mode
    if (forceImages) {
      const synthetic = makeSyntheticPhotoPost();
      seen.add(synthetic.id);
      result.push(synthetic);
    }
    if (!pages) return result;
    for (const page of pages) {
      for (const item of page.items) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        result.push(item);
      }
    }
    return result;
  }, [pages, forceImages]);
  const emptyReason = pages?.[0]?.emptyReason;

  const feedEndTrackedRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!query.hasNextPage && !query.isLoading && posts.length > 0 && !feedEndTrackedRef.current[tab]) {
      feedEndTrackedRef.current[tab] = true;
      trackEvent("feed_end_reached", { tab, total_posts: posts.length });
    }
  }, [query.hasNextPage, query.isLoading, posts.length, tab]);

  const recordViewForPost = useCallback(
    (postId: string, metrics: { durationMs: number; completedPercent: number }) => {
      if (viewedPostsStore.has(postId)) return;
      viewedPostsStore.add(postId);
      recordViewMutateRef.current({
        postId,
        durationMs: metrics.durationMs,
        completedPercent: metrics.completedPercent,
      });
    },
    [],
  );

  const queryRef = useRef(query);
  const postsRef = useRef(posts);
  useEffect(() => {
    queryRef.current = query;
    postsRef.current = posts;
  }, [query, posts]);

  const handleActiveIndexChange = useCallback(
    (_index: number, post: FeedPost | undefined) => {
      // Any successful navigation collapses the pull-down panel.
      setPulled(false);
      const nextPostId = post?.id ?? null;
      const prevPostId = activePostIdRef.current;

      // Log swipe direction to backend
      const prevIdx = prevIndexRef.current;
      if (prevIdx !== -1 && prevIdx !== _index) {
        const q = queryRef.current;
        log({
          eventType: _index > prevIdx ? "swipe_next" : "swipe_prev",
          tab,
          activeIndex: _index,
          totalPosts: postsRef.current.length,
          pagesLoaded: q.data?.pages.length,
          hasNextPage: q.hasNextPage,
          isFetching: q.isFetchingNextPage,
          postId: post?.id,
          cursorSnapshot: q.data?.pages.at(-1)?.nextCursor ?? undefined,
        });
      }
      prevIndexRef.current = _index;

      // Flush a measured view for the post we are leaving — gives the server
      // real `durationMs` / `completedPercent` values for that impression
      // (the upsert is idempotent thanks to the unique index, so this is
      // cheap even if the view was already recorded on enter).
      if (prevPostId && prevPostId !== nextPostId) {
        recordViewForPost(prevPostId, viewMetrics(viewStartedAtRef.current));
      }

      if (prevPostId !== nextPostId) {
        activePostIdRef.current = nextPostId;
        viewStartedAtRef.current = Date.now();
      }

      // Instant TikTok-style "seen" marker: as soon as a post becomes active,
      // mark it viewed even before the user moves on. This ensures the
      // bottom-most post in a session also gets recorded.
      if (nextPostId) {
        recordViewForPost(nextPostId, {
          durationMs: 0,
          completedPercent: 0,
        });
      }
    },
    [recordViewForPost, log, tab],
  );

  // Reliable last-view flush: when the user navigates away (FeedScreen
  // unmounts), or hides the document/closes the mini-app, send a beacon
  // request with the real metrics for the currently active post. Uses
  // fetch+keepalive so the request survives document teardown.
  useEffect(() => {
    const flush = () => {
      const postId = activePostIdRef.current;
      if (!postId) return;
      recordViewBeacon({
        postId,
        ...viewMetrics(viewStartedAtRef.current),
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
      flush();
      if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    };
  }, []);

  const fetchNextPage = query.fetchNextPage;
  const hasNextPage = query.hasNextPage;
  const isFetchingNextPage = query.isFetchingNextPage;

  const handleNearEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const handleSwipeBlocked = useCallback(
    (reason: string, activeIndex: number) => {
      const state: BlockDebugState = {
        reason,
        activeIndex,
        totalPosts: posts.length,
        pagesLoaded: query.data?.pages.length,
        hasNextPage: query.hasNextPage,
        isFetching: query.isFetchingNextPage,
        cursor: query.data?.pages.at(-1)?.nextCursor,
        tab,
        timestamp: new Date().toLocaleTimeString(locale === "uk" ? "uk-UA" : "en-US"),
      };

      // Pulling back at the first post → slide the whole UI down to reveal the
      // "look forward" panel + history link, with a light haptic tap.
      if (reason === "at_first_post") {
        setPulled((was) => {
          if (!was) hapticImpact("light");
          return true;
        });
      }

      // swipe_too_weak shows a toast in VerticalFeedSwiper; other reasons get the debug overlay.
      if (reason !== "at_first_post" && reason !== "swipe_too_weak") {
        setBlockOverlay(state);
        if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
        blockTimerRef.current = setTimeout(() => setBlockOverlay(null), 8000);
      }

      // Log to backend with full state snapshot
      log({
        eventType: "swipe_blocked",
        tab,
        activeIndex,
        totalPosts: posts.length,
        pagesLoaded: query.data?.pages.length,
        hasNextPage: query.hasNextPage,
        isFetching: query.isFetchingNextPage,
        cursorSnapshot: query.data?.pages.at(-1)?.nextCursor ?? undefined,
        blockReason: reason,
      });
    },
    [log, tab, posts.length, query, blockTimerRef, locale],
  );

  // Log when a new page is fetched (fires when isFetchingNextPage flips false)
  const prevFetchingRef = useRef(false);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetchingNextPage && posts.length > 0) {
      log({
        eventType: "page_fetched",
        tab,
        totalPosts: posts.length,
        pagesLoaded: query.data?.pages.length,
        hasNextPage: query.hasNextPage,
        isFetching: false,
      });
    }
    prevFetchingRef.current = isFetchingNextPage;
  }, [isFetchingNextPage, log, tab, posts.length, query.data?.pages.length, query.hasNextPage]);

  return (
    <FeedMuteProvider>
      {/* Full-screen container — scroll fills 100%, header/tabs float on top */}
      <div className="relative h-full bg-black" style={{ overflow: "clip" }}>
        {/* Pull-down panel sits behind the stage; revealed when the stage slides down. */}
        <FeedPullPanel
          open={pulled}
          onOpenHistory={() => {
            setPulled(false);
            onOpenHistory?.();
          }}
        />

        {/* Stage — the whole feed UI (content + header + tabs) slides down with a
            spring to reveal the pull panel. Tapping it while open collapses it. */}
        <div
          className="absolute inset-0 z-10 bg-black"
          style={{
            transform: pulled ? `translateY(${PULL_PX}px)` : "translateY(0)",
            transition: "transform 540ms cubic-bezier(0.34,1.56,0.64,1)",
          }}
          onPointerDownCapture={() => {
            if (pulled) setPulled(false);
          }}
        >
        {/* Full-height scroll area comes first so it receives touch events */}
        {query.isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            {t("feed.screen.loading")}
          </div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.errorTitle")}</p>
            <p className="text-sm text-zinc-400">
              {t("feed.screen.errorBody")}
            </p>
          </div>
        ) : tab === "forYou" && posts.length === 0 && emptyReason === "all_viewed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.allViewedTitle")}</p>
            <p className="text-sm leading-relaxed text-zinc-400">
              {t("feed.screen.forYou.allViewedBody")}
            </p>
          </div>
        ) : tab === "forYou" && posts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.emptyVideoTitle")}</p>
            <p className="text-sm text-zinc-400">
              {t("feed.screen.forYou.emptyBody")}
            </p>
          </div>
        ) : tab === "subscriptions" &&
          posts.length === 0 &&
          emptyReason === "all_viewed" ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.allViewedTitle")}</p>
            <p className="text-sm leading-relaxed text-zinc-400">
              {t("feed.screen.subscriptions.allViewedBody")}
            </p>
          </div>
        ) : tab === "subscriptions" &&
          posts.length === 0 &&
          emptyReason === "no_subscriptions" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.noSubscriptionsTitle")}</p>
            <p className="text-sm text-zinc-400">
              {t("feed.screen.noSubscriptionsBody")}
            </p>
          </div>
        ) : tab === "subscriptions" && posts.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-lg font-medium">{t("feed.screen.emptyVideoTitle")}</p>
            <p className="text-sm text-zinc-400">
              {t("feed.screen.subscriptions.emptyBody")}
            </p>
          </div>
        ) : (
          <Suspense fallback={null}>
            <VerticalFeedSwiper
              key={tab}
              posts={posts}
              onActiveIndexChange={handleActiveIndexChange}
              onNearEnd={handleNearEnd}
              onSwipeBlocked={handleSwipeBlocked}
              isExhausted={!query.hasNextPage && !query.isFetchingNextPage && posts.length > 0}
              isFetchingNextPage={query.isFetchingNextPage}
            />
          </Suspense>
        )}

        {/* Floating overlays — pointer-events passthrough except interactive elements */}
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex items-center justify-center">
          <div className="pointer-events-auto">
            <FeedTabs value={tab} onChange={(t) => { setTab(t); trackEvent("feed_tab_changed", { tab: t }); }} />
          </div>
        </div>
        </div>
        {/* Debug toast stays above the stage, not affected by the pull. */}
        <FeedBlockedOverlay state={blockOverlay} onDismiss={() => setBlockOverlay(null)} />
      </div>
    </FeedMuteProvider>
  );
}
