export const HAPTIC_ENABLED_KEY = "tiktok_gram_haptic_enabled";

export function isHapticEnabled(): boolean {
  if (typeof window === "undefined") return true;
  const value = localStorage.getItem(HAPTIC_ENABLED_KEY);
  return value !== "false";
}

export function setHapticEnabled(enabled: boolean) {
  localStorage.setItem(HAPTIC_ENABLED_KEY, enabled ? "true" : "false");
}
