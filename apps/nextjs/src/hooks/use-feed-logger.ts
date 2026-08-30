import { useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import type { FeedTab } from "~/components/feed/types";

interface FeedLogPayload {
  eventType:
    | "swipe_next"
    | "swipe_prev"
    | "swipe_blocked"
    | "feed_loaded"
    | "feed_exhausted"
    | "page_fetched";
  tab?: FeedTab;
  activeIndex?: number;
  totalPosts?: number;
  pagesLoaded?: number;
  hasNextPage?: boolean;
  isFetching?: boolean;
  postId?: string;
  cursorSnapshot?: string;
  blockReason?: string;
  extra?: Record<string, unknown>;
}

export function useFeedLogger() {
  const trpc = useTRPC();
  const { mutate } = useMutation(trpc.feed.logEvent.mutationOptions());
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;

  return useCallback((payload: FeedLogPayload) => {
    mutateRef.current(payload, {
      onError: (err) => console.warn("[FeedLog] failed:", err),
    });
  }, []);
}
