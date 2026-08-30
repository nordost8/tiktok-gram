"use client";

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import { ChannelAvatar } from "./ChannelAvatar";
import { RelativeTime } from "./RelativeTime";
import {
  formatCount,
  postCaption,
  postHasTranslation,
  postOriginalCaption,
} from "./feed-utils";
import type { FeedPost } from "./types";
import { Popup, PopupContent, useTelegramBackButton } from "~/components/ui/Popup";

interface PostBottomSheetProps {
  post: FeedPost | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTelegram: () => void;
  onShare: () => void;
}

export function PostBottomSheet({
  post,
  open,
  onOpenChange,
  onOpenTelegram,
  onShare,
}: PostBottomSheetProps) {
  const { t } = useTranslation();
  const closeSheet = useCallback(() => onOpenChange(false), [onOpenChange]);
  useTelegramBackButton(open, closeSheet);
  const [showOriginal, setShowOriginal] = useState(false);
  if (!post) return null;
  const hasTranslation = postHasTranslation(post);
  const text = (
    showOriginal && hasTranslation ? postOriginalCaption(post) : postCaption(post)
  );

  return (
    <Popup open={open} onOpenChange={onOpenChange}>
      <PopupContent variant="sheet">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-sm">
            <ChannelAvatar
              channelId={post.channel.id}
              title={post.channel.title}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="font-semibold">{post.channel.title}</p>
            {post.channel.username ? (
              <p className="text-sm text-zinc-400">@{post.channel.username}</p>
            ) : null}
            <p className="text-xs text-zinc-500">
              <RelativeTime iso={post.publishedAt} /> ·{" "}
              {t("feed.postSheet.views", {
                count: post.stats.views,
                formatted: formatCount(post.stats.views),
              })}
            </p>
          </div>
        </div>
        <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">
          {text || t("feed.postSheet.noText")}
        </p>
        {hasTranslation ? (
          <p className="mt-2 text-xs text-zinc-500">
            {showOriginal ? (
              <button type="button" onClick={() => setShowOriginal(false)} className="underline">
                {t("feed.translation.translated")}
              </button>
            ) : (
              <>
                {t("feed.translation.autoTranslated")}{" "}
                <button type="button" onClick={() => setShowOriginal(true)} className="underline">
                  {t("feed.translation.original")}
                </button>
              </>
            )}
          </p>
        ) : null}
        <div className="mt-6 grid grid-cols-1 gap-2">
          <button
            type="button"
            onClick={onOpenTelegram}
            className="rounded-xl bg-zinc-800 px-4 py-3 text-sm font-medium"
          >
            {t("feed.actions.openInTelegram")}
          </button>
          <button
            type="button"
            onClick={onShare}
            className="rounded-xl border border-zinc-700 px-4 py-3 text-sm"
          >
            {t("feed.actions.share")}
          </button>
        </div>
      </PopupContent>
    </Popup>
  );
}
