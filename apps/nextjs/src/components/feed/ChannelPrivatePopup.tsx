"use client";

import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { ChannelAvatar } from "./ChannelAvatar";
import type { FeedPost } from "./types";
import {
  Popup,
  PopupClose,
  PopupContent,
  PopupDescription,
  PopupTitle,
  useTelegramBackButton,
} from "~/components/ui/Popup";

interface ChannelPrivatePopupProps {
  channel: FeedPost["channel"];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChannelPrivatePopup({
  channel,
  open,
  onOpenChange,
}: ChannelPrivatePopupProps) {
  const { t } = useTranslation();
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useTelegramBackButton(open, close);

  return (
    <Popup open={open} onOpenChange={onOpenChange}>
      <PopupContent variant="center">
        <div className="relative pr-6">
          <PopupClose asChild>
            <button
              type="button"
              aria-label={t("common.close")}
              className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center text-zinc-400 active:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </PopupClose>

          <PopupTitle>{t("feed.channelPrivate.title")}</PopupTitle>

          <div className="mt-3 flex items-center gap-3">
            <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-zinc-800">
              <ChannelAvatar
                channelId={channel.id}
                title={channel.title}
                className="h-full w-full object-cover"
              />
            </div>
            <p className="min-w-0 truncate font-medium text-white">{channel.title}</p>
          </div>

          <PopupDescription className="mt-3">
            {t("feed.channelPrivate.description")}
          </PopupDescription>

          <p className="mt-4 text-sm text-zinc-400">
            {t("feed.channelPrivate.searchHint")}
          </p>
        </div>
      </PopupContent>
    </Popup>
  );
}
