"use client";

import { useEffect, useRef, useState } from "react";

interface ClampedTextProps {
  text: string;
  /** Max visible lines before truncating with an ellipsis. */
  lines?: number;
  className?: string;
}

/**
 * JS-based multi-line ellipsis that works in EVERY browser/webview (incl. the
 * Telegram Mini App), without relying on `-webkit-line-clamp`.
 *
 * It measures the real text in a hidden clone (same width + font) and binary-
 * searches the longest prefix that fits `lines` rows, then appends "…".
 * Re-measures on container resize.
 */
export function ClampedText({ text, lines = 2, className }: ClampedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const compute = () => {
      const width = el.clientWidth;
      if (!width) return;

      const cs = getComputedStyle(el);
      const lh =
        parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35 || 18;
      const maxH = lh * lines + 1;

      // Hard visual cap regardless of JS timing.
      el.style.maxHeight = `${maxH}px`;
      el.style.overflow = "hidden";

      // Hidden measurer with the same width + typography.
      const m = document.createElement("span");
      m.style.cssText = [
        "position:absolute",
        "left:-99999px",
        "top:0",
        "visibility:hidden",
        "white-space:normal",
        `width:${width}px`,
        `font-family:${cs.fontFamily}`,
        `font-size:${cs.fontSize}`,
        `font-weight:${cs.fontWeight}`,
        `line-height:${cs.lineHeight}`,
        `letter-spacing:${cs.letterSpacing}`,
        `word-break:${cs.wordBreak}`,
      ].join(";");
      document.body.appendChild(m);

      const chars = Array.from(text); // code-point safe (don't split emoji surrogates)
      m.textContent = text;

      let result = text;
      if (m.scrollHeight > maxH) {
        let lo = 0;
        let hi = chars.length;
        let best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          m.textContent = chars.slice(0, mid).join("").trimEnd() + "…";
          if (m.scrollHeight <= maxH) {
            best = mid;
            lo = mid + 1;
          } else {
            hi = mid - 1;
          }
        }
        result = chars.slice(0, best).join("").trimEnd() + "…";
      }

      document.body.removeChild(m);
      setDisplay(result);
    };

    // Run after paint (not synchronously in the effect) — measure DOM, then commit.
    const raf = requestAnimationFrame(compute);
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text, lines]);

  return (
    <span ref={ref} className={className} style={{ display: "block", overflow: "hidden" }}>
      {display}
    </span>
  );
}
