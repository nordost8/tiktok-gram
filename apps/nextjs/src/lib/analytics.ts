import posthog from "posthog-js";

/** Fire-and-forget PostHog event. Never throws. */
export function trackEvent(event: string, props?: Record<string, unknown>) {
  try {
    if (typeof window !== "undefined") {
      posthog.capture(event, props);
    }
  } catch {
    // analytics must never break the app
  }
}
