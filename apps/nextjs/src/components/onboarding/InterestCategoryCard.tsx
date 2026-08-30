"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { hapticSelection } from "~/lib/telegram/haptic";
import { useFeedStyle } from "~/components/style/FeedStyleContext";

const HOT_SLUGS = new Set(["humor-memes", "it-tech", "military"]);

interface InterestCategoryCardProps {
  slug: string;
  emoji: string;
  title: string;
  description: string | null;
  selected: boolean;
  highlight?: boolean;
  onToggle: () => void;
}

export function InterestCategoryCard({
  slug,
  emoji,
  title,
  description,
  selected,
  highlight = false,
  onToggle,
}: InterestCategoryCardProps) {
  const { t } = useTranslation();
  // Custom die-cut sticker per category; fall back to the emoji if the art is missing.
  const [stickerFailed, setStickerFailed] = useState(false);
  const [minIconFailed, setMinIconFailed] = useState(false);
  const { style } = useFeedStyle();

  // Minimal style — quiet card with a flat mono pictogram (emoji fallback).
  if (style === "minimal") {
    return (
      <button
        type="button"
        onClick={() => {
          hapticSelection();
          onToggle();
        }}
        className={cn(
          "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
          selected
            ? "border-sky-400 bg-sky-950/40"
            : highlight
              ? "animate-ring-pulse border-zinc-800 bg-zinc-950"
              : "border-zinc-800 bg-zinc-950 hover:border-zinc-700",
        )}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center">
          {minIconFailed ? (
            <span className="text-2xl">{emoji}</span>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/categories-min/${slug}.png`}
              alt=""
              draggable={false}
              className={cn(
                "h-7 w-7 object-contain",
                selected ? "opacity-100" : "opacity-80",
              )}
              onError={() => setMinIconFailed(true)}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5">
              <span className="font-medium">{title}</span>
              {HOT_SLUGS.has(slug) ? (
                <span className="text-sm leading-none">🔥</span>
              ) : null}
            </span>
            {selected ? <span className="text-sky-400">✓</span> : null}
          </span>
          {description ? (
            <span className="mt-1 block text-xs text-zinc-500">{description}</span>
          ) : null}
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        hapticSelection();
        onToggle();
      }}
      className={cn(
        "group relative flex w-full items-center gap-3.5 overflow-hidden rounded-3xl p-3.5 text-left transition-all duration-200 active:scale-[0.98]",
        selected
          ? "bg-white/[0.07] shadow-[0_0_0_2px_var(--color-splash-violet),0_8px_24px_-8px_rgba(139,92,255,0.55)]"
          : highlight
            ? "animate-ring-pulse bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
            : "bg-white/[0.03] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] hover:bg-white/[0.05]",
      )}
    >
      {/* Splash glow wash behind the sticker when picked. */}
      {selected ? (
        <span className="bg-splash pointer-events-none absolute -left-6 -top-6 h-24 w-24 rounded-full opacity-25 blur-2xl" />
      ) : null}

      <span
        className={cn(
          "relative grid h-14 w-14 shrink-0 place-items-center rounded-2xl transition-transform duration-200",
          "bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
          selected ? "scale-105" : "group-hover:scale-105",
        )}
      >
        {stickerFailed ? (
          <span className="text-2xl">{emoji}</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/categories/${slug}.png`}
            alt=""
            className="h-12 w-12 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
            draggable={false}
            onError={() => setStickerFailed(true)}
          />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="font-display text-[15px] font-semibold leading-tight">
            {title}
          </span>
          {HOT_SLUGS.has(slug) ? (
            <svg
              width="13"
              height="16"
              viewBox="0 0 13 16"
              fill="none"
              className="shrink-0"
              aria-label={t("onboarding.interestCard.popular")}
            >
              <path
                d="M6.5 0.5c2.4 2.3 1 4.2 2 5 1-0.4 1.3-1.6 1.2-2.6 1.7 1.5 2.8 3.8 2.8 6.1 0 3.4-2.8 6-6.3 6S0 12.4 0 9c0-2 .9-3.3 2-4.4-.2 1.3.3 2.3 1.2 2.6.9-1.1-.4-3.9 2.3-6.7Z"
                fill="url(#hot-flame)"
              />
              <defs>
                <linearGradient id="hot-flame" x1="0" y1="0" x2="13" y2="16">
                  <stop stopColor="#FFD23D" />
                  <stop offset="0.5" stopColor="#FF6B5E" />
                  <stop offset="1" stopColor="#FF2E93" />
                </linearGradient>
              </defs>
            </svg>
          ) : null}
        </span>
        {description ? (
          <span className="mt-1 block text-xs leading-snug text-zinc-400">
            {description}
          </span>
        ) : null}
      </span>

      {/* Selection check — Splash-filled pill, empty ring when unpicked. */}
      <span
        className={cn(
          "relative grid h-7 w-7 shrink-0 place-items-center rounded-full transition-all duration-200",
          selected
            ? "bg-splash scale-100"
            : "scale-90 shadow-[inset_0_0_0_2px_rgba(255,255,255,0.18)]",
        )}
      >
        {selected ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M5 12.5 10 17.5 19 7"
              stroke="white"
              strokeWidth="2.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </span>
    </button>
  );
}
