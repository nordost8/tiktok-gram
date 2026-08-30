"use client";

import { useState } from "react";

import { cn } from "@tiktok-gram/ui";

interface StickerIconProps {
  /** File name (without extension) under /public/ui. */
  name: string;
  size?: number;
  className?: string;
  /** Rendered if the generated art is missing — keeps the UI safe pre-generation. */
  fallback?: React.ReactNode;
  /** Dim + desaturate, e.g. an inactive bottom-nav tab. */
  dim?: boolean;
}

/**
 * Renders a generated die-cut sticker icon from /public/ui, with a vector
 * fallback. Lets us ship the art-icon look while staying resilient if a PNG
 * hasn't been generated yet.
 */
export function StickerIcon({
  name,
  size = 28,
  className,
  fallback,
  dim = false,
}: StickerIconProps) {
  const [failed, setFailed] = useState(false);

  if (failed && fallback !== undefined) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/ui/${name}.png`}
      width={size}
      height={size}
      alt=""
      draggable={false}
      aria-hidden
      className={cn(
        "object-contain transition-all duration-200",
        dim && "opacity-45 grayscale",
        className,
      )}
      onError={() => setFailed(true)}
    />
  );
}
