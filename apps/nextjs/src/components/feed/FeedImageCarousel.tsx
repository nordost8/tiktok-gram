"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { HorizontalConsumer } from "./engine/FeedController";
import { AnimationDriver } from "./engine/AnimationDriver";
import { FEED_INFO_INSET_PX } from "./feed-utils";
import { coerceFeedMediaUrl } from "~/lib/media/feed-media-url";
import { PhotoZoomLightbox, usePhotoTapHandler } from "./PhotoZoomLightbox";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Shape of a single photo album item as returned by the feed API. */
export interface CarouselMediaItem {
  id: string;
  type: "photo" | "video" | "animation";
  url: string;
  width: number | null;
  height: number | null;
  mimeType: string | null;
}

export interface CarouselController {
  next(): void;
  prev(): void;
  getState(): { index: number; total: number };
}

/** Music-enrichment hook — see services/music-enrichment/ (stubbed by
 *  default). Sound attached to a photo post (see map-post.ts). */
export interface CarouselAudio {
  url: string;
  title: string | null;
  author: string | null;
}

interface FeedImageCarouselProps {
  items: CarouselMediaItem[];
  isActive: boolean;
  paused: boolean;
  /** Global feed mute state — the track honours the same toggle as video. */
  muted: boolean;
  /** TikTok sound for this post; absent → no audio (e.g. video posts). */
  audio?: CarouselAudio;
  /** Tap (no drag) anywhere on the photo → toggle the caption overlay, like video. */
  onTap?: () => void;
  onSetHorizontalConsumer?: (consumer: HorizontalConsumer | null) => void;
  onRegisterController?: (api: CarouselController) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AUTO_ADVANCE_MS = 5000;
/** Commit a slide change once dragged past this fraction of the viewport width… */
const COMMIT_DISTANCE_RATIO = 0.2;
/** …or flicked faster than this (px/ms), mirroring the vertical swipe feel. */
const SWIPE_VELOCITY_THRESHOLD = 0.3;
/** Slide animation timings — matched to the vertical feed swiper for a uniform feel. */
const SLIDE_DURATION_MS = 280;
const SNAP_BACK_DURATION_MS = 240;
/** Drag resistance applied past the first / last slide (no wrap-around). */
const EDGE_RESISTANCE = 0.28;
const MAX_IMAGE_REFRESH_ATTEMPTS = 2;
/**
 * Black band reserved at the bottom of the frame so the dots, the track ticker
 * and the caption NEVER overlap the photo — TikTok-style. Shared with video so
 * photo and video posts letterbox identically.
 */
const BOTTOM_INSET_PX = FEED_INFO_INSET_PX;

// Roughly constant scroll speed (px/s) for the marquee, so a long title
// doesn't feel rushed and a short one doesn't crawl.
const MARQUEE_PX_PER_SECOND = 40;
const MARQUEE_MIN_DURATION_S = 6;

/**
 * Track-title ticker for the music note badge. Most titles fit and just
 * truncate; only when the text is genuinely wider than its slot does it
 * switch to a slow, looping horizontal scroll so a narrow screen can still
 * reveal the full title over time.
 */
function AudioTicker({ text }: { text: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [marquee, setMarquee] = useState<{ on: boolean; durationS: number }>({
    on: false,
    durationS: MARQUEE_MIN_DURATION_S,
  });

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const textWidth = measure.scrollWidth;
    const on = textWidth > container.clientWidth;
    setMarquee({
      on,
      durationS: Math.max(MARQUEE_MIN_DURATION_S, textWidth / MARQUEE_PX_PER_SECOND),
    });
  }, [text]);

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1 overflow-hidden">
      {/* Invisible probe (same text/font) used only to measure natural width. */}
      <span ref={measureRef} className="invisible absolute whitespace-nowrap">
        {text}
      </span>
      {marquee.on ? (
        <div
          className="animate-marquee flex w-max gap-12 whitespace-nowrap drop-shadow"
          style={{ animationDuration: `${marquee.durationS}s` }}
        >
          <span>{text}</span>
          <span aria-hidden>{text}</span>
        </div>
      ) : (
        <span className="block truncate drop-shadow">{text}</span>
      )}
    </div>
  );
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

/**
 * A single full-frame slide: a contained photo on pure black (TikTok style).
 * `reserveBottom` keeps the image clear of the dot/caption band.
 */
function CarouselCell({
  item,
  reserveBottom,
}: {
  item: CarouselMediaItem;
  reserveBottom: boolean;
}) {
  const { t } = useTranslation();
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = coerceFeedMediaUrl(item.id, refreshAttempt);

  return (
    <div
      className="absolute inset-0"
      style={{ paddingBottom: reserveBottom ? BOTTOM_INSET_PX : 0 }}
    >
      {failed ? (
        <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-zinc-400">
          {t("feed.media.unavailable.generic")}
        </div>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
          onError={() => {
            if (refreshAttempt < MAX_IMAGE_REFRESH_ATTEMPTS) {
              setRefreshAttempt((n) => n + 1);
            } else {
              setFailed(true);
            }
          }}
        />
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FeedImageCarousel({
  items,
  isActive,
  paused,
  muted,
  audio,
  onTap,
  onSetHorizontalConsumer,
  onRegisterController,
}: FeedImageCarouselProps) {
  const { t } = useTranslation();
  const total = items.length;
  const isAlbum = total > 1;
  const [index, setIndex] = useState(0);
  const [singleRefresh, setSingleRefresh] = useState(0);
  const [singleFailed, setSingleFailed] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomSrc, setZoomSrc] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Refs to avoid stale closures inside gesture callbacks
  const indexRef = useRef(0);
  const totalRef = useRef(total);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

  // DOM + drag state (not React state — changes every frame)
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const widthRef = useRef(0);
  const offsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  // One rAF animation driver per carousel; lazy init keeps it stable across renders.
  const [driver] = useState(() => new AnimationDriver());

  // Auto-advance timer
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Helpers ───────────────────────────────────────────────────────────────

  // Clamp to [0, total-1] — the album has hard ends, no wrap-around.
  const goTo = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(total - 1, nextIndex));
      indexRef.current = clamped;
      setIndex(clamped);
    },
    [total],
  );

  const next = useCallback(() => goTo(indexRef.current + 1), [goTo]);
  const prev = useCallback(() => goTo(indexRef.current - 1), [goTo]);

  // Translate the strip directly (no React setState on every frame).
  const applyOffset = useCallback((px: number) => {
    offsetRef.current = px;
    const el = stripRef.current;
    if (el) el.style.transform = `translateX(${px}px)`;
  }, []);

  const measureWidth = useCallback((): number => {
    const w = widthRef.current;
    return w > 0 ? w : (containerRef.current?.clientWidth ?? 0);
  }, []);

  /** rAF slide from the current offset to `to`, then run `onDone`. */
  const animateTo = useCallback(
    (to: number, durationMs: number, onDone: () => void) => {
      driver.animate({
        from: offsetRef.current,
        to,
        duration: durationMs,
        onFrame: (v) => applyOffset(v),
        onComplete: onDone,
      });
    },
    [driver, applyOffset],
  );

  // After a commit, the strip is parked at ±width showing the new neighbour as
  // the centre cell. Re-render swaps that neighbour into the centre slot, so we
  // snap the strip back to 0 before paint — seamless, no flash.
  useLayoutEffect(() => {
    driver.cancel();
    applyOffset(0);
  }, [index, driver, applyOffset]);

  // ─── Auto-advance ──────────────────────────────────────────────────────────

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    // Stop at the last slide — the album doesn't loop.
    if (!isActive || paused || !isAlbum || indexRef.current >= total - 1) return;
    timerRef.current = setTimeout(() => {
      const w = measureWidth();
      if (w <= 0) {
        next();
        return;
      }
      animateTo(-w, SLIDE_DURATION_MS, () => goTo(indexRef.current + 1));
    }, AUTO_ADVANCE_MS);
  }, [isActive, paused, isAlbum, total, clearTimer, measureWidth, animateTo, goTo, next]);

  // Reset timer when index changes or active/paused state changes
  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, index, clearTimer]);

  // ─── Register imperative API (dev / e2e navigation; instant, no animation) ──

  useEffect(() => {
    if (!onRegisterController) return;
    onRegisterController({
      next,
      prev,
      getState: () => ({ index: indexRef.current, total: totalRef.current }),
    });
  }, [next, prev, onRegisterController]);

  // ─── Horizontal consumer (gesture routing) ─────────────────────────────────

  useEffect(() => {
    // A single image has nothing to page through — don't claim horizontal
    // gestures (leave them to vertical feed navigation / no-op).
    if (!onSetHorizontalConsumer || !isAlbum) return;

    const consumer: HorizontalConsumer = {
      onStart: () => {
        isDraggingRef.current = true;
        driver.cancel();
        clearTimer();
      },
      onMove: (deltaX: number) => {
        if (!isDraggingRef.current) return;
        const atStart = indexRef.current <= 0;
        const atEnd = indexRef.current >= totalRef.current - 1;
        // Rubber-band when dragging past the first/last slide.
        let d = deltaX;
        if ((d > 0 && atStart) || (d < 0 && atEnd)) d *= EDGE_RESISTANCE;
        applyOffset(d);
      },
      onEnd: (deltaX: number, velocityX: number) => {
        isDraggingRef.current = false;
        const w = measureWidth();
        if (w <= 0) {
          animateTo(0, SNAP_BACK_DURATION_MS, startTimer);
          return;
        }

        const atStart = indexRef.current <= 0;
        const atEnd = indexRef.current >= totalRef.current - 1;
        const commit =
          Math.abs(deltaX) > w * COMMIT_DISTANCE_RATIO ||
          Math.abs(velocityX) > SWIPE_VELOCITY_THRESHOLD;

        if (commit && deltaX < 0 && !atEnd) {
          animateTo(-w, SLIDE_DURATION_MS, () => goTo(indexRef.current + 1));
        } else if (commit && deltaX > 0 && !atStart) {
          animateTo(w, SLIDE_DURATION_MS, () => goTo(indexRef.current - 1));
        } else {
          // Snap back (includes the blocked at-edge case).
          animateTo(0, SNAP_BACK_DURATION_MS, startTimer);
        }
      },
    };

    onSetHorizontalConsumer(consumer);

    return () => {
      onSetHorizontalConsumer(null);
    };
  }, [
    onSetHorizontalConsumer,
    isAlbum,
    driver,
    applyOffset,
    animateTo,
    measureWidth,
    goTo,
    startTimer,
    clearTimer,
  ]);

  // ─── Measure viewport width (drives px-based slide animation) ───────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) widthRef.current = w;
    });
    ro.observe(el);
    widthRef.current = el.clientWidth;
    return () => ro.disconnect();
  }, []);

  // Reset to frame 0 when this card becomes active
  useEffect(() => {
    if (isActive) goTo(0);
  }, [isActive, goTo]);

  // Reset single-image retry state when the slide changes.
  useEffect(() => {
    setSingleRefresh(0);
    setSingleFailed(false);
  }, [items[index]?.id]);

  // ─── TikTok sound playback ──────────────────────────────────────────────────
  // Play + loop while this post is the active, non-paused slide; pause when it
  // scrolls away. Honours the global mute toggle (same control as video).

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !audio) return;
    const shouldPlay = isActive && !paused;
    if (shouldPlay) {
      el.muted = muted;
      void el.play().catch(() => undefined);
    } else {
      el.pause();
      // Restart from the top next time this post becomes active.
      el.currentTime = 0;
    }
  }, [isActive, paused, audio, muted]);

  const currItem = items[index];

  const openZoom = useCallback(
    (item: CarouselMediaItem, refreshAttempt = 0) => {
      setZoomSrc(coerceFeedMediaUrl(item.id, refreshAttempt));
      setZoomOpen(true);
    },
    [],
  );

  const handlePhotoTap = usePhotoTapHandler(
    onTap,
    () => {
      if (currItem) openZoom(currItem, isAlbum ? 0 : singleRefresh);
    },
  );

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!currItem) return null;

  // Audio element is shared across both render paths (single photo with sound).
  const audioEl = audio ? (
    <>
      <audio
        ref={audioRef}
        src={audio.url}
        loop
        muted={muted}
        preload="auto"
        playsInline
        className="hidden"
      />
      {audio.title || audio.author ? (
        <div className="pointer-events-none absolute bottom-[72px] left-4 right-20 z-20 flex items-center gap-1.5 text-xs text-zinc-300">
          {/* Generated music-note glyph, tinted to the (grey) text colour via mask. */}
          <span
            className="h-4 w-4 shrink-0 bg-current"
            style={{
              maskImage: "url(/ui/music-note.png)",
              WebkitMaskImage: "url(/ui/music-note.png)",
              maskSize: "contain",
              WebkitMaskSize: "contain",
              maskRepeat: "no-repeat",
              WebkitMaskRepeat: "no-repeat",
              maskPosition: "center",
              WebkitMaskPosition: "center",
            }}
            aria-hidden
          />
          <AudioTicker text={[audio.title, audio.author].filter(Boolean).join(" — ")} />
        </div>
      ) : null}
    </>
  ) : null;

  // ── Single image → static, no carousel chrome (no strip, dots, or paging) ───
  const singleSrc = coerceFeedMediaUrl(currItem.id, singleRefresh);

  if (!isAlbum) {
    return (
      <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-black">
        {/* Letterbox above the info band so the track ticker / caption stay clear. */}
        <div className="absolute inset-x-0 top-0" style={{ bottom: FEED_INFO_INSET_PX }}>
          {singleFailed ? (
            <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-zinc-400">
              {t("feed.media.unavailable.generic")}
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={singleSrc}
              alt=""
              className="absolute inset-0 h-full w-full object-contain"
              draggable={false}
              onError={() => {
                if (singleRefresh < MAX_IMAGE_REFRESH_ATTEMPTS) {
                  setSingleRefresh((n) => n + 1);
                } else {
                  setSingleFailed(true);
                }
              }}
            />
          )}
        </div>
        {onTap ? (
          <button
            type="button"
            className="absolute inset-0 z-[15] cursor-pointer border-0 bg-transparent p-0"
            aria-label={t("feed.imageCarousel.showCaptionOrZoomAria")}
            onClick={handlePhotoTap}
          />
        ) : null}
        {audioEl}
        <PhotoZoomLightbox
          src={zoomSrc}
          open={zoomOpen}
          onClose={() => setZoomOpen(false)}
        />
      </div>
    );
  }

  const prevItem = index > 0 ? items[index - 1] : undefined;
  const nextItem = index < total - 1 ? items[index + 1] : undefined;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden bg-black">
      {/* Three-cell strip: prev | current | next, translated as one during drag.
          Off-end neighbours are omitted so edges show black (no wrap-around). */}
      <div ref={stripRef} className="absolute inset-0" style={{ willChange: "transform" }}>
        {prevItem ? (
          <div className="absolute inset-0" style={{ transform: "translateX(-100%)" }}>
            <CarouselCell item={prevItem} reserveBottom />
          </div>
        ) : null}
        <div className="absolute inset-0">
          <CarouselCell item={currItem} reserveBottom />
        </div>
        {nextItem ? (
          <div className="absolute inset-0" style={{ transform: "translateX(100%)" }}>
            <CarouselCell item={nextItem} reserveBottom />
          </div>
        ) : null}
      </div>

      {/* Tap (no drag) anywhere → toggle caption overlay, matching video posts.
          A real swipe moves the pointer enough that the browser suppresses this
          click, so it never fires mid-gesture. */}
      {onTap ? (
        <button
          type="button"
          className="absolute inset-0 z-[15] cursor-pointer border-0 bg-transparent p-0"
          aria-label={t("feed.imageCarousel.showCaptionOrZoomAria")}
          onClick={handlePhotoTap}
        />
      ) : null}

      {/* Dot indicator — sits in the reserved black band, never over the photo. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-[100px] z-20 flex justify-center gap-1.5">
        {items.map((item, i) => (
          <span
            key={item.id}
            className="h-1.5 rounded-full transition-all duration-200"
            style={{
              width: i === index ? 7 : 6,
              height: i === index ? 7 : 6,
              backgroundColor:
                i === index ? "rgba(255,255,255,0.98)" : "rgba(255,255,255,0.38)",
            }}
          />
        ))}
      </div>

      {audioEl}
      <PhotoZoomLightbox
        src={zoomSrc}
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
      />
    </div>
  );
}
