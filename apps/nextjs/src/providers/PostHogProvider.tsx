"use client";

import { useEffect } from "react";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

import { getAppProfileContext } from "~/lib/telegram/profile-context";

if (typeof window !== "undefined") {
  posthog.init("phc_qjwqjHoi44do9DLQYwyWoaA4cdCzuVJkQC3CWDLKvN7E", {
    api_host: "https://us.i.posthog.com",
    defaults: "2026-01-30",
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
  });
  // Identify synchronously so NO events are sent before the person is known.
  // useEffect fires after first render — too late for autocapture, pageleave, etc.
  // Telegram WebApp SDK is loaded in <head> before JS bundles, so the user id
  // is already available here.
  const ctx = getAppProfileContext();
  if (ctx.telegramUserId) {
    posthog.identify(ctx.telegramUserId, {
      telegram_username: ctx.username ?? undefined,
      display_name: ctx.displayName ?? undefined,
    });
  } else if (ctx.localAnonymousId) {
    posthog.identify(ctx.localAnonymousId);
  }
}

function PostHogIdentify() {
  useEffect(() => {
    // Re-run identify to update person properties if they changed
    // (e.g. username set after initial load). The synchronous call above
    // already identified the user, so this is a no-op for new sessions.
    const ctx = getAppProfileContext();
    if (ctx.telegramUserId) {
      posthog.identify(ctx.telegramUserId, {
        telegram_username: ctx.username ?? undefined,
        display_name: ctx.displayName ?? undefined,
      });
    } else if (ctx.localAnonymousId) {
      posthog.identify(ctx.localAnonymousId);
    }
  }, []);
  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return (
    <PHProvider client={posthog}>
      <PostHogIdentify />
      {children}
    </PHProvider>
  );
}
