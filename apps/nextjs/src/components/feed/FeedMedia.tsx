"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import type { FeedPost } from "./types";
import type { HorizontalConsumer } from "./engine/FeedController";
import type {
  CarouselController,
  CarouselMediaItem,
} from "./FeedImageCarousel";
import {
  isMediaCaching,
  isMediaPolicyBlocked,
  mediaLoadingHint,
  mediaUnavailableMessage,
} from "./feed-media-state";
import {
  coerceFeedMediaUrl,
  feedMediaApiPath,
  feedPostAudioApiUrl,
  toClientMediaUrl,
} from "~/lib/media/feed-media-url";
import {
  classifyMediaSrc,
  reportMediaEvent,
} from "~/lib/media/media-telemetry";
import { FEED_INFO_INSET_PX } from "./feed-utils";
import { FeedImageCarousel } from "./FeedImageCarousel";

/**
 * Extended FeedPost shape that includes the optional mediaItems array
 * from the Step-B server change. The TypeScript type of FeedPost doesn't yet
 * reflect the conditional spread in mapPostToDto, so we widen locally.
 */
type FeedPostWithAlbum = FeedPost & { mediaItems?: CarouselMediaItem[] };

interface FeedMediaProps {
  post: FeedPostWithAlbum;
  isActive: boolean;
  mountMedia: boolean;
  muted: boolean;
  pausedBySheet: boolean;
  onToggleInfo: () => void;
  onSetHorizontalConsumer?: (consumer: HorizontalConsumer | null) => void;
  onRegisterController?: (api: CarouselController) => void;
}

/**
 * Tunable thresholds for "media is taking a while" UX feedback. We avoid a
 * full-screen overlay on every video (it makes the feed feel slow even when
 * playback would start in under 100ms) and only show a small corner spinner
 * after the user could realistically notice the delay.
 */
/**
 * Below this width/height ratio a clip is treated as extreme portrait (taller
 * than ~1:2.9 — stitched screenshots, not filmed video) and is letterboxed
 * rather than cropped. Everything above it fills the width. Normal vertical
 * video sits far above: 9:16 is 0.563 and Telegram's 464x848 is 0.547.
 */
const EXTREME_PORTRAIT_ASPECT = 0.34;

/** Human-readable HTMLMediaElement.error codes (MediaError.code is 1-4). */
const MEDIA_ERROR_NAMES: Record<number, string> = {
  1: "aborted",
  2: "network",
  3: "decode",
  4: "src_not_supported",
};

const SLOW_THRESHOLD_NORMAL_MS = 1200;
const SLOW_THRESHOLD_CACHING_MS = 4000;
const CENTER_TAP_ZONE_RATIO = 0.42;

async function probeMediaPending(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
    });
    if (res.status !== 503) return false;
    const json = (await res.json()) as { status?: string };
    return json.status === "pending";
  } catch {
    return false;
  }
}

/**
 * Full-screen overlay for the case where the source file is genuinely not in
 * object storage yet — the user has no way to see content, so we explain why.
 */
function CachingOverlay({ hint }: { hint: string | null }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-zinc-950/80 px-6 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-600 border-t-white" />
      {hint ? <p className="text-sm text-zinc-400">{hint}</p> : null}
    </div>
  );
}

/**
 * Lightweight "still loading" indicator shown only after the slow threshold —
 * doesn't obscure the poster image or the surrounding UI.
 */
function CornerSpinner({ hint }: { hint: string | null }) {
  return (
    <div className="pointer-events-none absolute bottom-24 left-4 z-30 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-zinc-200 backdrop-blur-sm">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-white" />
      {hint ? <span>{hint}</span> : null}
    </div>
  );
}

function MediaFrame({
  className,
  style,
  children,
}: {
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn("absolute inset-0 overflow-hidden bg-black", className)}
      style={style}
    >
      {children}
    </div>
  );
}

export function FeedMedia({
  post,
  isActive,
  mountMedia,
  muted,
  pausedBySheet,
  onToggleInfo,
  onSetHorizontalConsumer,
  onRegisterController,
}: FeedMediaProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const wasActiveRef = useRef(false);
  // Dedupe media-outcome telemetry per post — but track the two outcomes
  // SEPARATELY. A single flag would let a successful "shown" swallow a later
  // "error", so a video that starts playing and then dies mid-playback would
  // never be reported and the failure would be invisible in telemetry.
  const shownReportedRef = useRef(false);
  const errorReportedRef = useRef(false);
  // When the current media slot started loading — used to report load latency.
  const mountedAtRef = useRef<number>(Date.now());
  const [mediaError, setMediaError] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoSlow, setVideoSlow] = useState(false);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [pausedByUser, setPausedByUser] = useState(false);

  const media = post.primaryMedia;
  // Aspect ratio (w/h) of the source, seeded from the DTO to avoid a fit flash
  // and refined from the real <video> metadata once loaded. Drives cover-vs-
  // contain so near-portrait clips fill the frame instead of showing side bars.
  const [naturalAspect, setNaturalAspect] = useState<number | null>(
    media.width && media.height ? media.width / media.height : null,
  );
  // Aspect ratio of the media frame itself (its size depends on viewport +
  // bottom info band), measured from the rendered element.
  const [frameAspect, setFrameAspect] = useState<number | null>(null);
  const cacheStatus = media.cacheStatus ?? null;
  const isPlayableVideo = media.type === "video" || media.type === "animation";
  const caching = isMediaCaching(cacheStatus);
  const policyBlocked = isMediaPolicyBlocked(cacheStatus);
  // Mounted-but-inactive slot (the post directly above/below the active one).
  // Its <video> must preload="auto" so it buffers the real R2 URL ahead of the
  // swipe — that's what makes the next video start instantly.
  const isNeighbor = mountMedia && !isActive;

  // Video plays DIRECTLY from R2 via the server-provided presigned URL — the Pi
  // never proxies the bytes. Photos come back as same-origin /api/media URLs
  // (they live in Postgres) and are absolutized by toClientMediaUrl. There is no
  // proxy fallback for video by design: a failure beacons to /api/media-event
  // (persisted forever) so it can be diagnosed from logs.
  const mediaSrc = toClientMediaUrl(media.url);
  const mediaProbePath = feedMediaApiPath(media.id);

  const posterUrl = isPlayableVideo
    ? (media.thumbnailUrl ?? undefined)
    : undefined;
  const loadingHintKey = mediaLoadingHint(cacheStatus, videoSlow);
  const loadingHint = loadingHintKey ? t(loadingHintKey) : null;
  const effectivePendingOnly = mountMedia && caching && pendingOnly;
  const shouldLoadMedia = mountMedia && !policyBlocked && !effectivePendingOnly;

  // Fill the frame (cropping top/bottom) instead of letterboxing whenever the
  // clip is NARROWER than the frame — that is exactly the case where
  // `object-contain` leaves black bars down the sides, which vertical videos
  // must never show. Landscape / portrait-wider-than-frame clips keep `contain`,
  // since covering those would crop the sides heavily.
  //
  // The lower bound is ABSOLUTE, not relative to the frame. A frame-relative
  // floor made the result depend on the frame's height, which varies with the
  // WebView chrome: the same 464x848 clip (0.547) covered on desktop
  // (frame 0.635) yet fell back to contain inside Telegram on iOS (frame 0.797),
  // so identical content letterboxed on one device and not the other. Only a
  // genuinely extreme aspect (long stitched screenshots and the like) is worth
  // letterboxing, and that is a property of the clip alone.
  const fillCover =
    isPlayableVideo &&
    naturalAspect != null &&
    frameAspect != null &&
    naturalAspect < frameAspect &&
    naturalAspect >= EXTREME_PORTRAIT_ASPECT;
  const mediaFitClass = fillCover ? "object-cover" : "object-contain";

  useEffect(() => {
    if (!mountMedia || !caching) return;

    let cancelled = false;
    void probeMediaPending(mediaProbePath).then((pending) => {
      if (!cancelled) setPendingOnly(pending);
    });

    return () => {
      cancelled = true;
    };
  }, [mountMedia, caching, mediaProbePath, post.id]);

  useEffect(() => {
    if (!shouldLoadMedia || !isPlayableVideo || videoReady || mediaError)
      return;
    const threshold = caching
      ? SLOW_THRESHOLD_CACHING_MS
      : SLOW_THRESHOLD_NORMAL_MS;
    const timer = window.setTimeout(() => setVideoSlow(true), threshold);
    return () => window.clearTimeout(timer);
  }, [
    shouldLoadMedia,
    isPlayableVideo,
    videoReady,
    mediaError,
    caching,
    post.id,
  ]);

  // Reset playback state when VerticalFeedSwiper recycles this slot to another post.
  useEffect(() => {
    shownReportedRef.current = false;
    errorReportedRef.current = false;
    mountedAtRef.current = Date.now();
    setMediaError(false);
    setVideoReady(false);
    setVideoSlow(false);
    setPendingOnly(false);
    setPausedByUser(false);
    setNaturalAspect(media.width && media.height ? media.width / media.height : null);
  }, [post.id, media.width, media.height]);

  // Measure the media frame's aspect ratio (updates on rotation / resize) so the
  // cover-vs-contain decision uses the real rendered box, not an assumption.
  useLayoutEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth && el.clientHeight) {
        setFrameAspect(el.clientWidth / el.clientHeight);
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isPlayableVideo, shouldLoadMedia]);

  // Log a successful media display once the active post's media is ready, so we
  // have a success/failure signal (PostHog `media_shown`; failures also beacon
  // to `/api/media-event` → docker logs).
  useEffect(() => {
    if (!isActive || !videoReady || shownReportedRef.current) return;
    shownReportedRef.current = true;
    reportMediaEvent({
      outcome: "shown",
      postId: post.id,
      mediaId: media.id,
      mediaType: media.type,
      channel: post.channel.title,
      cacheStatus,
      srcKind: classifyMediaSrc(mediaSrc),
      mediaUrl: mediaSrc,
      loadMs: Date.now() - mountedAtRef.current,
    });
  }, [
    isActive,
    videoReady,
    post.id,
    media.id,
    media.type,
    post.channel.title,
    cacheStatus,
    mediaSrc,
  ]);

  // Reset to the beginning whenever this slot becomes the active one.
  // useLayoutEffect so currentTime=0 is applied before the play() call below.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlayableVideo || !shouldLoadMedia) return;
    if (isActive && !wasActiveRef.current) {
      video.currentTime = 0;
      setPausedByUser(false);
    }
    wasActiveRef.current = isActive;
  }, [isActive, isPlayableVideo, shouldLoadMedia]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlayableVideo || !shouldLoadMedia) return;
    const shouldPlay = isActive && !pausedBySheet && !pausedByUser;
    if (shouldPlay) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [
    isActive,
    isPlayableVideo,
    pausedBySheet,
    pausedByUser,
    mediaSrc,
    shouldLoadMedia,
  ]);

  // Runs synchronously before the browser paints on every isActive / paused-state change.
  // • Inactive → pause immediately (no waiting for useEffect / React re-render).
  // • Active   → check readyState so the poster hides at once, then call play()
  //              before paint so the very first rendered frame is already live.
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !isPlayableVideo || !shouldLoadMedia) return;
    if (!isActive || pausedBySheet || pausedByUser) {
      video.pause();
      return;
    }
    if (!videoReady && video.readyState >= 3) setVideoReady(true);
    void video.play().catch(() => undefined);
  }, [isActive, isPlayableVideo, shouldLoadMedia, pausedBySheet, pausedByUser, videoReady]);

  const togglePlayback = () => {
    if (!isPlayableVideo || !shouldLoadMedia) return;
    const video = videoRef.current;
    if (video?.paused) {
      setPausedByUser(false);
      void video.play().catch(() => undefined);
      return;
    }

    video?.pause();
    setPausedByUser(true);
  };

  const handleMediaTap = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const centerWidth = rect.width * CENTER_TAP_ZONE_RATIO;
    const centerHeight = rect.height * CENTER_TAP_ZONE_RATIO;
    const centerLeft = rect.left + (rect.width - centerWidth) / 2;
    const centerTop = rect.top + (rect.height - centerHeight) / 2;
    const inCenter =
      event.clientX >= centerLeft &&
      event.clientX <= centerLeft + centerWidth &&
      event.clientY >= centerTop &&
      event.clientY <= centerTop + centerHeight;

    if (inCenter && isPlayableVideo) {
      togglePlayback();
      return;
    }

    if (isActive && !pausedByUser && videoRef.current?.paused) {
      void videoRef.current.play().catch(() => undefined);
    }
    onToggleInfo();
  };

  const reportOutcome = (
    outcome: "shown" | "error",
    reason?: string,
    extra?: { mediaErrorCode?: number; mediaErrorMessage?: string; afterShown?: boolean },
  ) => {
    const seen = outcome === "shown" ? shownReportedRef : errorReportedRef;
    if (seen.current) return;
    seen.current = true;
    reportMediaEvent({
      outcome,
      postId: post.id,
      mediaId: media.id,
      mediaType: media.type,
      channel: post.channel.title,
      cacheStatus,
      reason,
      srcKind: classifyMediaSrc(mediaSrc),
      mediaUrl: mediaSrc,
      loadMs: Date.now() - mountedAtRef.current,
      ...extra,
    });
  };

  // No proxy fallback by design: video must come directly from R2. On error we
  // show "Media unavailable" and record a permanent, richly-detailed beacon so
  // the exact failure (url, cacheStatus, reason, latency) is diagnosable later.
  //
  // We capture the element's MediaError code because the reason alone is
  // ambiguous: code 4 (src_not_supported) means the browser lacks the codec —
  // e.g. iOS cannot decode AV1 — while code 2 (network) means the bytes never
  // arrived. Those need opposite fixes, and without the code you cannot tell
  // them apart from the beacon.
  const handleMediaError = () => {
    setMediaError(true);
    const code = videoRef.current?.error?.code;
    const codeName = code ? MEDIA_ERROR_NAMES[code] : undefined;
    const base = policyBlocked
      ? "policy_blocked"
      : isPlayableVideo
        ? "video_error"
        : "image_error";
    reportOutcome(
      "error",
      codeName ? `${base}:${codeName}` : base,
      {
        mediaErrorCode: code,
        mediaErrorMessage: videoRef.current?.error?.message || undefined,
        // Distinguishes "never played" from "played, then died mid-playback".
        afterShown: shownReportedRef.current,
      },
    );
  };

  if (!mountMedia) {
    return <MediaFrame className="bg-zinc-950" />;
  }

  if (policyBlocked || mediaError) {
    return (
      <MediaFrame className="flex items-center justify-center bg-zinc-950">
        <p className="px-6 text-center text-sm text-zinc-400">
          {t(mediaUnavailableMessage(cacheStatus))}
        </p>
      </MediaFrame>
    );
  }

  // The source file isn't actually in object storage yet — keep the explicit
  // full-screen overlay so the user understands why nothing is playing.
  if (effectivePendingOnly) {
    return (
      <MediaFrame>
        <CachingOverlay hint={loadingHint ?? t("feed.media.hint.caching")} />
      </MediaFrame>
    );
  }

  // ── Photo carousel (multi-photo album, or any photo post with a sound) ──────
  // A single photo also routes through the carousel when it has a TikTok sound
  // so the audio player + ticker render; the carousel degrades to one slide.
  const mediaItems = post.mediaItems;
  const isPhotoPost = media.type === "photo" && shouldLoadMedia;
  const carouselItems: CarouselMediaItem[] | undefined =
    mediaItems !== undefined && mediaItems.length > 0
      ? mediaItems
      : isPhotoPost
        ? [
            {
              id: media.id,
              type: "photo",
              url: coerceFeedMediaUrl(media.id),
              width: media.width,
              height: media.height,
              mimeType: media.mimeType,
            },
          ]
        : undefined;
  const isPhotoCarousel =
    isPhotoPost &&
    carouselItems !== undefined &&
    (carouselItems.length > 1 || post.audio !== undefined);

  if (isPhotoCarousel) {
    return (
      <MediaFrame>
        <FeedImageCarousel
          items={carouselItems.map((item) => ({
            ...item,
            url: coerceFeedMediaUrl(item.id),
          }))}
          isActive={isActive}
          paused={pausedBySheet}
          muted={muted}
          audio={
            post.audio
              ? { ...post.audio, url: feedPostAudioApiUrl(post.id) }
              : undefined
          }
          onTap={onToggleInfo}
          onSetHorizontalConsumer={onSetHorizontalConsumer}
          onRegisterController={onRegisterController}
        />
      </MediaFrame>
    );
  }

  return (
    <MediaFrame>
      {caching ? (
        <div className="absolute top-20 left-4 z-30 rounded-full bg-black/65 px-3 py-1 text-xs text-zinc-200">
          {t("feed.media.cachingBadge")}
        </div>
      ) : null}

      {/* Media is letterboxed ABOVE the bottom info band (pure black, TikTok
          style), so the caption / track ticker below never overlap the content. */}
      <div className="absolute inset-x-0 top-0" style={{ bottom: FEED_INFO_INSET_PX }}>
        {isPlayableVideo ? (
          <>
            {posterUrl && !videoReady ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterUrl}
                alt=""
                className={cn(
                  "pointer-events-none absolute inset-0 z-[1] h-full w-full",
                  mediaFitClass,
                )}
                draggable={false}
              />
            ) : null}

            <video
              ref={videoRef}
              src={shouldLoadMedia ? mediaSrc : undefined}
              poster={posterUrl}
              className={cn(
                "pointer-events-none absolute inset-0 z-[2] h-full w-full transition-opacity duration-150",
                mediaFitClass,
                posterUrl && !videoReady ? "opacity-0" : "opacity-100",
              )}
              playsInline
              autoPlay={isActive}
              loop
              muted={muted}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) {
                  setNaturalAspect(v.videoWidth / v.videoHeight);
                }
              }}
              // Preload bytes for both the active slide AND its immediate
              // neighbours so the next swipe starts instantly — the active±1
              // window is mounted by VerticalFeedSwiper, so this only loads
              // up to ~2 extra videos at a time. The media element loads the
              // cross-origin R2 URL without needing CORS.
              preload={isActive || isNeighbor ? "auto" : "metadata"}
              onLoadedData={() => setVideoReady(true)}
              onCanPlay={() => setVideoReady(true)}
              onError={handleMediaError}
            />

            {pausedByUser && videoReady ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm">
                  <svg
                    viewBox="0 0 24 24"
                    className="ml-1 h-8 w-8 text-white"
                    fill="currentColor"
                    aria-hidden
                  >
                    <path d="M8 5v14l11-7L8 5z" />
                  </svg>
                </span>
              </div>
            ) : null}
          </>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shouldLoadMedia ? mediaSrc : undefined}
            alt=""
            className="absolute inset-0 z-[1] h-full w-full object-contain"
            onError={handleMediaError}
          />
        )}
      </div>

      {/* Full-frame tap target — toggles caption (and play/pause in the centre
          for video). Covers the media and the info band. */}
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer border-0 bg-transparent p-0"
        aria-label={isPlayableVideo ? t("feed.media.controlVideoAria") : t("feed.media.toggleCaptionAria")}
        onClick={handleMediaTap}
      />

      {/* Non-blocking loading indicator after the slow threshold. */}
      {isPlayableVideo && !videoReady && videoSlow ? (
        <CornerSpinner hint={loadingHint} />
      ) : null}
    </MediaFrame>
  );
}
