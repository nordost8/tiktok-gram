"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { IconChannels, IconHome, IconProfile } from "~/components/icons/FeedUiIcons";
import { StickerIcon } from "~/components/icons/StickerIcon";
import { useFeedStyle } from "~/components/style/FeedStyleContext";

import type { MainTab } from "./types";

interface BottomNavProps {
  active: MainTab;
  onChange: (tab: MainTab) => void;
}

// Module scope can't call the useTranslation hook, so this stores i18n KEYS
// (see `navigation` in lib/i18n/messages/*.json) — translated with `t()` at
// the render site, same pattern as VerticalFeedSwiper's BLOCK_MESSAGE_KEYS.
const tabs: {
  id: MainTab;
  labelKey: string;
  sticker: string;
  Icon: typeof IconHome;
}[] = [
  { id: "feed", labelKey: "navigation.home", sticker: "nav-home", Icon: IconHome },
  { id: "channels", labelKey: "navigation.channels", sticker: "nav-channels", Icon: IconChannels },
  { id: "profile", labelKey: "navigation.profile", sticker: "nav-profile", Icon: IconProfile },
];

export function BottomNav({ active, onChange }: BottomNavProps) {
  const { t } = useTranslation();
  const { style } = useFeedStyle();
  const pop = style === "pop";
  return (
    <nav className="z-40 shrink-0 border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md">
      <div className="flex items-stretch">
        {tabs.map((tab) => {
          const isActive = active === tab.id;
          const TabIcon = tab.Icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={cn(
                "flex flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors",
                isActive ? "text-white" : "text-zinc-500",
              )}
            >
              <span
                className={cn(
                  "flex items-center justify-center rounded-2xl transition-all",
                  pop ? "h-9 w-9" : "h-8 w-8",
                  isActive && (pop ? "scale-110 bg-white/[0.06]" : "scale-110 bg-zinc-800"),
                )}
              >
                {pop ? (
                  <StickerIcon
                    name={tab.sticker}
                    size={26}
                    dim={!isActive}
                    fallback={
                      <TabIcon
                        size={22}
                        className={isActive ? "text-white" : "text-zinc-500"}
                      />
                    }
                  />
                ) : (
                  <TabIcon
                    size={22}
                    className={isActive ? "text-white" : "text-zinc-500"}
                  />
                )}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium tracking-wide",
                  isActive ? "text-white" : "text-zinc-500",
                )}
              >
                {t(tab.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
      <div className="h-safe-area-inset-bottom" />
    </nav>
  );
}
