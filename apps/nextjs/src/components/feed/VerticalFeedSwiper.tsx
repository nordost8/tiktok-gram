"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import { useTranslation } from "react-i18next";

import type { FeedPost } from "./types";
import { isDevFeedNavEnabled } from "./feed-navigation";
import { FeedCard } from "./FeedCard";
import type { CarouselController } from "./FeedImageCarousel";
import { useFeedMute } from "./FeedMuteContext";
import { trackEvent } from "~/lib/analytics";
import { FeedController } from "./engine/FeedController";
import type { SlotInfo } from "./engine/FeedController";
import type { SwipeBlockReason } from "./engine/FeedState";

interface VerticalFeedSwiperProps {
  posts: FeedPost[];
  onActiveIndexChange: (index: number, post: FeedPost | undefined) => void;
  onNearEnd: () => void;
  onSwipeBlocked?: (reason: SwipeBlockReason, activeIndex: number) => void;
  isExhausted?: boolean;
  isFetchingNextPage?: boolean;
}

// A module-scope map can't call the useTranslation hook, so this returns an
// i18n key (see `feed.swipeBlock` in lib/i18n/messages/*.json) — translate it
// with `t()` at the render site.
const BLOCK_MESSAGE_KEYS: Record<SwipeBlockReason, string> = {
  fetching_next_page: "feed.swipeBlock.fetchingNextPage",
  all_viewed: "feed.swipeBlock.allViewed",
  at_first_post: "feed.swipeBlock.atFirstPost",
  swipe_too_weak: "feed.swipeBlock.swipeTooWeak",
  slide_height_zero: "feed.swipeBlock.initializing",
};

function mediaItemsLen(post: FeedPost | null | undefined): number {
  return (
    (post as { mediaItems?: unknown[] } | null | undefined)?.mediaItems
      ?.length ?? 0
  );
}

const SLOT_KEYS = ["slot-0", "slot-1", "slot-2"] as const;

// Best-effort initial height estimate to avoid a one-frame flash at mount.
const INITIAL_H =
  typeof window !== "undefined" ? window.innerHeight : 812;

function makeInitialSlotInfo(): SlotInfo {
  return {
    absoluteIndices: [-1, 0, 1],
    baseY: [-INITIAL_H, 0, INITIAL_H],
    activeSlot: 1,
    sharedOffset: 0,
  };
}

export function VerticalFeedSwiper({
  posts,
  onActiveIndexChange,
  onNearEnd,
  onSwipeBlocked,
  isExhausted = false,
  isFetchingNextPage = false,
}: VerticalFeedSwiperProps) {
  const { t } = useTranslation();
  const { muted, toggleMuted } = useFeedMute();
  const searchParams = useSearchParams();
  const showDevNav = isDevFeedNavEnabled(searchParams);

  // ─── DOM refs ─────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null);
  const slotDomRefs = useRef<(HTMLDivElement | null)[]>([null, null, null]);

  // Refs track the "live" positions so onOffsetChange can avoid React setState
  const slotBaseYRef = useRef<[number, number, number]>([-INITIAL_H, 0, INITIAL_H]);
  const sharedOffsetRef = useRef(0);

  const [overlayVisible, setOverlayVisible] = useState(true);
  const toggleOverlay = useCallback(() => setOverlayVisible((v) => !v), []);

  const [blockToast, setBlockToast] = useState<SwipeBlockReason | null>(null);
  const blockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Carousel controller for the active photo-carousel slot
  const carouselControllerRef = useRef<CarouselController | null>(null);
  const [carouselState, setCarouselState] = useState<{ index: number; total: number } | null>(null);

  // Low-frequency React state: which post is in each slot
  const [slotInfo, setSlotInfo] = useState<SlotInfo>(makeInitialSlotInfo);

  // Stable callback — identity only changes when the active slot changes, so
  // FeedImageCarousel's useEffect([..., onRegisterController]) won't re-run on
  // every render (which would cause a setState → render → new fn → loop).
  const handleRegisterController = useCallback(
    (api: CarouselController) => {
      carouselControllerRef.current = api;
      setCarouselState(api.getState());
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotInfo.activeSlot],
  );

  const onActiveRef = useRef(onActiveIndexChange);
  const onNearEndRef = useRef(onNearEnd);
  const onSwipeBlockedRef = useRef(onSwipeBlocked);
  useEffect(() => {
    onActiveRef.current = onActiveIndexChange;
    onNearEndRef.current = onNearEnd;
    onSwipeBlockedRef.current = onSwipeBlocked;
  }, [onActiveIndexChange, onNearEnd, onSwipeBlocked]);

  // ─── FeedController (one per mount) ───────────────────────────────────────
  const controllerRef = useRef<FeedController | null>(null);
  if (controllerRef.current === null) {
    const ctrl = new FeedController();
    // Pre-set slide height so slot positions are correct on first paint.
    ctrl.setSlideHeight(INITIAL_H);
    controllerRef.current = ctrl;
  }
  const controller = controllerRef.current;

  // ─── Direct-DOM transform helpers ─────────────────────────────────────────
  const applyTransforms = useCallback(() => {
    const baseY = slotBaseYRef.current;
    const offset = sharedOffsetRef.current;
    for (let i = 0; i < 3; i++) {
      const el = slotDomRefs.current[i];
      if (el) el.style.transform = `translateY(${(baseY[i] ?? 0) + offset}px)`;
    }
  }, []);

  // ─── Wire controller callbacks ────────────────────────────────────────────
  useEffect(() => {
    const ctrl = controllerRef.current!;

    // High-frequency: bypass React, mutate DOM directly
    ctrl.onOffsetChange = (offset) => {
      sharedOffsetRef.current = offset;
      applyTransforms();
    };

    // Low-frequency: sync baseY ref + DOM + React state atomically
    ctrl.onSlotsChange = (info) => {
      slotBaseYRef.current = [...info.baseY] as [number, number, number];
      sharedOffsetRef.current = info.sharedOffset;
      applyTransforms(); // immediate DOM correction before React re-renders
      setSlotInfo(info);
    };

    ctrl.onActiveIndexChange = (index, post) => {
      onActiveRef.current(index, post ?? undefined);
      // Neighbour videos (active±1) are mounted by the slot window and buffer
      // themselves via <video preload="auto"> pointed at the real R2 URL — no
      // JS prefetch needed (and a fetch() to cross-origin R2 would need CORS
      // and would re-route bytes through the Pi if aimed at /api/media).
      // PostHog event
      const p = ctrl.repo.get(index);
      if (p && index > 0) {
        trackEvent("post_swiped", {
          post_id: p.id,
          channel: p.channel.title,
          media_type: p.primaryMedia.type,
          feed_index: index,
        });
      }
    };

    ctrl.onNearEnd = () => onNearEndRef.current();

    ctrl.onSwipeBlocked = (reason) => {
      // at_first_post is handled by the parent (FeedScreen) via onSwipeBlocked below —
      // it slides the whole UI down to reveal the pull panel. Here we only toast weak swipes.
      if (reason === "swipe_too_weak") {
        setBlockToast(reason);
        if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
        blockTimerRef.current = setTimeout(() => setBlockToast(null), 2200);
      }
      onSwipeBlockedRef.current?.(reason, ctrl.activeAbsoluteIndex);
    };

    return () => {
      ctrl.onOffsetChange = null;
      ctrl.onSlotsChange = null;
      ctrl.onActiveIndexChange = null;
      ctrl.onNearEnd = null;
      ctrl.onSwipeBlocked = null;
      if (blockTimerRef.current) clearTimeout(blockTimerRef.current);
    };
  }, [applyTransforms]);

  // Apply initial transforms before first paint (layout effect runs before paint)
  useLayoutEffect(() => {
    applyTransforms();
  }, [applyTransforms]);

  // ─── Sync posts + status into repository ──────────────────────────────────
  const visiblePosts = useMemo(
    () => posts.filter((p) => p.primaryMedia.url),
    [posts],
  );

  useEffect(() => {
    controller.syncPosts(visiblePosts);
  }, [controller, visiblePosts]);

  useEffect(() => {
    controller.syncStatus(isFetchingNextPage, isExhausted && !isFetchingNextPage);
  }, [controller, isFetchingNextPage, isExhausted]);

  // ─── Attach gesture + measure container height ────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    controller.attach(container);

    const ro = new ResizeObserver(([entry]) => {
      const h = entry?.contentRect.height ?? 0;
      if (h > 0) controller.setSlideHeight(h);
    });
    ro.observe(container);

    return () => {
      controller.detach();
      ro.disconnect();
    };
  }, [controller]);

  // ─── Dev keyboard navigation ──────────────────────────────────────────────
  useEffect(() => {
    if (!showDevNav) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      if (e.key === "ArrowDown" || e.key === "PageDown") {
        e.preventDefault();
        controller.goForward();
      } else if (e.key === "ArrowUp" || e.key === "PageUp") {
        e.preventDefault();
        controller.goBackward();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, showDevNav]);

  // ─── Clear carousel controller when active post is not a photo album ───────
  // Keyed on the primitive `activeIsPhotoAlbum` (NOT slotInfo.absoluteIndices,
  // whose array identity changes on every slot update and would wipe a fresh
  // registration). Parent effects run AFTER child effects, so clearing on any
  // index change would clobber the new carousel's mount-time registration —
  // instead we only clear when the active post genuinely isn't a photo album.
  const activeCarouselPost = controller.repo.get(
    slotInfo.absoluteIndices[slotInfo.activeSlot] ?? -1,
  );
  const activeIsPhotoAlbum =
    !!activeCarouselPost &&
    activeCarouselPost.primaryMedia.type === "photo" &&
    mediaItemsLen(activeCarouselPost) > 1;
  useEffect(() => {
    if (!activeIsPhotoAlbum) {
      carouselControllerRef.current = null;
      setCarouselState(null);
    }
  }, [activeIsPhotoAlbum]);

  // ─── window.tiktokGramFeed dev API ──────────────────────────────────────────
  useEffect(() => {
    window.tiktokGramFeed = {
      next: () => controller.goForward(),
      prev: () => controller.goBackward(),
      goTo: (index: number) => {
        const diff = index - controller.activeAbsoluteIndex;
        if (diff > 0) for (let i = 0; i < diff; i++) controller.goForward();
        else for (let i = 0; i < -diff; i++) controller.goBackward();
      },
      getActiveIndex: () => controller.activeAbsoluteIndex,
      getPostCount: () => controller.repo.totalLoaded,
      carouselNext: () => {
        carouselControllerRef.current?.next();
        const api = carouselControllerRef.current;
        if (api) setCarouselState({ ...api.getState() });
      },
      carouselPrev: () => {
        carouselControllerRef.current?.prev();
        const api = carouselControllerRef.current;
        if (api) setCarouselState({ ...api.getState() });
      },
      getCarouselState: () => {
        const active = controller.repo.get(controller.activeAbsoluteIndex);
        const isPhotoPost =
          !!active &&
          active.primaryMedia.type === "photo" &&
          mediaItemsLen(active) > 1;
        const api = carouselControllerRef.current;
        if (!isPhotoPost || !api) return null;
        const s = api.getState();
        return { isPhotoPost: true, index: s.index, total: s.total };
      },
      goToFirstImagePost: () => {
        const total = controller.repo.totalLoaded;
        for (let i = 0; i < total; i++) {
          const p = controller.repo.get(i);
          if (p && p.primaryMedia.type === "photo" && mediaItemsLen(p) > 1) {
            const diff = i - controller.activeAbsoluteIndex;
            if (diff > 0) for (let j = 0; j < diff; j++) controller.goForward();
            else if (diff < 0) for (let j = 0; j < -diff; j++) controller.goBackward();
            return;
          }
        }
      },
    };
    return () => {
      delete window.tiktokGramFeed;
    };
  }, [controller]);

  // ─── Render ───────────────────────────────────────────────────────────────
  const slotPosts = useMemo<[FeedPost | null, FeedPost | null, FeedPost | null]>(
    () =>
      [0, 1, 2].map((i) =>
        controller.repo.get(slotInfo.absoluteIndices[i] ?? -1),
      ) as [FeedPost | null, FeedPost | null, FeedPost | null],
    [controller, slotInfo.absoluteIndices],
  );

  // Active absolute index, derived reactively from slotInfo
  const activeAbsoluteIndex = Math.max(
    0,
    slotInfo.absoluteIndices[slotInfo.activeSlot] ?? 0,
  );

  if (visiblePosts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-sm text-zinc-400">
        <p>{t("feed.swiper.contentPreparing")}</p>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* touch-action:none disables browser scroll so we own all pointer events */}
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          overflow: "hidden",
          touchAction: "none",
        }}
      >
        {([0, 1, 2] as const).map((i) => (
          <div
            key={SLOT_KEYS[i]}
            ref={(el) => {
              slotDomRefs.current[i] = el;
            }}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              willChange: "transform",
            }}
          >
            {slotPosts[i] !== null && (
              <FeedCard
                post={slotPosts[i]!}
                isActive={i === slotInfo.activeSlot}
                mountMedia={true}
                muted={muted}
                overlayVisible={overlayVisible}
                onToggleMute={toggleMuted}
                onToggleOverlay={toggleOverlay}
                onSetHorizontalConsumer={
                  i === slotInfo.activeSlot
                    ? (consumer) => controller.setHorizontalConsumer(consumer)
                    : undefined
                }
                onRegisterController={
                  i === slotInfo.activeSlot
                    ? handleRegisterController
                    : undefined
                }
                onChannelHidden={() => controller.goForward()}
              />
            )}
          </div>
        ))}
      </div>


      {blockToast && (
        <div className="pointer-events-none absolute inset-x-0 bottom-32 z-50 flex justify-center animate-in fade-in duration-150">
          <div className="rounded-full bg-black/75 px-5 py-2.5 text-sm font-medium text-white backdrop-blur-sm">
            {t(BLOCK_MESSAGE_KEYS[blockToast])}
          </div>
        </div>
      )}

      {showDevNav && (
        <div className="pointer-events-none absolute inset-x-0 top-28 z-40 flex justify-center">
          <span
            className="rounded-full bg-black/70 px-3 py-1 text-xs text-zinc-300"
            aria-label={`Позиція ${activeAbsoluteIndex + 1} з ${controller.repo.totalLoaded}`}
          >
            {activeAbsoluteIndex + 1} / {controller.repo.totalLoaded}
          </span>
        </div>
      )}
      {showDevNav && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-40 flex justify-center gap-2 px-4">
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-zinc-600 bg-black/80 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm active:scale-95"
            onClick={() => controller.goBackward()}
            aria-label="Попередній пост"
          >
            ↑ Попередній
          </button>
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-white/30 bg-white px-5 py-2 text-sm font-semibold text-black active:scale-95"
            onClick={() => controller.goForward()}
            aria-label="Наступний пост"
          >
            ↓ Наступний
          </button>
        </div>
      )}
      {showDevNav && (
        <div className="pointer-events-none absolute inset-x-0 bottom-10 z-40 flex flex-col items-center gap-1.5 px-4">
          {carouselState !== null && (
            <>
              <span className="rounded-full bg-black/70 px-3 py-1 text-xs text-amber-300">
                кадр {carouselState.index + 1}/{carouselState.total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="pointer-events-auto rounded-full border border-zinc-600 bg-black/80 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm active:scale-95"
                  onClick={() => {
                    carouselControllerRef.current?.prev();
                    const api = carouselControllerRef.current;
                    if (api) setCarouselState({ ...api.getState() });
                  }}
                  aria-label="Попереднє фото"
                >
                  ◀ фото
                </button>
                <button
                  type="button"
                  className="pointer-events-auto rounded-full border border-zinc-600 bg-black/80 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm active:scale-95"
                  onClick={() => {
                    carouselControllerRef.current?.next();
                    const api = carouselControllerRef.current;
                    if (api) setCarouselState({ ...api.getState() });
                  }}
                  aria-label="Наступне фото"
                >
                  фото ▶
                </button>
              </div>
            </>
          )}
          <button
            type="button"
            className="pointer-events-auto rounded-full border border-zinc-600 bg-black/80 px-4 py-1.5 text-xs font-medium text-white backdrop-blur-sm active:scale-95"
            onClick={() => window.tiktokGramFeed?.goToFirstImagePost()}
            aria-label="До першого фото-поста"
          >
            ➡ до фото-поста
          </button>
        </div>
      )}
    </div>
  );
}
