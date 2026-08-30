export function isTelegramWebAppAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const initData = window.Telegram?.WebApp?.initData;
  return Boolean(initData && initData.length > 0);
}

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: {
          user?: {
            id: number;
            first_name?: string;
            last_name?: string;
            username?: string;
            allows_write_to_pm?: boolean;
          };
          /** Deeplink payload from t.me/<bot>/<app>?startapp=<start_param>. */
          start_param?: string;
        };
        ready: () => void;
        expand: () => void;
        close: () => void;
        HapticFeedback?: {
          impactOccurred: (style: string) => void;
          notificationOccurred: (type: string) => void;
          selectionChanged: () => void;
        };
        version: string;
        platform: string;
        colorScheme: string;
        themeParams: Record<string, string>;
        isExpanded: boolean;
        viewportHeight: number;
        viewportStableHeight: number;
        disableVerticalSwipes?: () => void;
        enableClosingConfirmation?: () => void;
        lockOrientation?: () => void;
        isVersionAtLeast?: (version: string) => boolean;
        shareMessage?: (
          preparedMessageId: string,
          callback?: (sent: boolean) => void,
        ) => void;
        requestWriteAccess?: (callback?: (granted: boolean) => void) => void;
        BackButton?: {
          isVisible: boolean;
          show: () => void;
          hide: () => void;
          onClick: (callback: () => void) => void;
          offClick: (callback: () => void) => void;
        };
      };
    };
  }
}
