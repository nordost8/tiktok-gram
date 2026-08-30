"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { useTRPC } from "~/trpc/react";
import { FeedCard } from "~/components/feed/FeedCard";
import { IconMore } from "~/components/icons/FeedUiIcons";
import { useFeedStyle } from "~/components/style/FeedStyleContext";

interface DeeplinkPostOverlayProps {
  postId: string;
  /** Opened via the "with music" deeplink → start with sound on. */
  withMusic: boolean;
  onClose: () => void;
}

/**
 * Full-screen viewer for a single post opened from a share deeplink
 * (?startapp=post_<id> / postm_<id>). Reuses FeedCard; the music variant starts
 * unmuted so the track plays immediately.
 */
export function DeeplinkPostOverlay({
  postId,
  withMusic,
  onClose,
}: DeeplinkPostOverlayProps) {
  const { t } = useTranslation();
  const trpc = useTRPC();
  const [muted, setMuted] = useState(!withMusic);
  const [overlayVisible, setOverlayVisible] = useState(true);

  const postQuery = useQuery(trpc.feed.byId.queryOptions({ postId }));

  const { style } = useFeedStyle();
  const pop = style === "pop";

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      {/* Top text CTA overlaid on the post (replaces round close button) */}
      <div className="absolute left-0 right-0 top-3 z-[70] flex flex-col items-center px-4 text-center">
        <p className="text-[13px] font-medium text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.8)]">
          {t("feed.deeplink.likedQuestion")}
        </p>
        <button
          type="button"
          onClick={onClose}
          className={cn(
            "mt-px text-sm font-medium underline decoration-1 underline-offset-2 active:opacity-70 transition-opacity",
            pop ? "text-pop-lime" : "text-white/75",
            "drop-shadow-[0_1px_3px_rgba(0,0,0,0.85)]",
          )}
        >
          {t("feed.deeplink.exploreMore")}
        </button>
      </div>

      {postQuery.isLoading ? (
        <div className="flex h-full items-center justify-center">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
        </div>
      ) : postQuery.data ? (
        <FeedCard
          post={postQuery.data}
          isActive
          mountMedia
          muted={muted}
          overlayVisible={overlayVisible}
          onToggleMute={() => setMuted((m) => !m)}
          onToggleOverlay={() => setOverlayVisible((v) => !v)}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
          <IconMore size={28} className="text-zinc-600" />
          <p className="text-sm text-zinc-400">
            {t("feed.deeplink.unavailable")}
          </p>
        </div>
      )}
    </div>
  );
}
