"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { useAppConfig } from "~/components/app/AppConfigProvider";
import { formatRelativeTime } from "./feed-utils";

export function RelativeTime({ iso }: { iso: string }) {
  const { t } = useTranslation();
  const { locale } = useAppConfig();
  const [label, setLabel] = useState("");

  useEffect(() => {
    setLabel(formatRelativeTime(iso, locale, t));
  }, [iso, locale, t]);

  return <span suppressHydrationWarning>{label || "…"}</span>;
}
