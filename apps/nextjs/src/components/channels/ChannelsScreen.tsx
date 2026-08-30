"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { hapticImpact } from "~/lib/telegram/haptic";
import { openTelegramLink } from "~/lib/telegram/open-link";
import { invalidateAppQueries } from "~/lib/trpc/invalidate-app-queries";
import { useTRPC } from "~/trpc/react";
import { useFeedStyle } from "~/components/style/FeedStyleContext";
import { useAppConfig } from "~/components/app/AppConfigProvider";
import { localizeCategory } from "~/lib/i18n/category-labels";

interface ChannelsScreenProps {
  onBack?: () => void;
  onSuggest?: () => void;
}

export function ChannelsScreen({ onSuggest }: ChannelsScreenProps) {
  const { t } = useTranslation();
  const { locale } = useAppConfig();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { style } = useFeedStyle();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | undefined>();

  const categoriesQuery = useQuery(trpc.channels.categories.queryOptions());
  const listQuery = useQuery(
    trpc.channels.list.queryOptions(category ? { categorySlug: category } : undefined),
  );
  const searchQuery = useQuery({
    ...trpc.channels.search.queryOptions({ query }),
    enabled: query.trim().length > 1,
  });

  const subscribeMutation = useMutation(
    trpc.channels.toggleSubscribe.mutationOptions({
      onMutate: () => hapticImpact("light"),
      onSuccess: () => invalidateAppQueries(queryClient, trpc),
    }),
  );

  const isSearching = query.trim().length > 1;
  const channels = isSearching ? (searchQuery.data ?? []) : (listQuery.data ?? []);
  const isLoading = isSearching ? searchQuery.isLoading : listQuery.isLoading;
  const categories = (categoriesQuery.data ?? []).map((c) => localizeCategory(locale, c));

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="flex items-center justify-between border-b border-zinc-900 px-4 py-4">
        <h1 className="text-lg font-semibold">{t("channels.title")}</h1>
        {onSuggest && (
          <button
            type="button"
            onClick={onSuggest}
            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 active:bg-zinc-800"
          >
            {t("channels.suggestButton")}
          </button>
        )}
      </header>

      {/* Search */}
      <div className="px-4 pt-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("channels.searchPlaceholder")}
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-2.5 text-sm outline-none focus:border-zinc-600"
        />
      </div>

      {/* Categories — single scrollable row */}
      <div
        className="flex gap-2 overflow-x-auto px-4 py-3"
        style={{ scrollbarWidth: "none" }}
      >
        <button
          type="button"
          onClick={() => setCategory(undefined)}
          className={cn(
            "shrink-0 rounded-full px-3 py-1 text-sm font-medium",
            !category ? "bg-white text-black" : "bg-zinc-900 text-zinc-400",
          )}
        >
          {t("channels.categoryAll")}
        </button>
        {categories.map((cat) => (
          <button
            key={cat.slug}
            type="button"
            onClick={() => setCategory(cat.slug)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-sm",
              category === cat.slug ? "bg-white text-black" : "bg-zinc-900 text-zinc-400",
            )}
          >
            {cat.emoji} {cat.title}
          </button>
        ))}
      </div>

      {/* Channel list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="py-10 text-center text-sm text-zinc-500">{t("channels.loading")}</p>
        ) : channels.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 px-6 text-center">
            <p className="text-sm text-zinc-500">{t("channels.notFound")}</p>
            {onSuggest && (
              <button
                type="button"
                onClick={onSuggest}
                className="rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-300 active:bg-zinc-800"
              >
                {t("channels.addYours")}
              </button>
            )}
          </div>
        ) : (
          <ul>
            {channels.map((channel) => {
              const hasPublicUsername = channel.username && !/^-?\d+$/.test(channel.username);
              return (
                <li
                  key={channel.id}
                  className="flex items-center gap-3 border-b border-zinc-900 px-4 py-3"
                >
                  {/* Avatar */}
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-zinc-800">
                    {channel.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={channel.avatarUrl}
                        alt={channel.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-sm font-semibold text-zinc-400">
                        {channel.title.slice(0, 1)}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">
                      {channel.title}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {hasPublicUsername ? `@${channel.username}` : t("channels.private")}
                      {channel.categorySlug && !category ? (
                        <span className="text-zinc-600">
                          {" · "}
                          {categories.find((c) => c.slug === channel.categorySlug)?.title ?? channel.categorySlug}
                        </span>
                      ) : null}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      className={cn(
                        "rounded-full px-4 py-1.5 text-xs font-semibold",
                        channel.subscribed
                          ? "border border-zinc-600 bg-zinc-800 text-zinc-300"
                          : style === "pop"
                            ? "bg-splash text-white"
                            : "bg-sky-500 text-white",
                      )}
                      onClick={() => subscribeMutation.mutate({ channelId: channel.id })}
                    >
                      {channel.subscribed ? t("channels.subscribed") : t("channels.subscribe")}
                    </button>
                    {hasPublicUsername ? (
                      <button
                        type="button"
                        className="text-[10px] text-zinc-600"
                        onClick={() => openTelegramLink(`https://t.me/${channel.username}`)}
                      >
                        {t("channels.telegramLink")}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
