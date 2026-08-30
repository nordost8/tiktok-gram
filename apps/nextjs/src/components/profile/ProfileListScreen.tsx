"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useTRPC } from "~/trpc/react";
import type { FeedPost } from "~/components/feed/types";

import { PostGridList } from "./PostGridList";

interface ProfileListScreenProps {
  kind: "liked" | "subscriptions" | "history";
  onBack: () => void;
  selectedPost: FeedPost | null;
  onSelectPost: (post: FeedPost | null) => void;
}

export function ProfileListScreen({ kind, onBack, selectedPost, onSelectPost }: ProfileListScreenProps) {
  const { t } = useTranslation();
  const trpc = useTRPC();

  const subsQuery = useQuery({
    ...trpc.profile.subscriptions.queryOptions(),
    enabled: kind === "subscriptions",
  });

  const postsQuery = useInfiniteQuery(
    kind === "history"
      ? trpc.profile.history.infiniteQueryOptions(
          { limit: 30 },
          {
            getNextPageParam: (last) => last.nextCursor,
            enabled: true,
          },
        )
      : trpc.profile.liked.infiniteQueryOptions(
          { limit: 30 },
          {
            getNextPageParam: (last) => last.nextCursor,
            enabled: kind === "liked",
          },
        ),
  );

  const title =
    kind === "liked"
      ? t("profile.liked")
      : kind === "history"
        ? t("profile.list.historyTitle")
        : t("profile.subscriptions");
  const emptyText =
    kind === "liked"
      ? t("profile.list.emptyLiked")
      : kind === "history"
        ? t("profile.list.emptyHistory")
        : t("profile.list.emptySubscriptions");

  const channels = subsQuery.data ?? [];

  if (kind === "subscriptions") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-black">
        <header className="flex shrink-0 items-center justify-center border-b border-zinc-900 px-4 py-4">
          <h1 className="text-lg font-semibold">{title}</h1>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {channels.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">{emptyText}</p>
          ) : (
            <ul className="space-y-3 px-4 py-4">
              {channels.map((ch) => {
                const hasPublicUsername = ch.username && !/^-?\d+$/.test(ch.username);
                return (
                  <li key={ch.id} className="rounded-2xl border border-zinc-900 bg-zinc-950 p-4">
                    <p className="font-medium">{ch.title}</p>
                    <p className="text-xs text-zinc-500">
                      {hasPublicUsername ? `@${ch.username}` : t("channels.private")}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <PostGridList
      title={title}
      emptyText={emptyText}
      query={postsQuery}
      selectedPost={selectedPost}
      onSelectPost={onSelectPost}
      onBack={onBack}
    />
  );
}
