"use client";

import { createContext, useContext, useMemo } from "react";
import { I18nextProvider } from "react-i18next";

import { getI18n } from "~/lib/i18n/client";
import type { Locale } from "~/lib/i18n";

interface AppConfig {
  locale: Locale;
  /** Optional support/community link (see env.ts SUPPORT_URL). `null` hides it. */
  supportUrl: string | null;
}

const AppConfigContext = createContext<AppConfig | null>(null);

/**
 * Threads server-read env config (locale, support URL) down into the client
 * component tree, and wires up react-i18next for the whole app.
 *
 * WHY this exists instead of reading env vars directly in client components:
 * `NEXT_PUBLIC_*` vars get inlined into the client bundle at `next build`
 * time, which would need a rebuild per locale under this project's
 * build-once-deploy-many Docker setup. Reading them here, in the server-only
 * root layout, and passing the resolved values as props means a plain
 * container restart (new env, same image) is enough.
 */
export function AppConfigProvider({
  locale,
  supportUrl,
  children,
}: AppConfig & { children: React.ReactNode }) {
  const i18n = useMemo(() => getI18n(locale), [locale]);
  const config = useMemo<AppConfig>(() => ({ locale, supportUrl }), [locale, supportUrl]);

  return (
    <AppConfigContext.Provider value={config}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </AppConfigContext.Provider>
  );
}

export function useAppConfig(): AppConfig {
  const ctx = useContext(AppConfigContext);
  if (!ctx) {
    throw new Error("useAppConfig must be used within AppConfigProvider");
  }
  return ctx;
}
