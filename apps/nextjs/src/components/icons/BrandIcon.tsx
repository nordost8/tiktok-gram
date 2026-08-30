"use client";

import type { SvgIconProps } from "@thesvg/react";
import { cn } from "@tiktok-gram/ui";
import type { ComponentType } from "react";

interface BrandIconProps extends SvgIconProps {
  icon: ComponentType<SvgIconProps>;
  /** Render as white glyph on dark UI (default). */
  mono?: boolean;
  size?: number;
}

export function BrandIcon({
  icon: Icon,
  className,
  mono = true,
  size = 22,
  ...props
}: BrandIconProps) {
  return (
    <Icon
      width={size}
      height={size}
      className={cn(mono && "brightness-0 invert", className)}
      {...props}
    />
  );
}
