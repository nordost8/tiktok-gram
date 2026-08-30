import type { QueryClient } from "@tanstack/react-query";

import type { useTRPC } from "~/trpc/react";

type Trpc = ReturnType<typeof useTRPC>;

/** Profile and channels after like/save/subscribe (without a full feed refetch). */
export function invalidateProfileQueries(queryClient: QueryClient, trpc: Trpc) {
  void queryClient.invalidateQueries({ queryKey: trpc.profile.me.queryKey() });
  void queryClient.invalidateQueries(trpc.profile.saved.queryFilter());
  void queryClient.invalidateQueries(trpc.profile.liked.queryFilter());
  void queryClient.invalidateQueries(trpc.profile.subscriptions.queryFilter());
  void queryClient.invalidateQueries(trpc.channels.list.queryFilter());
  void queryClient.invalidateQueries(trpc.channels.search.queryFilter());
}

/** Reset the feed cache (after hide channel, etc.). */
export function invalidateFeedQueries(queryClient: QueryClient, trpc: Trpc) {
  void queryClient.invalidateQueries(trpc.feed.forYou.queryFilter());
  void queryClient.invalidateQueries(trpc.feed.subscriptions.queryFilter());
}

/** Full cache reset (rare — e.g. after onboarding). */
export function invalidateAppQueries(queryClient: QueryClient, trpc: Trpc) {
  invalidateProfileQueries(queryClient, trpc);
  invalidateFeedQueries(queryClient, trpc);
}
