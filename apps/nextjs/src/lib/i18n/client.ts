import i18next from "i18next";
import type { i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import { MESSAGES } from "./index";
import type { Locale } from "./index";

let instance: I18nInstance | null = null;
let initializedLocale: Locale | null = null;

/**
 * Get (and lazily initialize) the i18next instance for `locale`.
 *
 * The locale is fixed for the lifetime of a deployment (see env.ts LOCALE) —
 * this is not a runtime language switcher — so a single module-level
 * instance, initialized once on first use, is all that's needed. Both
 * server-side rendering and client hydration call this with the same
 * `locale` prop (threaded down from the root layout via AppConfigProvider),
 * so there is no hydration mismatch.
 */
export function getI18n(locale: Locale): I18nInstance {
  if (instance && initializedLocale === locale) return instance;

  instance ??= i18next.createInstance().use(initReactI18next);

  void instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: MESSAGES.en },
      uk: { translation: MESSAGES.uk },
    },
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  initializedLocale = locale;
  return instance;
}
