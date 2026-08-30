import type { CSSProperties } from "react";
import type { Metadata, Viewport } from "next";
import { Unbounded } from "next/font/google";
import Script from "next/script";

import { cn } from "@tiktok-gram/ui";

import { TRPCReactProvider } from "~/trpc/react";
import { PostHogProvider } from "~/providers/PostHogProvider";
import { ErrorLogger } from "~/providers/ErrorLogger";
import { AppConfigProvider } from "~/components/app/AppConfigProvider";
import { getMessage } from "~/lib/i18n";
import { env } from "~/env";

import "~/app/styles.css";

/**
 * Origin that serves video bytes (R2 presigned URLs come from S3_ENDPOINT).
 * Videos stream client→R2 directly, so the very first play pays a full cold
 * DNS+TLS handshake to this cross-origin host — warming the socket ahead of
 * time removes ~1s from first-video startup. One host covers every presigned
 * URL (forcePathStyle), so a single preconnect warms the whole session.
 */
const mediaOrigin = (() => {
  try {
    return env.S3_ENDPOINT ? new URL(env.S3_ENDPOINT).origin : null;
  } catch {
    return null;
  }
})();

/** Display face — bold, distinctive, full Cyrillic. Used with restraint for headings/brand. */
const displayFont = Unbounded({
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

export function generateMetadata(): Metadata {
  return {
    title: getMessage(env.LOCALE, "app.title"),
    description: getMessage(env.LOCALE, "app.description"),
  };
}

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

/** Telegram WebApp / @telegram-apps SDK sets these on `<html>` before React hydrates. */
const telegramViewportStyle = {
  "--tg-viewport-height": "100vh",
  "--tg-viewport-stable-height": "100vh",
} as CSSProperties;

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang={env.LOCALE} className={cn("dark", displayFont.variable)} style={telegramViewportStyle} suppressHydrationWarning>
      <head>
        {/* Warm the R2 media host before the first <video> mounts — plays stream
            direct client→R2, so a cold cross-origin handshake here is the main
            cause of first-video startup lag. No `crossOrigin` on purpose: the
            <video> request is non-CORS, so the warmed socket must match. */}
        {mediaOrigin ? (
          <>
            <link rel="preconnect" href={mediaOrigin} />
            <link rel="dns-prefetch" href={mediaOrigin} />
          </>
        ) : null}
      </head>
      <body className={cn("min-h-full bg-black font-sans text-white")} suppressHydrationWarning>
        {/* Telegram SDK must run before hydration so `window.Telegram.WebApp.initData`
            is set when TelegramGuard's mount effect reads it. `beforeInteractive`
            injects it into the initial <head> (executes before React hydrates) —
            same guarantee as a raw sync <script>, but without the raw-<script>
            React warning / no-sync-scripts lint error. */}
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
        {/* Pre-paint feed-style boot (replaces next-themes' inline script): apply
            the saved "pop"/"minimal" identity to <html> before React renders so
            there's no flash. `beforeInteractive` runs before hydration, and being
            a next/script (not a raw React <script>) it avoids the React 19
            "script tag while rendering" warning. */}
        <Script id="feed-style-boot" strategy="beforeInteractive">
          {`(function(){try{var v=localStorage.getItem('feed-style');if(v!=='pop'&&v!=='minimal'){v='pop';}document.documentElement.setAttribute('data-feed-style',v);}catch(e){document.documentElement.setAttribute('data-feed-style','pop');}})();`}
        </Script>
        <AppConfigProvider locale={env.LOCALE} supportUrl={env.SUPPORT_URL ?? null}>
          <PostHogProvider>
            <ErrorLogger />
            <TRPCReactProvider>{props.children}</TRPCReactProvider>
          </PostHogProvider>
        </AppConfigProvider>
      </body>
    </html>
  );
}
