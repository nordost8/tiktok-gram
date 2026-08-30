"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { hapticSelection } from "~/lib/telegram/haptic";

import { OnboardingStorySlide } from "./OnboardingStorySlide";
import { ONBOARDING_STORIES } from "./stories-data";
import { StoryProgressBars } from "./StoryProgressBars";

interface OnboardingStoriesProps {
  onComplete: () => void;
  onSkip: () => void;
}

const NAV_COOLDOWN_MS = 400;

export function OnboardingStories({ onComplete, onSkip }: OnboardingStoriesProps) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const slide = ONBOARDING_STORIES[index];
  const pointerStartX = useRef<number | null>(null);
  const lastNavAt = useRef(0);
  const indexRef = useRef(index);
  indexRef.current = index;

  const goNext = useCallback(() => {
    const now = Date.now();
    if (now - lastNavAt.current < NAV_COOLDOWN_MS) return;
    lastNavAt.current = now;
    hapticSelection();

    const last = ONBOARDING_STORIES.length - 1;
    if (indexRef.current >= last) {
      onComplete();
      return;
    }
    setIndex((value) => Math.min(value + 1, last));
  }, [onComplete]);

  const goPrev = useCallback(() => {
    const now = Date.now();
    if (now - lastNavAt.current < NAV_COOLDOWN_MS) return;
    lastNavAt.current = now;
    hapticSelection();
    setIndex((value) => Math.max(value - 1, 0));
  }, []);

  const handleSkip = () => {
    hapticSelection();
    onSkip();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-story-cta]")) return;
    pointerStartX.current = event.clientX;
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-story-cta]")) return;

    const start = pointerStartX.current;
    pointerStartX.current = null;
    if (start == null) return;

    const delta = event.clientX - start;
    if (Math.abs(delta) >= 40) {
      if (delta < 0) goNext();
      else goPrev();
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (x < rect.width / 2) goPrev();
    else goNext();
  };

  if (!slide) return null;

  return (
    <div className="relative flex h-dvh flex-col bg-black">
      <div className="absolute inset-x-0 top-0 z-20">
        <StoryProgressBars total={ONBOARDING_STORIES.length} activeIndex={index} />
        <div className="flex justify-end px-4 pt-3">
          <button type="button" onClick={handleSkip} className="text-sm text-zinc-400">
            {t("onboarding.stories.skip")}
          </button>
        </div>
      </div>

      <div
        className="relative flex-1 touch-none"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        <OnboardingStorySlide
          title={t(slide.title)}
          description={t(slide.description)}
          cta={t(slide.cta)}
          art={slide.art}
          fallbackEmoji={slide.icon}
          onCta={goNext}
        />
      </div>
    </div>
  );
}
