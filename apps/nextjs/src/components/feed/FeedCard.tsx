"use client";

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import type { FeedPost } from "./types";
import type { HorizontalConsumer } from "./engine/FeedController";
import type { CarouselController } from "./FeedImageCarousel";
import { usePostInteractions } from "~/hooks/use-post-interactions";
import { openTelegramLink } from "~/lib/telegram/open-link";
import { trackEvent } from "~/lib/analytics";
import { invalidateFeedQueries } from "~/lib/trpc/invalidate-app-queries";
import { useTRPC } from "~/trpc/react";
import { FeedActionRail } from "./FeedActionRail";
import { FeedMedia } from "./FeedMedia";
import { FeedOverlayInfo } from "./FeedOverlayInfo";
import { PostMoreMenu } from "./PostMoreMenu";
import { PostBottomSheet } from "./PostBottomSheet";
import { ChannelPrivatePopup } from "./ChannelPrivatePopup";
import { isPublicChannel } from "./feed-utils";

interface FeedCardProps {
  post: FeedPost;
  isActive: boolean;
  /** Load /api/media only when this slide is in the active window (±1). */
  mountMedia: boolean;
  muted: boolean;
  overlayVisible: boolean;
  onToggleMute: () => void;
  onToggleOverlay: () => void;
  onSetHorizontalConsumer?: (consumer: HorizontalConsumer | null) => void;
  onRegisterController?: (api: CarouselController) => void;
  onChannelHidden?: () => void;
}

export function FeedCard({
  post,
  isActive,
  mountMedia,
  muted,
  overlayVisible,
  onToggleMute,
  onToggleOverlay,
  onSetHorizontalConsumer,
  onRegisterController,
  onChannelHidden,
}: FeedCardProps) {
  const { t } = useTranslation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [privateOpen, setPrivateOpen] = useState(false);
  const interactions = usePostInteractions(post);
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { data: status } = useQuery(trpc.onboarding.getStatus.queryOptions());
  const isAdmin = status?.isAdmin ?? false;

  const hideChannelMutation = useMutation(
    trpc.channels.hideChannel.mutationOptions({
      onSuccess: () => {
        trackEvent("channel_hidden", {
          channel_id: post.channel.id,
          channel: post.channel.title,
        });
        invalidateFeedQueries(queryClient, trpc);
        void queryClient.invalidateQueries(trpc.channels.listHidden.queryFilter());
        onChannelHidden?.();
      },
    }),
  );

  const openTelegram = useCallback(() => {
    trackEvent("post_opened_telegram", { post_id: post.id, channel: post.channel.title });
    openTelegramLink(post.telegramUrl);
  }, [post.id, post.channel.title, post.telegramUrl]);

  const downloadMedia = useCallback(() => {
    const mediaUrl = post.primaryMedia.url;
    const fullUrl = mediaUrl.startsWith("http")
      ? mediaUrl
      : `${window.location.origin}${mediaUrl}`;
    const ext =
      post.primaryMedia.type === "video"
        ? "mp4"
        : post.primaryMedia.type === "animation"
          ? "gif"
          : "jpg";
    const filename = `${post.channel.username}_${post.id.slice(0, 8)}.${ext}`;

    // Telegram WebApp Bot API 8.0+: native download
    const tgWebApp = (window as { Telegram?: { WebApp?: { downloadFile?: (opts: { url: string; file_name: string }) => void } } }).Telegram?.WebApp;
    if (tgWebApp?.downloadFile) {
      tgWebApp.downloadFile({ url: fullUrl, file_name: filename });
      return;
    }
    // Fallback: blob → <a download>
    void fetch(fullUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      })
      .catch(() => window.open(fullUrl, "_blank", "noopener,noreferrer"));
  }, [post.primaryMedia.url, post.primaryMedia.type, post.channel.username, post.id]);

  const openChannel = useCallback(() => {
    trackEvent("channel_opened", { channel_id: post.channel.id, channel: post.channel.title });
    if (isPublicChannel(post.channel)) {
      // Public: open the specific post (message), not the channel home.
      openTelegramLink(post.telegramUrl);
    } else {
      setPrivateOpen(true);
    }
  }, [post.channel, post.telegramUrl]);

  // "Go to channel" (from the "More" menu): go to the channel home for public
  // channels; for a closed/private channel still ATTEMPT to open it (works only
  // if the viewer is already a member) AND surface the heads-up popup explaining
  // it's private and how to find it.
  const goToChannel = useCallback(() => {
    trackEvent("channel_open_requested", {
      channel_id: post.channel.id,
      channel: post.channel.title,
      private: !isPublicChannel(post.channel),
    });
    if (isPublicChannel(post.channel)) {
      openTelegramLink(`https://t.me/${post.channel.username}`);
    } else {
      openTelegramLink(post.telegramUrl);
      setPrivateOpen(true);
    }
  }, [post.channel, post.telegramUrl]);

  const isEvicted =
    post.primaryMedia.cacheStatus === "needs_cache" ||
    post.primaryMedia.cacheStatus === "failed";

  if (isEvicted) {
    return (
      <article className="relative flex h-full w-full flex-col items-center justify-center gap-5 overflow-hidden bg-zinc-950 px-8">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800">
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-zinc-500" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div className="space-y-1.5 text-center">
          <p className="text-sm font-medium text-zinc-200">{post.channel.title}</p>
          <p className="text-xs leading-relaxed text-zinc-500">
            {t("feed.card.deletedNotice")}
          </p>
        </div>
        <button
          type="button"
          onClick={openTelegram}
          className="rounded-full bg-zinc-800 px-5 py-2.5 text-sm font-medium text-white"
        >
          {t("feed.card.openOriginal")}
        </button>
      </article>
    );
  }

  const infoVisible = isActive && overlayVisible;

  return (
    <article className="relative h-full w-full overflow-hidden bg-black">
      <div className="absolute inset-0 z-0">
        <FeedMedia
          post={post}
          isActive={isActive}
          mountMedia={mountMedia}
          muted={muted}
          pausedBySheet={sheetOpen}
          onToggleInfo={onToggleOverlay}
          onSetHorizontalConsumer={onSetHorizontalConsumer}
          onRegisterController={onRegisterController}
        />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

      <FeedOverlayInfo
        key={post.id}
        post={post}
        subscribed={interactions.subscribed}
        detailsVisible={infoVisible}
        onOpenChannel={openChannel}
        onReadMore={() => setSheetOpen(true)}
        onSubscribe={interactions.toggleSubscribe}
        onToggleOverlay={onToggleOverlay}
      />

      <FeedActionRail
        liked={interactions.liked}
        muted={muted}
        // Music-enrichment hook — see services/music-enrichment/ (stubbed by
        // default). A photo post only gets a sound button once it has a track.
        showSound={
          post.primaryMedia.type === "video" ||
          post.primaryMedia.type === "animation" ||
          post.audio !== undefined
        }
        onLike={interactions.toggleLike}
        onShare={() => void interactions.share()}
        onMore={() => setMenuOpen(true)}
        onToggleMute={onToggleMute}
      />

      <PostBottomSheet
        post={post}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onOpenTelegram={openTelegram}
        onShare={() => void interactions.share()}
      />

      <ChannelPrivatePopup
        channel={post.channel}
        open={privateOpen}
        onOpenChange={setPrivateOpen}
      />

      {menuOpen ? (
        <PostMoreMenu
          open={menuOpen}
          isAdmin={isAdmin}
          onClose={() => setMenuOpen(false)}
          onGoToChannel={goToChannel}
          onOpenTelegram={openTelegram}
          onHideChannel={() =>
            hideChannelMutation.mutate({ channelId: post.channel.id })
          }
          onDownload={downloadMedia}
          onDebug={() => setDebugOpen(true)}
        />
      ) : null}

      {debugOpen ? (
        <div className="absolute inset-0 z-50 flex items-end bg-black/60 p-4" onClick={() => setDebugOpen(false)}>
          <div className="w-full rounded-2xl bg-zinc-950 border border-amber-400/30 p-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">🛠 Debug Info</span>
              <button type="button" onClick={() => setDebugOpen(false)} className="text-zinc-500 text-sm">✕</button>
            </div>
            <div className="space-y-1.5 font-mono text-xs text-zinc-300 break-all">
              <div><span className="text-zinc-500">post.id</span> {post.id}</div>
              <div><span className="text-zinc-500">telegramUrl</span> <a href={post.telegramUrl} className="text-blue-400 underline" onClick={(e) => { e.stopPropagation(); openTelegramLink(post.telegramUrl); }}>{post.telegramUrl}</a></div>
              <div><span className="text-zinc-500">channel</span> {post.channel.title} (@{post.channel.username})</div>
              <div><span className="text-zinc-500">channel.id</span> {post.channel.id}</div>
              <div><span className="text-zinc-500">publishedAt</span> {post.publishedAt}</div>
              <div><span className="text-zinc-500">media.id</span> {post.primaryMedia.id}</div>
              <div><span className="text-zinc-500">media.type</span> {post.primaryMedia.type}</div>
              <div><span className="text-zinc-500">media.cacheStatus</span> {post.primaryMedia.cacheStatus ?? "—"}</div>
              <div><span className="text-zinc-500">media.url</span> {post.primaryMedia.url}</div>
              <div><span className="text-zinc-500">media.size</span> {post.primaryMedia.width}×{post.primaryMedia.height}{post.primaryMedia.duration ? ` ${post.primaryMedia.duration}s` : ""}</div>
              <div><span className="text-zinc-500">text</span> {post.text ? post.text.slice(0, 120) : "—"}</div>
              <div><span className="text-zinc-500">caption</span> {post.caption ? post.caption.slice(0, 120) : "—"}</div>
              <div><span className="text-zinc-500">stats</span> 👁 {post.stats.views} ❤️ {post.stats.likes} 🔖 {post.stats.saves}</div>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
