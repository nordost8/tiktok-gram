"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { useFeedStyle } from "~/components/style/FeedStyleContext";

/** How far the whole feed UI slides down to reveal this panel. */
export const PULL_PX = 184;

interface FeedPullPanelProps {
  open: boolean;
  onOpenHistory: () => void;
}

// Deterministic celestial field (fixed so SSR/CSR match). x/y in %, size in px,
// d=delay, t=duration, n=sprite name (white PNGs in /public/ui/stars).
const STARS = [
  { x: 11, y: 24, s: 26, d: 0, t: 5.5, n: "star-spark" },
  { x: 24, y: 60, s: 17, d: 0.8, t: 6.5, n: "sparkle-mini" },
  { x: 35, y: 18, s: 34, d: 1.6, t: 7, n: "saturn" },
  { x: 47, y: 70, s: 20, d: 0.4, t: 6, n: "star-five" },
  { x: 57, y: 22, s: 24, d: 1.1, t: 5.8, n: "comet" },
  { x: 69, y: 62, s: 22, d: 2, t: 7.2, n: "star-burst" },
  { x: 80, y: 28, s: 30, d: 0.6, t: 6.8, n: "planet" },
  { x: 90, y: 56, s: 18, d: 1.4, t: 5.6, n: "moon" },
  { x: 5, y: 64, s: 16, d: 2.3, t: 6.3, n: "sparkle-mini" },
  { x: 63, y: 14, s: 16, d: 0.2, t: 5.9, n: "star-five" },
  { x: 94, y: 22, s: 22, d: 1.3, t: 6.6, n: "star-burst" },
];

/**
 * Panel revealed behind the feed when the user pulls down at the first post.
 * Sits at the top; the feed "stage" slides over it (FeedScreen owns the motion).
 * Stars drift slowly only while open. Content springs in for an Apple-like feel.
 */
export function FeedPullPanel({ open, onOpenHistory }: FeedPullPanelProps) {
  const { t } = useTranslation();
  const { style } = useFeedStyle();
  const pop = style === "pop";

  return (
    <div
      className="absolute inset-x-0 top-0 z-0 overflow-hidden"
      style={{ height: PULL_PX }}
      aria-hidden={!open}
    >
      {/* soft glow backdrop */}
      <div
        className={cn(
          "absolute inset-0",
          pop
            ? "bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(255,46,147,0.18),transparent_60%)]"
            : "bg-[radial-gradient(120%_90%_at_50%_-10%,rgba(255,255,255,0.08),transparent_60%)]",
        )}
      />

      {/* drifting celestial doodles — only animate while open */}
      {open &&
        STARS.map((st, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={`/ui/stars/${st.n}.png`}
            alt=""
            aria-hidden
            draggable={false}
            className="pull-star absolute"
            style={{
              left: `${st.x}%`,
              top: `${st.y}%`,
              width: st.s,
              height: st.s,
              animationDuration: `${st.t}s`,
              animationDelay: `${st.d}s`,
            }}
          />
        ))}

      {/* content — vertically centered; springs in (scale + fade + slight rise) when open */}
      <div
        className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center"
        style={{
          transform: open ? "translateY(0) scale(1)" : "translateY(10px) scale(0.96)",
          opacity: open ? 1 : 0,
          transition:
            "transform 520ms cubic-bezier(0.34,1.56,0.64,1) 60ms, opacity 320ms ease 60ms",
        }}
      >
        <p className="text-[15px] font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.7)]">
          {t("feed.pullPanel.title")}
        </p>
        <p className="mt-0.5 text-[13px] text-white/65">{t("feed.pullPanel.orTap")}</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenHistory();
          }}
          className={cn(
            "mt-1 text-[14px] font-bold underline-offset-4 active:opacity-70",
            pop ? "text-pop-lime underline decoration-pop-lime/50" : "text-white underline decoration-white/50",
          )}
        >
          {t("feed.pullPanel.historyLink")}
        </button>
      </div>
    </div>
  );
}
