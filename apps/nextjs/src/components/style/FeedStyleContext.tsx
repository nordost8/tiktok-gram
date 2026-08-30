"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

/**
 * Two visual identities the user can switch between:
 *  - "pop": the vibrant Pop-Kiosk look (sticker art, Splash gradients, display font)
 *  - "minimal": the original quiet dark theme (line icons, mono pictograms, plain type)
 *
 * Self-contained (no `next-themes`): the pre-paint no-flash attribute is written
 * by a `beforeInteractive` boot script in the root layout, this context just
 * mirrors + mutates it. We avoided next-themes because its inline `<script>` is
 * rendered inside the React tree, which trips React 19's "script tag while
 * rendering" dev error. The attribute is the single source of truth on <html>;
 * CSS keys off `[data-feed-style]`, components read it via `useFeedStyle()`.
 */
export type FeedStyle = "pop" | "minimal";

export const FEED_STYLE_STORAGE_KEY = "feed-style";
export const FEED_STYLE_ATTRIBUTE = "data-feed-style";
export const DEFAULT_FEED_STYLE: FeedStyle = "pop";

function isFeedStyle(value: string | null | undefined): value is FeedStyle {
  return value === "pop" || value === "minimal";
}

/** Current style from the <html> attribute (set pre-paint by the boot script). */
function readCurrentStyle(): FeedStyle {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute(FEED_STYLE_ATTRIBUTE);
    if (isFeedStyle(attr)) return attr;
  }
  return DEFAULT_FEED_STYLE;
}

interface FeedStyleContextValue {
  style: FeedStyle;
  setStyle: (style: FeedStyle) => void;
}

const FeedStyleContext = createContext<FeedStyleContextValue | null>(null);

export function FeedStyleProvider({ children }: { children: React.ReactNode }) {
  // Seed straight from the attribute the pre-paint boot script wrote. Safe as a
  // render-time read because this provider only mounts client-side, after
  // TelegramGuard (which renders null until mounted) — it never SSRs, so there's
  // no hydration mismatch and no wrong-theme flash.
  const [style, setStyleState] = useState<FeedStyle>(readCurrentStyle);

  useEffect(() => {
    // Keep in sync if another tab/webview changes the stored style.
    const onStorage = (e: StorageEvent) => {
      if (e.key === FEED_STYLE_STORAGE_KEY && isFeedStyle(e.newValue)) {
        document.documentElement.setAttribute(FEED_STYLE_ATTRIBUTE, e.newValue);
        setStyleState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setStyle = useCallback((next: FeedStyle) => {
    setStyleState(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute(FEED_STYLE_ATTRIBUTE, next);
    }
    try {
      localStorage.setItem(FEED_STYLE_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode / disabled) — attribute still set.
    }
  }, []);

  return (
    <FeedStyleContext.Provider value={{ style, setStyle }}>
      {children}
    </FeedStyleContext.Provider>
  );
}

export function useFeedStyle(): FeedStyleContextValue {
  const ctx = useContext(FeedStyleContext);
  if (ctx) return ctx;
  // Resilient fallback if a consumer renders outside the provider.
  return { style: readCurrentStyle(), setStyle: () => undefined };
}
