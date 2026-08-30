"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getAppProfileContext } from "~/lib/telegram/profile-context";
import { openTelegramLink } from "~/lib/telegram/open-link";
import { requestWriteAccessOnFirstProfileVisit } from "~/lib/telegram/write-access";
import { useTRPC } from "~/trpc/react";
import { useAppConfig } from "~/components/app/AppConfigProvider";

interface ProfileScreenProps {
  onNavigate: (screen: "liked" | "subscriptions" | "settings" | "suggest" | "interests") => void;
  onBackToFeed: () => void;
}

export function ProfileScreen({ onNavigate, onBackToFeed }: ProfileScreenProps) {
  const { t } = useTranslation();
  const { supportUrl } = useAppConfig();
  useEffect(() => {
    requestWriteAccessOnFirstProfileVisit();
  }, []);

  const trpc = useTRPC();
  const meQuery = useQuery({
    ...trpc.profile.me.queryOptions(),
    refetchOnMount: "always",
  });

  const counters = meQuery.data?.counters;
  const profile = getAppProfileContext();
  const displayName =
    profile.displayName ?? profile.username ?? t("profile.fallbackName");

  const avatarLetter = profile.displayName?.slice(0, 1).toUpperCase()
    ?? profile.username?.slice(0, 1).toUpperCase()
    ?? "?";

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="shrink-0 border-b border-zinc-900 px-4 py-5">
        <h1 className="text-lg font-semibold">{t("profile.title")}</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 px-4 py-8">
          <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-zinc-800 text-2xl">
            {profile.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.photoUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : (
              avatarLetter
            )}
          </div>
          <p className="font-medium">{displayName}</p>
          {profile.username ? (
            <p className="text-sm text-zinc-400">@{profile.username}</p>
          ) : (
            <p className="text-sm text-zinc-400">{t("profile.telegramMiniAppFallback")}</p>
          )}
          <div className="mt-4 grid w-full max-w-sm grid-cols-2 gap-3 text-center">
            <div className="rounded-xl bg-zinc-950 p-3">
              <p className="text-lg font-semibold">{counters?.liked ?? 0}</p>
              <p className="text-xs text-zinc-500">{t("profile.liked")}</p>
            </div>
            <div className="rounded-xl bg-zinc-950 p-3">
              <p className="text-lg font-semibold">{counters?.subscriptions ?? 0}</p>
              <p className="text-xs text-zinc-500">{t("profile.subscriptions")}</p>
            </div>
          </div>
        </div>

        <div className="space-y-2 px-4">
          {[
            { id: "liked" as const, label: t("profile.liked") },
            { id: "subscriptions" as const, label: t("profile.subscriptions") },
            { id: "interests" as const, label: t("profile.editInterests") },
            { id: "suggest" as const, label: t("profile.suggestChannel.title") },
            { id: "settings" as const, label: t("profile.settings") },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              className="flex w-full items-center justify-between rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4 text-left"
            >
              <span>{item.label}</span>
              <span className="text-zinc-500">→</span>
            </button>
          ))}
        </div>

        {supportUrl ? (
          <div className="px-4 pb-2 pt-4">
            <button
              type="button"
              onClick={() => openTelegramLink(supportUrl)}
              className="flex w-full items-center justify-between rounded-2xl border border-zinc-900 bg-zinc-950 px-4 py-4 text-left"
            >
              <span>{t("profile.support")}</span>
              <span className="text-zinc-500">↗</span>
            </button>
          </div>
        ) : null}

        <div className="px-4 py-6">
          <button
            type="button"
            onClick={onBackToFeed}
            className="w-full rounded-full bg-white py-3 text-sm font-semibold text-black"
          >
            {t("profile.backToFeed")}
          </button>
        </div>
      </div>
    </div>
  );
}
