import en from "./messages/en.json";
import uk from "./messages/uk.json";

export type Locale = "en" | "uk";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "uk"];

export const MESSAGES: Record<Locale, Record<string, unknown>> = { en, uk };

function getPath(obj: Record<string, unknown>, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>(
      (node, key) =>
        typeof node === "object" && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      obj,
    );
  return typeof value === "string" ? value : undefined;
}

/**
 * Server-only translation helper for places that never render as a React
 * client component (generateMetadata, route handlers, plain server modules).
 * Client components should use `useTranslation()` from react-i18next instead
 * (see AppConfigProvider) so they participate in the normal i18next
 * interpolation/pluralization machinery.
 */
export function getMessage(locale: Locale, key: string): string {
  return getPath(MESSAGES[locale], key) ?? getPath(MESSAGES.en, key) ?? key;
}
