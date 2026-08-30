"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { useFeedStyle } from "~/components/style/FeedStyleContext";
import { requestWriteAccess } from "~/lib/telegram/write-access";

import { StarsBackdrop } from "./StarsBackdrop";

interface OnboardingNotifyStepProps {
  /** Finish this onboarding step and enter the app (refetch will happen in caller). */
  onDone: () => void;
}

export function OnboardingNotifyStep({ onDone }: OnboardingNotifyStepProps) {
  const { t } = useTranslation();
  const { style } = useFeedStyle();
  const pop = style === "pop";

  const finish = () => {
    localStorage.setItem("notify-prompted", "1");
    onDone();
  };

  // "Next" triggers Telegram's native write-access popup (the official Mini App
  // method for letting the bot message the user). The native popup handles
  // allow/deny; either way we proceed into the app.
  const handleNext = () => requestWriteAccess(() => finish());

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden bg-black">
      <StarsBackdrop />
      <div className="px-6 pb-2 pt-10">
        <h1 className="font-display text-[28px] font-extrabold leading-tight">
          {t("onboarding.notify.titlePrefix")}{" "}
          <span className="text-splash">{t("onboarding.notify.titleHighlight")}</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {t("onboarding.notify.description")}
        </p>
      </div>

      <div className="flex flex-1 items-center justify-center px-5">
        <div className="relative flex h-28 w-28 items-center justify-center">
          {/* Subtle splash glow, hidden automatically in minimal via .splash-glow css rule */}
          <span className="splash-glow bg-splash absolute inset-3 rounded-full opacity-30 blur-2xl" />
          <svg
            width="72"
            height="72"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="relative text-white/90"
            aria-hidden
          >
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </div>
      </div>

      <div className="px-4 pb-8 pt-2">
        <button
          type="button"
          onClick={handleNext}
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
