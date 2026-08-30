"use client";

import { useEffect, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { trackEvent } from "~/lib/analytics";
import { ChannelsScreen } from "~/components/channels/ChannelsScreen";
import { FeedScreen } from "~/components/feed/FeedScreen";
import { OnboardingGate } from "~/components/onboarding/OnboardingGate";
import { InterestSelectionScreen } from "~/components/onboarding/InterestSelectionScreen";
import { BottomNav } from "~/components/navigation/BottomNav";
import type { AppScreen, MainTab } from "~/components/navigation/types";
import type { FeedPost } from "~/components/feed/types";
import { ProfileListScreen } from "~/components/profile/ProfileListScreen";
import { ProfileScreen } from "~/components/profile/ProfileScreen";
import { SuggestChannelScreen } from "~/components/profile/SuggestChannelScreen";
import { SettingsScreen } from "~/components/settings/SettingsScreen";
import { TelegramMiniAppShell } from "~/components/telegram/TelegramMiniAppShell";
import { FeedStyleProvider } from "~/components/style/FeedStyleContext";
import { DeeplinkPostOverlay } from "~/components/app/DeeplinkPostOverlay";
import { useTRPC } from "~/trpc/react";
import { useAppConfig } from "~/components/app/AppConfigProvider";
import { localizeCategory } from "~/lib/i18n/category-labels";

/** Parse a share deeplink start_param: `post_<id>` or `postm_<id>` (m = music). */
function parsePostDeeplink(
  param: string | undefined,
): { postId: string; withMusic: boolean } | null {
  if (!param) return null;
  const m = /^post(m)?_(.+)$/.exec(param);
  const postId = m?.[2];
  if (!postId) return null;
  return { postId, withMusic: m?.[1] === "m" };
}

function screenToTab(screen: AppScreen): MainTab {
  if (screen === "channels") return "channels";
  if (screen === "profile" || screen === "settings" || screen === "interests" || screen === "liked" || screen === "subscriptions" || screen === "suggest" || screen === "history") {
    return "profile";
  }
  return "feed";
}

function EditInterestsScreen({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation();
  const { locale } = useAppConfig();
  const trpc = useTRPC();
  const statusQuery = useQuery(trpc.onboarding.getStatus.queryOptions());

  if (!statusQuery.data) {
    return (
      <div className="flex h-full items-center justify-center bg-black">
        <p className="text-sm text-zinc-400">{t("common.loading")}</p>
      </div>
    );
  }

  return (
    <InterestSelectionScreen
      interests={statusQuery.data.availableInterests.map((i) => localizeCategory(locale, i))}
      onBack={onBack}
      mode="edit"
      onDone={onBack}
    />
  );
}

export function TelegramApp() {
  const { t } = useTranslation();
  const [screen, setScreen] = useState<AppScreen>("feed");
  const [likedSelectedPost, setLikedSelectedPost] = useState<FeedPost | null>(null);
  const [historySelectedPost, setHistorySelectedPost] = useState<FeedPost | null>(null);
  const [interestsBackTarget, setInterestsBackTarget] = useState<AppScreen>("settings");
  const [suggestBackTarget, setSuggestBackTarget] = useState<AppScreen>("profile");
  const [deeplink, setDeeplink] = useState<{ postId: string; withMusic: boolean } | null>(null);

  useEffect(() => {
    trackEvent("app_opened");
    // Open a specific post when launched from a share deeplink.
    const startParam = window.Telegram?.WebApp?.initDataUnsafe.start_param;
    const parsed = parsePostDeeplink(startParam);
    if (parsed) {
      setDeeplink(parsed);
      trackEvent("deeplink_post_opened", {
        post_id: parsed.postId,
        with_music: parsed.withMusic,
      });
    }
  }, []);

  useEffect(() => {
    if (screen !== "liked") {
      setLikedSelectedPost(null);
    }
    if (screen !== "history") {
      setHistorySelectedPost(null);
    }
  }, [screen]);

  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;

    if (screen === "feed") {
      backButton.hide();
      return;
    }

    const goBack = () => {
      if (screen === "liked" && likedSelectedPost) {
        setLikedSelectedPost(null);
      } else if (screen === "history" && historySelectedPost) {
        setHistorySelectedPost(null);
      } else if (screen === "history") {
        setScreen("feed");
      } else if (screen === "profile" || screen === "channels") {
        setScreen("feed");
      } else if (screen === "suggest") {
        setScreen(suggestBackTarget);
      } else {
        setScreen("profile");
      }
    };

    backButton.show();
    backButton.onClick(goBack);
    return () => {
      backButton.offClick(goBack);
    };
  }, [screen, likedSelectedPost, historySelectedPost, suggestBackTarget]);

  const showBottomNav = ["feed", "channels", "profile"].includes(screen);

  // A deeplinked post is a full-screen takeover: unmount the entire main screen
  // stack (incl. FeedScreen) while it's open. Otherwise the feed keeps its active
  // video playing UNDER the overlay — two audio tracks at once + wasted memory.
  if (deeplink) {
    return (
      <TelegramMiniAppShell chrome="none">
        <FeedStyleProvider>
          <DeeplinkPostOverlay
            postId={deeplink.postId}
            withMusic={deeplink.withMusic}
            onClose={() => setDeeplink(null)}
          />
        </FeedStyleProvider>
      </TelegramMiniAppShell>
    );
  }

  return (
    <TelegramMiniAppShell chrome="none">
      <FeedStyleProvider>
      <OnboardingGate>
        <div className="flex h-full min-h-0 flex-col bg-black">
          <div className="min-h-0 flex-1 overflow-hidden">
            {screen === "feed" ? (
              <FeedScreen onOpenHistory={() => setScreen("history")} />
            ) : null}
            {screen === "channels" ? (
              <ChannelsScreen
                onSuggest={() => {
                  setSuggestBackTarget("channels");
                  setScreen("suggest");
                }}
              />
            ) : null}
            {screen === "profile" ? (
              <ProfileScreen
                onBackToFeed={() => setScreen("feed")}
                onNavigate={(next) => {
                  if (next === "interests") setInterestsBackTarget("profile");
                  if (next === "suggest") setSuggestBackTarget("profile");
                  setScreen(next);
                }}
              />
            ) : null}
            {screen === "settings" ? (
              <SettingsScreen
                onBack={() => setScreen("profile")}
                onEditInterests={() => {
                  setInterestsBackTarget("settings");
                  setScreen("interests");
                }}
              />
            ) : null}
            {screen === "interests" ? (
              <EditInterestsScreen onBack={() => setScreen(interestsBackTarget)} />
            ) : null}
            {screen === "liked" || screen === "subscriptions" ? (
              <ProfileListScreen
                kind={screen}
                onBack={() => setScreen("profile")}
                selectedPost={screen === "liked" ? likedSelectedPost : null}
                onSelectPost={setLikedSelectedPost}
              />
            ) : null}
            {screen === "history" ? (
              <ProfileListScreen
                kind="history"
                onBack={() => {
                  if (historySelectedPost) setHistorySelectedPost(null);
                  else setScreen("feed");
                }}
                selectedPost={historySelectedPost}
                onSelectPost={setHistorySelectedPost}
              />
            ) : null}
            {screen === "suggest" ? (
              <SuggestChannelScreen
                onBack={() => setScreen(suggestBackTarget)}
                backLabel={
                  suggestBackTarget === "channels"
                    ? t("profile.suggestChannel.backToChannels")
                    : t("profile.suggestChannel.backToProfile")
                }
              />
            ) : null}
          </div>
          {showBottomNav ? (
            <BottomNav
              active={screenToTab(screen)}
              onChange={(tab) => setScreen(tab)}
            />
          ) : null}
        </div>
      </OnboardingGate>
      </FeedStyleProvider>
    </TelegramMiniAppShell>
  );
}
