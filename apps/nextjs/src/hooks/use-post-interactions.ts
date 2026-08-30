"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { hapticImpact } from "~/lib/telegram/haptic";
import { sharePost } from "~/lib/telegram/share";
import { invalidateProfileQueries } from "~/lib/trpc/invalidate-app-queries";
import { useTRPC } from "~/trpc/react";
import { trackEvent } from "~/lib/analytics";

import type { FeedPost } from "~/components/feed/types";

export function usePostInteractions(post: FeedPost) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [liked, setLiked] = useState(post.viewerState.liked);
  const [saved, setSaved] = useState(post.viewerState.saved);
  const [subscribed, setSubscribed] = useState(post.viewerState.subscribed);
  const [likes, setLikes] = useState(post.stats.likes);
  const [saves, setSaves] = useState(post.stats.saves);

  // Keep refs for use inside mutation callbacks to avoid stale closures
  const likedRef = useRef(liked);
  const savedRef = useRef(saved);
  likedRef.current = liked;
  savedRef.current = saved;

  const pendingLikeRef = useRef(false);
  const pendingSaveRef = useRef(false);

  // Sync when navigating to a different post
  useEffect(() => {
    setLiked(post.viewerState.liked);
    setSaved(post.viewerState.saved);
    setSubscribed(post.viewerState.subscribed);
    setLikes(post.stats.likes);
    setSaves(post.stats.saves);
    pendingLikeRef.current = false;
    pendingSaveRef.current = false;
  }, [
    post.id,
    post.viewerState.liked,
    post.viewerState.saved,
    post.viewerState.subscribed,
    post.stats.likes,
    post.stats.saves,
  ]);

  const invalidateProfile = useCallback(() => {
    invalidateProfileQueries(queryClient, trpc);
  }, [queryClient, trpc]);

  const likeMutation = useMutation(
    trpc.interactions.toggleLike.mutationOptions({
      onMutate: () => {
        hapticImpact("light");
        const wasLiked = likedRef.current;
        setLiked(!wasLiked);
        setLikes((n) => (wasLiked ? Math.max(0, n - 1) : n + 1));
      },
      onSuccess: (data) => {
        setLiked(data.liked);
        invalidateProfile();
        trackEvent(data.liked ? "post_liked" : "post_unliked", {
          post_id: post.id,
          channel: post.channel.title,
        });
      },
      onError: () => {
        setLiked(post.viewerState.liked);
        setLikes(post.stats.likes);
      },
      onSettled: () => {
        pendingLikeRef.current = false;
      },
    }),
  );

  const saveMutation = useMutation(
    trpc.interactions.toggleSave.mutationOptions({
      onMutate: () => {
        hapticImpact("light");
        const wasSaved = savedRef.current;
        setSaved(!wasSaved);
        setSaves((n) => (wasSaved ? Math.max(0, n - 1) : n + 1));
      },
      onSuccess: (data) => {
        setSaved(data.saved);
        invalidateProfile();
      },
      onError: () => {
        setSaved(post.viewerState.saved);
        setSaves(post.stats.saves);
      },
      onSettled: () => {
        pendingSaveRef.current = false;
      },
    }),
  );

  const subscribeMutation = useMutation(
    trpc.channels.toggleSubscribe.mutationOptions({
      onMutate: () => hapticImpact("light"),
      onSuccess: (data) => {
        setSubscribed(data.subscribed);
        invalidateProfile();
        trackEvent(data.subscribed ? "channel_subscribed" : "channel_unsubscribed", {
          channel_id: post.channel.id,
          channel: post.channel.title,
        });
      },
    }),
  );

  const shareMutation = useMutation(
    trpc.interactions.recordShare.mutationOptions({
      onSuccess: invalidateProfile,
    }),
  );

  const share = useCallback(async () => {
    hapticImpact("light");
    trackEvent("post_shared", { post_id: post.id, channel: post.channel.title });
    try {
      const result = await shareMutation.mutateAsync({ postId: post.id });
      await sharePost({
        preparedMessageId: result.preparedMessageId,
        shareUrl: result.shareUrl,
        title: post.channel.title,
      });
    } catch {
      await sharePost({
        preparedMessageId: null,
        shareUrl: post.telegramUrl,
        title: post.channel.title,
      });
    }
  }, [post.channel.title, post.id, post.telegramUrl, shareMutation]);

  const toggleLike = useCallback(() => {
    if (pendingLikeRef.current) return;
    pendingLikeRef.current = true;
    likeMutation.mutate({ postId: post.id });
  }, [likeMutation, post.id]);

  const toggleSave = useCallback(() => {
    if (pendingSaveRef.current) return;
    pendingSaveRef.current = true;
    saveMutation.mutate({ postId: post.id });
  }, [post.id, saveMutation]);

  return {
    liked,
    saved,
    subscribed,
    likes,
    saves,
    toggleLike,
    toggleSave,
    toggleSubscribe: () =>
      subscribeMutation.mutate({ channelId: post.channel.id }),
    share,
  };
}
