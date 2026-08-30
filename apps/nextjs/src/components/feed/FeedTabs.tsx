"use client";

import { useTranslation } from "react-i18next";

import { cn } from "@tiktok-gram/ui";

import type { FeedTab } from "./types";

interface FeedTabsProps {
  value: FeedTab;
  onChange: (tab: FeedTab) => void;
}

export function FeedTabs({ value, onChange }: FeedTabsProps) {
  const { t } = useTranslation();
  const items: { id: FeedTab; label: string }[] = [
    { id: "forYou", label: t("feed.tabs.forYou") },
    { id: "subscriptions", label: t("feed.tabs.subscriptions") },
  ];

  return (
    <div className="flex items-center justify-center gap-6">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            "pb-1 text-sm font-medium transition-colors",
            value === item.id
              ? "border-b-2 border-white text-white"
              : "text-zinc-500",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
