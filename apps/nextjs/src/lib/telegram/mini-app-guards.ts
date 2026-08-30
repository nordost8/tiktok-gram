import { closingBehavior, swipeBehavior } from "@telegram-apps/sdk-react";

/** Guard against swipe-down (close) and confirm closing; portrait only (Bot API 8.0+). */
export function applyTelegramMiniAppGuards(): void {
  try {
    if (swipeBehavior.mount.isAvailable()) {
      swipeBehavior.mount();
    }
    if (swipeBehavior.disableVertical.isAvailable()) {
      swipeBehavior.disableVertical();
    }

    if (closingBehavior.mount.isAvailable()) {
      closingBehavior.mount();
    }
    if (closingBehavior.enableConfirmation.isAvailable()) {
      closingBehavior.enableConfirmation();
    }
  } catch {
    // SDK unavailable — fallback below
  }

  try {
    const webApp = window.Telegram?.WebApp;
    if (!webApp) return;

    webApp.disableVerticalSwipes?.();
    webApp.enableClosingConfirmation?.();

    if (webApp.isVersionAtLeast?.("8.0")) {
      webApp.lockOrientation?.();
    }
  } catch (e) {
    console.warn("[Telegram] mini app guards failed", e);
  }
}

/** Inline for beforeInteractive — the same set as in web3islands index.html */
export const TELEGRAM_MINI_APP_GUARDS_INLINE = `
window.addEventListener("DOMContentLoaded", function () {
  try {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.disableVerticalSwipes?.();
      window.Telegram.WebApp.enableClosingConfirmation?.();
      if (window.Telegram.WebApp.isVersionAtLeast && window.Telegram.WebApp.isVersionAtLeast("8.0")) {
        window.Telegram.WebApp.lockOrientation?.();
      }
    }
  } catch (e) {
    console.warn("[WebApp] early init failed", e);
  }
});
`;
