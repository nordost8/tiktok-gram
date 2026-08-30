"use client";

import { useEffect, useState } from "react";
import {
  init,
  isTMA,
  miniApp,
  retrieveLaunchParams,
  viewport,
} from "@telegram-apps/sdk-react";
import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import { hapticImpact } from "~/lib/telegram/haptic";
import { applyTelegramMiniAppGuards } from "~/lib/telegram/mini-app-guards";
import type { AppProfileContext } from "~/lib/telegram/types";
import { getAppProfileContext } from "~/lib/telegram/profile-context";

const TELEGRAM_WEB_APP_SCRIPT_ID = "telegram-web-app-sdk";
const TELEGRAM_WEB_APP_SCRIPT_SRC = "https://telegram.org/js/telegram-web-app.js";

interface TelegramMiniAppShellProps {
  children: React.ReactNode;
  className?: string;
  /** "none" — fullscreen without a built-in header (feed/onboarding) */
  chrome?: "default" | "none";
}

function loadTelegramWebAppScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.Telegram?.WebApp) return Promise.resolve();

  const existing = document.getElementById(TELEGRAM_WEB_APP_SCRIPT_ID);
  if (existing instanceof HTMLScriptElement) {
    return new Promise((resolve) => {
      if (window.Telegram?.WebApp) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => resolve(), { once: true });
    });
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = TELEGRAM_WEB_APP_SCRIPT_ID;
    script.src = TELEGRAM_WEB_APP_SCRIPT_SRC;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => resolve(), { once: true });
    document.head.appendChild(script);
  });
}

export function TelegramMiniAppShell({
  children,
  className,
  chrome = "default",
}: TelegramMiniAppShellProps) {
  const { t } = useTranslation();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<AppProfileContext | null>(null);
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    let mounted = true;

    const boot = async () => {
      try {
        await loadTelegramWebAppScript();
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.ready();
          if (!window.Telegram.WebApp.isExpanded) {
            window.Telegram.WebApp.expand();
          }
        }
        if (await isTMA()) {
          init();
          if (miniApp.ready.isAvailable()) {
            miniApp.ready();
          }
          applyTelegramMiniAppGuards();
          if (viewport.expand.isAvailable()) {
            viewport.expand();
          }
          try {
            retrieveLaunchParams();
          } catch {
            // optional
          }
          if (mounted) setIsTelegram(true);
        } else if (mounted) {
          setIsTelegram(false);
        }
      } catch {
        if (mounted) setIsTelegram(false);
      }

      if (mounted) {
        setProfile(getAppProfileContext());
        setReady(true);
      }
    };

    void boot();

    return () => {
      mounted = false;
    };
  }, []);

  const handleClose = () => {
    hapticImpact("light");
    try {
      if (miniApp.close.isAvailable()) {
        miniApp.close();
        return;
      }
    } catch {
      // dev fallback
    }
    window.history.back();
  };

  if (!ready || !profile) {
    return (
      <div
        className={cn("flex min-h-dvh items-center justify-center bg-black", className)}
        suppressHydrationWarning
      >
        <p className="text-sm text-zinc-400" suppressHydrationWarning>
          {t("common.loading")}
        </p>
      </div>
    );
  }

  if (chrome === "none") {
    return (
      <div
        className={cn(
          "flex h-dvh max-h-dvh flex-col overflow-hidden bg-black text-white safe-area-padding",
          className,
        )}
        data-telegram={isTelegram ? "true" : "false"}
        data-profile-id={profile.profileId}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col bg-black text-white safe-area-padding",
        className,
      )}
      data-telegram={isTelegram ? "true" : "false"}
      data-profile-id={profile.profileId}
    >
      <header className="flex shrink-0 items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={handleClose}
          className="text-sm text-zinc-300"
        >
          {t("common.close")}
        </button>
        <div className="text-center">
          <p className="text-sm font-medium">{t("app.title")}</p>
          <p className="text-[10px] text-zinc-500">{t("app.miniAppLabel")}</p>
        </div>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-300"
          aria-label={t("common.menu")}
        >
          ⋮
        </button>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
