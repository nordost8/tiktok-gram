import type { Metadata, Viewport } from "next";

import { getMessage } from "~/lib/i18n";
import { env } from "~/env";

export function generateMetadata(): Metadata {
  return {
    title: getMessage(env.LOCALE, "app.title"),
    description: "Telegram Mini App",
  };
}

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
};

export default function TelegramLayout(props: { children: React.ReactNode }) {
  return props.children;
}
