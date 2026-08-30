"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { trackEvent } from "~/lib/analytics";
import { useFeedStyle } from "~/components/style/FeedStyleContext";
import type { FeedStyle } from "~/components/style/FeedStyleContext";
import { StylePicker } from "~/components/style/StylePicker";

import { StarsBackdrop } from "./StarsBackdrop";

interface OnboardingStyleStepProps {
  /** Advance to the next onboarding phase. */
  onDone: () => void;
}

export function OnboardingStyleStep({ onDone }: OnboardingStyleStepProps) {
  const { t } = useTranslation();
  const { style, setStyle } = useFeedStyle();
  const pop = style === "pop";

  // Tapping a card only APPLIES the theme live (so the user can preview and
  // compare both). Advancing happens only when they tap "Next".
  const pick = (next: FeedStyle) => {
    setStyle(next);
    trackEvent("style_selected", { style: next, where: "onboarding" });
  };

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden bg-black">
      <StarsBackdrop />
      <div className="px-6 pb-2 pt-10">
        <h1 className="font-display text-[28px] font-extrabold leading-tight">
          {t("onboarding.style.titlePrefix")}{" "}
          <span className="text-splash">{t("onboarding.style.titleHighlight")}</span>
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          {t("onboarding.style.description")}
        </p>
      </div>

      <div className="flex flex-1 items-center px-5">
        <StylePicker value={style} onPick={pick} className="w-full" />
      </div>

      <div className="px-4 pb-8 pt-2">
        <button
          type="button"
          onClick={onDone}
          className={cn(
            "font-display w-full rounded-full py-3.5 text-[15px] font-bold transition-all active:scale-[0.98]",
            pop
              ? "bg-splash text-white shadow-[0_10px_30px_-8px_rgba(255,46,147,0.6)]"
              : "bg-white text-black",
          )}
        >
          {t("common.next")}
        </button>
      </div>
    </div>
  );
}
