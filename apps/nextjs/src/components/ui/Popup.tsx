"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { cn } from "@tiktok-gram/ui";
import { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { FramePortalContext } from "~/components/app/AppFrame";

/**
 * Reusable Popup system built on Radix Dialog + Pop-Kiosk styling.
 * - Popup: controlled root
 * - PopupContent: variant "sheet" (default, bottom) or "center"
 * - Grabber bar + rounded-t-3xl for sheets
 * - Backdrop: bg-black/60 + backdrop-blur-sm
 * - Safe area + consistent zinc surface
 * - Respects [data-feed-style="minimal"] via absence of splash classes
 */

export interface PopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Popup({ open, onOpenChange, children }: PopupProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {children}
    </Dialog.Root>
  );
}

export interface PopupContentProps
  extends React.ComponentPropsWithoutRef<typeof Dialog.Content> {
  variant?: "sheet" | "center";
}

export function PopupContent({
  variant = "sheet",
  className,
  children,
  ...props
}: PopupContentProps) {
  const isSheet = variant === "sheet";
  const frameEl = useContext(FramePortalContext);

  return (
    <Dialog.Portal container={frameEl ?? undefined}>
      <Dialog.Overlay
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
      />
      <Dialog.Content
        className={cn(
          "fixed z-[60] bg-zinc-950 text-white outline-none focus:outline-none",
          isSheet
            ? [
                "inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
              ]
            : [
                "left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-3xl",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
                "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
              ],
          className
        )}
        {...props}
      >
        {isSheet && (
          <div className="mx-auto mt-3 h-1 w-12 shrink-0 rounded-full bg-zinc-700" />
        )}
        <div
          className={cn(
            isSheet
              ? "flex-1 overflow-y-auto px-5 pb-8 pt-4 safe-area-padding"
              : "p-5"
          )}
        >
          {children}
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function PopupTitle({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Title>) {
  return (
    <Dialog.Title
      className={cn("mb-2 text-lg font-semibold", className)}
      {...props}
    />
  );
}

export function PopupDescription({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Dialog.Description>) {
  return (
    <Dialog.Description
      className={cn("text-sm leading-relaxed text-zinc-300", className)}
      {...props}
    />
  );
}

export function PopupClose(props: React.ComponentProps<typeof Dialog.Close>) {
  return <Dialog.Close {...props} />;
}

export function PopupActions({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex gap-2", className)} {...props} />;
}

/**
 * Convenience helper for small "?" info popups (centered card).
 * Usage:
 *   <PopupHint open={open} onOpenChange={setOpen}>
 *     Your hint text here.
 *   </PopupHint>
 */
export function PopupHint({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Popup open={open} onOpenChange={onOpenChange}>
      <PopupContent variant="center">
        <div className="relative pr-6">
          <PopupClose asChild>
            <button
              type="button"
              aria-label={t("common.close")}
              className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center text-zinc-400 active:text-white"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </PopupClose>
          <PopupDescription className="mt-1">{children}</PopupDescription>
        </div>
      </PopupContent>
    </Popup>
  );
}

/**
 * Wires Telegram WebApp BackButton while `open` is true.
 * Call with the popup's open state and a closer:
 *   useTelegramBackButton(open, () => onOpenChange(false));
 */
export function useTelegramBackButton(open: boolean, onClose: () => void) {
  useEffect(() => {
    const backButton = window.Telegram?.WebApp?.BackButton;
    if (!backButton) return;

    if (open) {
      backButton.show();
      backButton.onClick(onClose);
      return () => {
        backButton.offClick(onClose);
        backButton.hide();
      };
    } else {
      backButton.hide();
    }
  }, [open, onClose]);
}
