"use client";

import { useState } from "react";

import { cn } from "@tiktok-gram/ui";

import { useFeedStyle } from "~/components/style/FeedStyleContext";

import { StarsBackdrop } from "./StarsBackdrop";

interface OnboardingStorySlideProps {
  title: string;
  description: string;
  cta: string;
  /** Art file name under /public/onboarding (without extension). */
  art: string;
  /** Emoji shown only if the generated art is missing. */
  fallbackEmoji: string;
  onCta: () => void;
}

export function OnboardingStorySlide({
  title,
  description,
  cta,
  art,
  fallbackEmoji,
  onCta,
}: OnboardingStorySlideProps) {
  const [artFailed, setArtFailed] = useState(false);
  const { style } = useFeedStyle();

  return (
    <div className="relative isolate flex h-full flex-col items-center justify-between overflow-hidden px-6 pb-10 pt-16">
      <StarsBackdrop />
      <div className="flex flex-1 flex-col items-center justify-center gap-8 text-center">
        <div className="relative flex h-44 w-44 items-center justify-center">
          {/* Splash glow halo behind the hero sticker (hidden in minimal). */}
          <span className="splash-glow bg-splash absolute inset-3 rounded-full opacity-30 blur-2xl" />
          {artFailed ? (
            <span className="relative grid h-40 w-40 place-items-center rounded-3xl bg-white/[0.04] text-5xl shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              {fallbackEmoji}
            </span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/onboarding/${art}.png`}
              alt=""
              draggable={false}
              className="relative h-44 w-44 object-contain drop-shadow-[0_12px_28px_rgba(0,0,0,0.55)]"
              onError={() => setArtFailed(true)}
            />
          )}
        </div>
        <div className="space-y-3">
          <h2 className="font-display text-2xl font-extrabold leading-tight">{title}</h2>
          <p className="max-w-xs text-sm leading-relaxed text-zinc-400">{description}</p>
        </div>
      </div>
      <button
        type="button"
        data-story-cta
        onClick={(event) => {
          event.stopPropagation();
          onCta();
        }}
        className={cn(
          "w-full max-w-sm rounded-full px-6 py-3.5 text-sm font-bold",
          style === "pop"
            ? "bg-splash text-white shadow-[0_10px_30px_-8px_rgba(255,46,147,0.6)]"
            : "bg-white text-black",
        )}
      >
        {cta}
      </button>
    </div>
  );
}
