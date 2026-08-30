"use client";

import { LOCAL_ANONYMOUS_ID_KEY } from "./constants";
import { isTelegramWebAppAvailable } from "./webapp";
import type { AppProfileContext } from "./types";
import { getMessage } from "~/lib/i18n";
import type { Locale } from "~/lib/i18n";

/**
 * This module runs outside the React tree (plain browser code, not a
 * component), so it has no access to the AppConfigProvider context. The
 * `<html lang>` attribute is set server-side from env.LOCALE (see
 * app/layout.tsx) and is always present by the time this runs, so it doubles
 * as this module's locale source.
 */
function currentLocale(): Locale {
  return document.documentElement.lang === "uk" ? "uk" : "en";
}

function createLocalAnonymousId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `local_${crypto.randomUUID()}`;
  }
  return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getOrCreateLocalAnonymousId(): string {
  const existing = localStorage.getItem(LOCAL_ANONYMOUS_ID_KEY);
  if (existing) return existing;
  const id = createLocalAnonymousId();
  localStorage.setItem(LOCAL_ANONYMOUS_ID_KEY, id);
  return id;
}

function getTelegramUserId(): string | null {
  const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
  if (!user?.id) return null;
  return String(user.id);
}

/** Client profile for tRPC headers (Telegram Mini App or local browser). */
export function getAppProfileContext(): AppProfileContext {
  if (typeof window === "undefined") {
    return {
      profileId: "",
      telegramUserId: null,
      localAnonymousId: null,
      source: "local",
      displayName: null,
      username: null,
      photoUrl: null,
    };
  }

  if (isTelegramWebAppAvailable()) {
    const telegramUserId = getTelegramUserId();
    if (telegramUserId) {
      const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
      return {
        profileId: telegramUserId,
        telegramUserId,
        localAnonymousId: null,
        source: "telegram",
        displayName: [user?.first_name, user?.last_name].filter(Boolean).join(" "),
        username: user?.username ?? null,
        photoUrl: (user as { photo_url?: string } | undefined)?.photo_url ?? null,
      };
    }
  }

  const localAnonymousId = getOrCreateLocalAnonymousId();
  return {
    profileId: localAnonymousId,
    telegramUserId: null,
    localAnonymousId,
    source: "local",
    displayName: getMessage(currentLocale(), "profile.localViewName"),
    username: null,
    photoUrl: null,
  };
}
