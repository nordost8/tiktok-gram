"use client";

import { createContext, useState } from "react";
import type { ReactNode, RefCallback } from "react";

export const FramePortalContext = createContext<HTMLElement | null>(null);

interface AppFrameProps {
  children: ReactNode;
}

/**
 * Desktop/tablet frame wrapper:
 * - On wide screens (>=540px), centers a 440px-wide phone-like column.
 * - Sides get a subtle backdrop (pop gradient tint vs minimal near-black).
 * - Establishes a containing block via transform so all `position:fixed`
 *   descendants (DeeplinkPostOverlay, Popup overlays, etc.) pin to the frame.
 * - Below 540px: full 100vw so mobile is byte-identical to before.
 * - Exposes the frame element via context for Radix portals (Popup etc).
 */
export function AppFrame({ children }: AppFrameProps) {
  const [frameEl, setFrameEl] = useState<HTMLElement | null>(null);

  // Callback ref to capture the frame element for portals and containing block.
  const frameRef: RefCallback<HTMLDivElement> = (el) => {
    setFrameEl(el);
  };

  return (
    <FramePortalContext.Provider value={frameEl}>
      <div className="app-frame-backdrop flex min-h-[100dvh] w-full items-center justify-center">
        <div
          ref={frameRef}
          className="app-frame relative flex h-dvh flex-col overflow-hidden bg-black"
          // Inline width is bulletproof: full-width on phones, capped at 440px on
          // bigger screens (centered, with the backdrop showing on the sides).
          // transform makes this a containing block so fixed overlays pin to the frame.
          style={{ width: "100%", maxWidth: 440, transform: "translateZ(0)" }}
        >
          {children}
        </div>
      </div>
    </FramePortalContext.Provider>
  );
}
