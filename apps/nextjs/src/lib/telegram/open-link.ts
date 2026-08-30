/** Open a t.me / telegram post — via the Telegram WebApp SDK first. */
export function openTelegramLink(url: string) {
  if (typeof window === "undefined") return;
  const webApp = window.Telegram?.WebApp as
    | { openTelegramLink?: (url: string) => void; openLink?: (url: string) => void }
    | undefined;

  try {
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
      return;
    }
    if (webApp?.openLink) {
      webApp.openLink(url);
      return;
    }
  } catch {
    // dev fallback
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
