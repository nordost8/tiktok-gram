"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import {
  IconHeart,
  IconMore,
  IconShare,
  IconVolumeOff,
  IconVolumeOn,
} from "~/components/icons/FeedUiIcons";
import { StickerIcon } from "~/components/icons/StickerIcon";
import { useFeedStyle } from "~/components/style/FeedStyleContext";
import { hapticImpact } from "~/lib/telegram/haptic";
interface FeedActionRailProps {
  liked: boolean;
  muted: boolean;
  showSound: boolean;
  onLike: () => void;
  onShare: () => void;
  onMore: () => void;
  onToggleMute: () => void;
}

function ActionButton({
  label,
  active,
  onClick,
  ariaLabel,
  children,
}: {
  label?: string;
  active?: boolean;
  onClick: () => void;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel ?? label}
      className="flex flex-col items-center gap-1 text-white"
    >
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur transition-transform active:scale-90",
          active && "scale-105",
        )}
      >
        {children}
      </span>
      {label ? (
        <span className="text-[10px] text-zinc-200">{label}</span>
      ) : null}
    </button>
  );
}

export function FeedActionRail({
  liked,
  muted,
  showSound,
  onLike,
  onShare,
  onMore,
  onToggleMute,
}: FeedActionRailProps) {
  const { t } = useTranslation();
  const { style } = useFeedStyle();
  const pop = style === "pop";
  return (
    <div className="absolute right-3 bottom-[132px] z-30 flex flex-col gap-4">
      {showSound ? (
        <ActionButton
          label={muted ? t("feed.actionRail.soundOnLabel") : t("feed.actionRail.soundLabel")}
          active={!muted}
          onClick={() => {
            hapticImpact("light");
            onToggleMute();
          }}
          ariaLabel={muted ? t("feed.actionRail.unmuteAria") : t("feed.actionRail.muteAria")}
        >
          {muted ? (
            pop ? (
              <StickerIcon
                name="sound-off"
                size={30}
                fallback={<IconVolumeOff size={26} className="text-zinc-300" />}
              />
            ) : (
              <IconVolumeOff size={26} className="text-zinc-300" />
            )
          ) : pop ? (
            <StickerIcon
              name="sound-on"
              size={30}
              fallback={<IconVolumeOn size={26} className="text-white" />}
            />
          ) : (
            <IconVolumeOn size={26} className="text-white" />
          )}
        </ActionButton>
      ) : null}
      <ActionButton
        active={liked}
        onClick={onLike}
        ariaLabel={liked ? t("feed.actionRail.unlikeAria") : t("feed.actionRail.likeAria")}
      >
        {pop && liked ? (
          // Liked: the filled Pop-Kiosk sticker. Un-liked uses a clean outline heart
          // (empty interior) instead of a flat filled sprite.
          <StickerIcon
            name="heart-liked"
            size={30}
            fallback={<IconHeart size={26} filled className="text-rose-500" />}
          />
        ) : (
          <IconHeart
            size={26}
            filled={liked}
            className={liked ? "text-rose-500" : "text-white"}
          />
        )}
      </ActionButton>
      <ActionButton label={t("feed.actionRail.shareLabel")} onClick={onShare} ariaLabel={t("feed.actions.share")}>
        {pop ? (
          <StickerIcon
            name="share"
            size={28}
            fallback={<IconShare size={24} className="text-white" />}
          />
        ) : (
          <IconShare size={24} className="text-white" />
        )}
      </ActionButton>
      <ActionButton label={t("feed.actionRail.moreLabel")} onClick={onMore} ariaLabel={t("feed.actionRail.moreAria")}>
        {pop ? (
          <StickerIcon
            name="more"
            size={26}
            fallback={<IconMore size={24} className="text-white" />}
          />
        ) : (
          <IconMore size={24} className="text-white" />
        )}
      </ActionButton>
    </div>
  );
}
