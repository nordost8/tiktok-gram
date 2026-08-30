"use client";

import { createContext, useContext, useState } from "react";

const MUTE_KEY = "tiktok_gram_feed_muted";
const MUTE_DEFAULT_VERSION_KEY = "tiktok_gram_feed_mute_default_version";
const SOUND_ON_DEFAULT_VERSION = "sound-on-v1";

const FeedMuteContext = createContext<{
  muted: boolean;
  toggleMuted: () => void;
} | null>(null);

function getInitialMuted() {
  if (typeof window === "undefined") return false;

  try {
    if (
      sessionStorage.getItem(MUTE_DEFAULT_VERSION_KEY) !==
      SOUND_ON_DEFAULT_VERSION
    ) {
      sessionStorage.setItem(MUTE_KEY, "false");
      sessionStorage.setItem(
        MUTE_DEFAULT_VERSION_KEY,
        SOUND_ON_DEFAULT_VERSION,
      );
      return false;
    }

    return sessionStorage.getItem(MUTE_KEY) === "true";
  } catch {
    return false;
  }
}

export function FeedMuteProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMuted] = useState(getInitialMuted);

  const toggleMuted = () => {
    setMuted((value) => {
      const next = !value;
      try {
        sessionStorage.setItem(MUTE_KEY, next ? "true" : "false");
        sessionStorage.setItem(
          MUTE_DEFAULT_VERSION_KEY,
          SOUND_ON_DEFAULT_VERSION,
        );
      } catch {
        // Ignore storage failures; the in-memory state still updates.
      }
      return next;
    });
  };

  return (
    <FeedMuteContext.Provider value={{ muted, toggleMuted }}>
      {children}
    </FeedMuteContext.Provider>
  );
}

export function useFeedMute() {
  const ctx = useContext(FeedMuteContext);
  if (!ctx) {
    throw new Error("useFeedMute must be used within FeedMuteProvider");
  }
  return ctx;
}
