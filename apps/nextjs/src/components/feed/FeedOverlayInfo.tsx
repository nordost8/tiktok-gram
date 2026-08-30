"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import type { FeedPost } from "./types";
import { ClampedText } from "./ClampedText";
import {
  postCaption,
  postHasTranslation,
  postOriginalCaption,
} from "./feed-utils";
import { RelativeTime } from "./RelativeTime";
import { useFeedStyle } from "~/components/style/FeedStyleContext";

interface FeedOverlayInfoProps {
  post: FeedPost;
  subscribed: boolean;
  detailsVisible: boolean;
  onOpenChannel: () => void;
  onReadMore: () => void;
  onSubscribe: () => void;
  onToggleOverlay: () => void;
}

function TranslationAttribution({
  showOriginal,
  onToggle,
  className,
}: {
  showOriginal: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <p className={cn("mt-1 text-[12px] text-white/60", className)}>
      {showOriginal ? (
        <button type="button" onClick={onToggle} className="font-semibold underline">
          {t("feed.translation.translated")}
        </button>
      ) : (
        <>
          {t("feed.translation.autoTranslated")}{" "}
          <button type="button" onClick={onToggle} className="font-semibold underline">
            {t("feed.translation.original")}
          </button>
        </>
      )}
    </p>
  );
}

export function FeedOverlayInfo({
  post,
  subscribed,
  detailsVisible,
  onOpenChannel,
  onSubscribe,
}: FeedOverlayInfoProps) {
  const { t } = useTranslation();
  const { style } = useFeedStyle();
  const hasTranslation = postHasTranslation(post);
  const [showOriginal, setShowOriginal] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const caption = (
    showOriginal && hasTranslation ? postOriginalCaption(post) : postCaption(post)
  ).trim();

  useEffect(() => {
    if (!detailsVisible) {
      setExpanded(false);
      setShowOriginal(false);
    }
  }, [detailsVisible]);

  useEffect(() => {
    setShowOriginal(false);
    setExpanded(false);
  }, [post.id]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 left-0 right-16 z-20 px-4">
      <div
        className={cn(
          "transition-all duration-200 ease-out will-change-[opacity,transform]",
          detailsVisible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0",
        )}
        aria-hidden={!detailsVisible}
      >
        <div
          className={cn(
            "flex items-center gap-2.5",
            detailsVisible ? "pointer-events-auto" : "pointer-events-none",
          )}
        >
          <button
            type="button"
            onClick={onOpenChannel}
            className="min-w-0 truncate text-[15px] font-bold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]"
            aria-label={t("feed.overlayInfo.openChannelAria", { title: post.channel.title })}
          >
            {post.channel.title}
          </button>
          <button
            type="button"
            onClick={onSubscribe}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-[11px] font-bold transition-colors",
              subscribed
                ? "bg-white/15 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.25)]"
                : style === "pop"
                  ? "bg-splash text-white"
                  : "bg-sky-500 text-white",
            )}
            aria-label={
              subscribed
                ? t("feed.overlayInfo.unsubscribeAria", { title: post.channel.title })
                : t("feed.overlayInfo.subscribeAria", { title: post.channel.title })
            }
          >
            {subscribed ? t("feed.overlayInfo.subscribedLabel") : t("feed.overlayInfo.subscribeLabel")}
          </button>
        </div>

        {caption ? (
          expanded ? (
            <div
              className={cn(
                "mt-1.5 max-h-[48vh] overflow-y-auto text-[13px] leading-snug text-white/95 drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]",
                detailsVisible ? "pointer-events-auto" : "pointer-events-none",
              )}
              style={{ touchAction: "pan-y" }}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerMove={(e) => e.stopPropagation()}
            >
              <p className="whitespace-pre-wrap">{caption}</p>
              {hasTranslation ? (
                <TranslationAttribution
                  showOriginal={showOriginal}
                  onToggle={() => setShowOriginal((v) => !v)}
                />
              ) : null}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="mt-1.5 text-[12px] font-semibold text-white/60"
              >
                <RelativeTime iso={post.publishedAt} /> · {t("feed.overlayInfo.collapse")}
              </button>
            </div>
          ) : (
            <div
              className={cn(
                "mt-1.5 w-full text-left",
                detailsVisible ? "pointer-events-auto" : "pointer-events-none",
              )}
            >
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="w-full text-left text-[13px] leading-snug text-white/95 drop-shadow-[0_1px_3px_rgba(0,0,0,0.75)]"
                aria-expanded={false}
              >
                <ClampedText text={caption} lines={2} className="w-full" />
              </button>
              {hasTranslation ? (
                <TranslationAttribution
                  showOriginal={showOriginal}
                  onToggle={() => setShowOriginal((v) => !v)}
                />
              ) : null}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
