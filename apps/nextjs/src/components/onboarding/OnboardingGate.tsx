"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useTRPC } from "~/trpc/react";
import { allowsWriteToPm } from "~/lib/telegram/write-access";
import { useAppConfig } from "~/components/app/AppConfigProvider";
import { localizeCategory } from "~/lib/i18n/category-labels";

import { InterestSelectionScreen } from "./InterestSelectionScreen";
import { OnboardingNotifyStep } from "./OnboardingNotifyStep";
import { OnboardingStories } from "./OnboardingStories";
import { OnboardingStyleStep } from "./OnboardingStyleStep";

type Phase = "stories" | "style" | "interests" | "notify";

interface OnboardingGateProps {
  children: React.ReactNode;
}

export function OnboardingGate({ children }: OnboardingGateProps) {
  const { t } = useTranslation();
  const { locale } = useAppConfig();
  const trpc = useTRPC();
  const [phase, setPhase] = useState<Phase>("stories");
  // Set once the notify step finishes, so we route to the app immediately without
  // waiting on the status refetch (avoids a transient flash of an earlier phase).
  const [finished, setFinished] = useState(false);

  const statusQuery = useQuery(trpc.onboarding.getStatus.queryOptions());

  if (statusQuery.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <p className="text-sm text-zinc-400">{t("common.loading")}</p>
      </div>
    );
  }

  if (statusQuery.isError) {
    const message =
      statusQuery.error.message.includes("PostgreSQL") ||
      statusQuery.error.message.includes("ECONNREFUSED")
        ? t("onboarding.gate.dbUnavailable")
        : statusQuery.error.message.includes("Profile required")
          ? t("onboarding.gate.profileNotInitialized")
          : t("onboarding.gate.profileLoadFailed");

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black px-6 text-center">
        <p className="text-sm text-red-400">{message}</p>
        <button
          type="button"
          className="rounded-full bg-white px-5 py-2 text-sm font-medium text-black"
          onClick={() => void statusQuery.refetch()}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const data = statusQuery.data;
  if (!data) {
    return (
      <div className="flex h-dvh items-center justify-center bg-black">
        <p className="text-sm text-zinc-400">{t("common.loading")}</p>
      </div>
    );
  }

  // NOTE: completed check is relaxed for the "notify" phase so the final permission step
  // can be shown after interests save (which flips onboardingCompleted on the server).
  // We intentionally use localStorage "notify-prompted" (no DB column/migration) to gate re-prompts.
  // Tradeoff: the flag is per-device/browser only; it can be lost on storage clear, new browser,
  // or incognito — this avoids migration risk but is not cross-device persistent.
  if (finished || (data.onboardingCompleted && phase !== "notify")) {
    return <>{children}</>;
  }

  if (phase === "stories") {
    return (
      <OnboardingStories
        onSkip={() => setPhase("style")}
        onComplete={() => setPhase("style")}
      />
    );
  }

  if (phase === "style") {
    return <OnboardingStyleStep onDone={() => setPhase("interests")} />;
  }

  if (phase === "interests") {
    return (
      <InterestSelectionScreen
        interests={data.availableInterests.map((i) => localizeCategory(locale, i))}
        onDone={() => {
          // Advance to the notify step only if the user hasn't already granted
          // write access and hasn't been prompted on this device — otherwise finish
          // straight into the app.
          if (allowsWriteToPm() || localStorage.getItem("notify-prompted")) {
            void statusQuery.refetch();
          } else {
            setPhase("notify");
          }
        }}
      />
    );
  }

  // Final onboarding phase: ask for bot write access (notifications about new posts).
  // OnboardingNotifyStep already persists the "notify-prompted" flag before calling onDone.
  // We flip `finished` to enter the app right away, then refetch status in the background.
  return (
    <OnboardingNotifyStep
      onDone={() => {
        setFinished(true);
        void statusQuery.refetch();
      }}
    />
  );
}
