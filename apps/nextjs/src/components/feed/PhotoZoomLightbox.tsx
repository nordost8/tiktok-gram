"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface PhotoZoomLightboxProps {
  src: string;
  open: boolean;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function PhotoZoomLightbox({ src, open, onClose }: PhotoZoomLightboxProps) {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pinchRef = useRef({
    active: false,
    startDist: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
    panning: false,
    lastX: 0,
    lastY: 0,
  });

  useEffect(() => {
    if (open) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    }
  }, [open, src]);

  const clampScale = (v: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const [a, b] = [e.touches[0]!, e.touches[1]!];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        pinchRef.current = {
          ...pinchRef.current,
          active: true,
          startDist: dist,
          startScale: scale,
          panning: false,
          startX: offset.x,
          startY: offset.y,
          lastX: 0,
          lastY: 0,
        };
      } else if (e.touches.length === 1 && scale > 1) {
        const t = e.touches[0]!;
        pinchRef.current = {
          ...pinchRef.current,
          panning: true,
          lastX: t.clientX,
          lastY: t.clientY,
          startX: offset.x,
          startY: offset.y,
        };
      }
    },
    [offset.x, offset.y, scale],
  );

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current.active) {
      e.preventDefault();
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = clampScale(
        pinchRef.current.startScale * (dist / pinchRef.current.startDist),
      );
      setScale(next);
      if (next <= 1) setOffset({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && pinchRef.current.panning && scale > 1) {
      e.preventDefault();
      const t = e.touches[0]!;
      const dx = t.clientX - pinchRef.current.lastX;
      const dy = t.clientY - pinchRef.current.lastY;
      pinchRef.current.lastX = t.clientX;
      pinchRef.current.lastY = t.clientY;
      setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
    }
  }, [scale]);

  const onTouchEnd = useCallback(() => {
    pinchRef.current.active = false;
    pinchRef.current.panning = false;
    setScale((s) => {
      if (s < 1.05) {
        setOffset({ x: 0, y: 0 });
        return 1;
      }
      return s;
    });
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95"
      onClick={scale <= 1 ? onClose : undefined}
      role="presentation"
    >
      <button
        type="button"
        className="absolute right-4 top-4 z-[71] flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
        onClick={onClose}
        aria-label={t("feed.photoZoom.closeAria")}
      >
        ✕
      </button>
      <div
        className="h-full w-full touch-none"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="h-full w-full object-contain transition-transform duration-75"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          }}
          draggable={false}
        />
      </div>
      <p className="pointer-events-none absolute bottom-8 inset-x-0 text-center text-xs text-zinc-500">
        {t("feed.photoZoom.hint")}
      </p>
    </div>
  );
}

/** Single tap vs double-tap: double opens zoom, single fires `onSingleTap`. */
export function usePhotoTapHandler(onSingleTap?: () => void, onDoubleTap?: () => void) {
  const lastTapRef = useRef(0);

  return useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      lastTapRef.current = 0;
      onDoubleTap?.();
      return;
    }
    lastTapRef.current = now;
    window.setTimeout(() => {
      if (lastTapRef.current === now) {
        onSingleTap?.();
        lastTapRef.current = 0;
      }
    }, 280);
  }, [onDoubleTap, onSingleTap]);
}
