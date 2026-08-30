import { isTelegramWebAppAvailable } from "./webapp";

const WRITE_ACCESS_PROMPTED_KEY = "tiktok_gram_write_access_prompted";

/** True if the user already lets the bot DM them (state as of app launch). */
export function allowsWriteToPm(): boolean {
  if (typeof window === "undefined") return false;
  const user = window.Telegram?.WebApp?.initDataUnsafe.user as
    | { allows_write_to_pm?: boolean }
    | undefined;
  return !!user?.allows_write_to_pm;
}

export function canRequestWriteAccess(): boolean {
  if (typeof window === "undefined") return false;
  const webApp = window.Telegram?.WebApp;
  if (!webApp?.requestWriteAccess) return false;
  if (webApp.isVersionAtLeast && !webApp.isVersionAtLeast("6.9")) return false;
  return true;
}

function markPrompted(): void {
  try {
    localStorage.setItem(WRITE_ACCESS_PROMPTED_KEY, "1");
  } catch {
    // storage may be unavailable
  }
}

/**
 * Show Telegram's native write-access popup (the official way to let the bot DM
 * the user). Marks the prompted flag and forwards the grant result to `cb`.
 */
export function requestWriteAccess(cb?: (granted: boolean) => void): void {
  markPrompted();
  const request = window.Telegram?.WebApp?.requestWriteAccess;
  if (typeof request !== "function") {
    cb?.(false);
    return;
  }
  try {
    request((granted) => cb?.(granted));
  } catch {
    cb?.(false);
  }
}

/** Once, on the first profile visit — permission for the bot to DM the user. */
export function requestWriteAccessOnFirstProfileVisit(): void {
  if (typeof window === "undefined") return;
  if (!isTelegramWebAppAvailable()) return;
  if (localStorage.getItem(WRITE_ACCESS_PROMPTED_KEY)) return;
  if (allowsWriteToPm() || !canRequestWriteAccess()) {
    markPrompted();
    return;
  }
  requestWriteAccess();
}
