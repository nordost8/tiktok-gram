import { isTelegramWebAppAvailable } from "./webapp";

export interface SharePostOptions {
  preparedMessageId: string | null;
  shareUrl: string;
  title: string;
}

function canUseShareMessage(): boolean {
  const webApp = window.Telegram?.WebApp;
  if (!webApp?.shareMessage) return false;
  if (webApp.isVersionAtLeast && !webApp.isVersionAtLeast("8.0")) return false;
  return true;
}

function shareMessageNative(preparedMessageId: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      window.Telegram?.WebApp?.shareMessage?.(preparedMessageId, (sent) => {
        resolve(!!sent);
      });
    } catch {
      resolve(false);
    }
  });
}

async function shareFallback(shareUrl: string, title: string): Promise<boolean> {
  try {
    if (navigator.share) {
      await navigator.share({ url: shareUrl, title });
      return true;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return false;
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    return true;
  } catch {
    return false;
  }
}

/** Telegram's native dialog (shareMessage), or Web Share / clipboard. */
export async function sharePost(options: SharePostOptions): Promise<boolean> {
  if (typeof window === "undefined") return false;

  if (
    isTelegramWebAppAvailable() &&
    options.preparedMessageId &&
    canUseShareMessage()
  ) {
    const sent = await shareMessageNative(options.preparedMessageId);
    if (sent) return true;
  }

  return shareFallback(options.shareUrl, options.title);
}
