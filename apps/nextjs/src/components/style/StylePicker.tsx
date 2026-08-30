"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { hapticSelection } from "~/lib/telegram/haptic";

import type { FeedStyle } from "./FeedStyleContext";

interface StylePickerProps {
  /** Currently applied style — its card shows a filled radio. */
  value: FeedStyle;
  /** Fires when a card is chosen (applies immediately; caller may also advance). */
  onPick: (style: FeedStyle) => void;
  className?: string;
}

/** A miniature feed mock-up, rendered in each style's own look. */
function PreviewCard({
  variant,
  selected,
  onPick,
}: {
  variant: FeedStyle;
  selected: boolean;
  onPick: (style: FeedStyle) => void;
}) {
  const { t } = useTranslation();
  const isPop = variant === "pop";
  return (
    <button
      type="button"
      onClick={() => {
        hapticSelection();
        onPick(variant);
      }}
      aria-pressed={selected}
      className={cn(
        "group relative flex flex-col gap-3 rounded-3xl p-3 text-left transition-all duration-200 active:scale-[0.98]",
        selected
          ? isPop
            ? "shadow-[0_0_0_2px_var(--color-splash-violet),0_12px_30px_-10px_rgba(139,92,255,0.6)]"
            : "shadow-[0_0_0_2px_#fff]"
          : "shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.22)]",
      )}
    >
      {/* Empty / filled selector dot, top-left — the code-editor theme cue. */}
      <span
        className={cn(
          "absolute left-2 top-2 z-10 grid h-5 w-5 place-items-center rounded-full transition-all",
          selected
            ? isPop
              ? "bg-splash"
              : "bg-white"
            : "shadow-[inset_0_0_0_2px_rgba(255,255,255,0.4)]",
        )}
      >
        {selected ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12.5 10 17.5 19 7"
              stroke={isPop ? "#fff" : "#0b0b12"}
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>

      {/* The mock screen */}
      <div
        className={cn(
          "relative aspect-[9/16] w-full overflow-hidden rounded-2xl",
          isPop ? "bg-ink" : "bg-black",
        )}
      >
        {isPop ? (
          <>
            <div className="bg-splash absolute -left-4 -top-4 h-16 w-16 rounded-full opacity-30 blur-2xl" />
            <div
              className="absolute -bottom-5 -right-5 h-20 w-20 rounded-full opacity-30 blur-2xl"
              style={{ backgroundColor: "var(--color-splash-cyan)" }}
            />
            {/* framed photo card */}
            <div className="absolute inset-2 rounded-xl bg-white/[0.06] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.14)]" />
            {/* segmented progress */}
            <div className="absolute inset-x-3 top-3 flex gap-1">
              <span className="h-1 flex-1 rounded-full bg-white/80" />
              <span className="h-1 flex-1 rounded-full bg-white/30" />
              <span className="h-1 flex-1 rounded-full bg-white/30" />
            </div>
            {/* sticker dots = action rail */}
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <span className="bg-splash h-3 w-3 rounded-full" />
              <span className="bg-pop-sunny h-3 w-3 rounded-full" />
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: "var(--color-splash-cyan)" }}
              />
            </div>
          </>
        ) : (
          <>
            {/* plain full-bleed media */}
            <div className="absolute inset-0 bg-zinc-900" />
            <div className="absolute inset-x-3 bottom-3 space-y-1.5">
              <span className="block h-1.5 w-2/3 rounded-full bg-zinc-700" />
              <span className="block h-1.5 w-1/2 rounded-full bg-zinc-800" />
            </div>
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
              <span className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.5)]" />
              <span className="h-3 w-3 rounded-full shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.5)]" />
            </div>
          </>
        )}
      </div>

      <div className="px-1 pb-1">
        <p
          className={cn(
            "text-sm font-semibold",
            isPop ? "font-display text-splash" : "text-white",
          )}
        >
          {isPop ? t("style.pop.title") : t("style.minimal.title")}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          {isPop ? t("style.pop.description") : t("style.minimal.description")}
        </p>
      </div>
    </button>
  );
}

export function StylePicker({ value, onPick, className }: StylePickerProps) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", className)}>
      <PreviewCard variant="pop" selected={value === "pop"} onPick={onPick} />
      <PreviewCard
        variant="minimal"
        selected={value === "minimal"}
        onPick={onPick}
      />
    </div>
  );
}
