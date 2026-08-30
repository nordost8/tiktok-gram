"use client";

import { cn } from "@tiktok-gram/ui";

interface StoryProgressBarsProps {
  total: number;
  activeIndex: number;
}

export function StoryProgressBars({ total, activeIndex }: StoryProgressBarsProps) {
  return (
    <div className="flex gap-1 px-4 pt-2">
      {Array.from({ length: total }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "h-0.5 flex-1 rounded-full transition-colors",
            index <= activeIndex ? "bg-white" : "bg-zinc-700",
          )}
        />
      ))}
    </div>
  );
}
