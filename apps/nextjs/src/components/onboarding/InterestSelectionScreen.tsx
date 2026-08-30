"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { useTRPC } from "~/trpc/react";
import { trackEvent } from "~/lib/analytics";
import { hapticNotification } from "~/lib/telegram/haptic";
import { viewedPostsStore } from "~/lib/feed/viewed-posts-store";
import { useFeedStyle } from "~/components/style/FeedStyleContext";

import { InterestCategoryCard } from "./InterestCategoryCard";

interface Interest {
  id: string;
  slug: string;
  emoji: string;
  title: string;
  description: string | null;
}

interface InterestSelectionScreenProps {
  interests: Interest[];
  initialSelectedIds?: string[];
  onDone: () => void;
  onBack?: () => void;
  /**
   * "onboarding" (default) is the first-run flow (analytics: onboarding_completed);
   * "edit" is re-picking interests from Settings/Profile (analytics:
   * interests_updated). Drives both the submit button's label and the
   * analytics event — kept as an explicit mode instead of inferring intent
   * from the button's display text.
   */
  mode?: "onboarding" | "edit";
}

export function InterestSelectionScreen({
  interests,
  initialSelectedIds = [],
  onDone,
  onBack,
  mode = "onboarding",
}: InterestSelectionScreenProps) {
  const { t } = useTranslation();
  const submitLabel = mode === "edit" ? t("onboarding.interests.save") : t("onboarding.interests.start");
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { style } = useFeedStyle();
  const pop = style === "pop";
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialSelectedIds),
  );
  const [showScrollHint, setShowScrollHint] = useState(true);
  const [shaking, setShaking] = useState(false);

  const handleSubmit = () => {
    if (!canSubmit) {
      hapticNotification("error");
      setShaking(true);
      setTimeout(() => setShaking(false), 600);
      return;
    }
    saveMutation.mutate({ interestIds: Array.from(selected) });
  };

  const saveMutation = useMutation(
    trpc.onboarding.saveInterests.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.onboarding.getStatus.queryKey(),
        });
        // Remove feed cache (not invalidate — avoids race with FeedScreen remount)
        // and clear the viewed-posts guard so the fresh feed is fully unfiltered.
        queryClient.removeQueries({ queryKey: trpc.feed.forYou.infiniteQueryKey() });
        queryClient.removeQueries({ queryKey: trpc.feed.subscriptions.infiniteQueryKey() });
        viewedPostsStore.clear();
        trackEvent(mode === "edit" ? "interests_updated" : "onboarding_completed", {
          interests_count: selected.size,
        });
        onDone();
      },
    }),
  );

  const count = selected.size;
  const canSubmit = count >= 4;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 60) {
      setShowScrollHint(false);
    }
  };

  return (
    <div className="flex h-dvh flex-col bg-black">
      {onBack ? (
        <header className="flex items-center justify-center border-b border-zinc-900 px-4 py-4">
          <h1 className="text-lg font-semibold">{t("onboarding.interests.headerTitle")}</h1>
        </header>
      ) : null}
      <div className="px-6 pb-4 pt-8">
        <h1 className="font-display text-[28px] font-extrabold leading-tight">
          {t("onboarding.interests.titlePrefix")} <span className="text-splash">{t("onboarding.interests.titleHighlight")}</span>
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {t("onboarding.interests.subtitle")}
        </p>
        <p
          key={shaking ? "shaking" : "idle"}
          className={cn(
            "mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-300",
            shaking
              ? pop
                ? "animate-shake bg-pop-coral/15 text-pop-coral"
                : "animate-shake bg-red-500/15 text-red-400"
              : canSubmit
                ? pop
                  ? "bg-pop-lime/15 text-pop-lime"
                  : "bg-sky-500/15 text-sky-400"
                : "bg-white/[0.05] text-zinc-300",
          )}
        >
          {t("onboarding.interests.selectedCount", { count })}
        </p>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          className="h-full space-y-3 overflow-y-auto px-4 pb-28"
          onScroll={handleScroll}
        >
          {interests.map((item) => (
            <InterestCategoryCard
              key={item.id}
              slug={item.slug}
              emoji={item.emoji}
              title={item.title}
              description={item.description}
              selected={selected.has(item.id)}
              highlight={shaking && !selected.has(item.id)}
              onToggle={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(item.id)) next.delete(item.id);
                  else next.add(item.id);
                  return next;
                });
              }}
            />
          ))}
        </div>

        {showScrollHint && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-end pb-3"
            style={{ background: "linear-gradient(to top, black 35%, transparent)" }}
          >
            <div className="animate-bounce">
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                className="text-zinc-400"
              >
                <path
                  d="M5 7.5L10 12.5L15 7.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-zinc-900 bg-black px-4 pb-8 pt-4">
        <button
          type="button"
          disabled={saveMutation.isPending}
          onClick={handleSubmit}
          className={cn(
            "font-display w-full rounded-full py-3.5 text-[15px] font-bold transition-all active:scale-[0.98]",
            canSubmit
              ? pop
                ? "bg-splash text-white shadow-[0_10px_30px_-8px_rgba(255,46,147,0.6)]"
                : "bg-white text-black"
              : "bg-white/[0.06] text-zinc-500",
          )}
        >
          {saveMutation.isPending ? t("onboarding.interests.saving") : submitLabel}
        </button>
      </div>
    </div>
  );
}
