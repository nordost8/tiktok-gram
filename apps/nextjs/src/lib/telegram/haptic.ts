import { isHapticEnabled } from "./settings";

export function hapticImpact(style: "light" | "medium" | "heavy" = "light") {
  if (typeof window === "undefined" || !isHapticEnabled()) return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.impactOccurred(style);
  } catch {
    // ignore in dev browser
  }
}

export function hapticSelection() {
  if (typeof window === "undefined" || !isHapticEnabled()) return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.selectionChanged();
  } catch {
    // ignore
  }
}

export function hapticNotification(type: "error" | "success" | "warning") {
  if (typeof window === "undefined" || !isHapticEnabled()) return;
  try {
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred(type);
  } catch {
    // ignore
  }
}
