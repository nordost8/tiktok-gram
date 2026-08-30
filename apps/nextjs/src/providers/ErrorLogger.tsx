"use client";

import { useEffect } from "react";

function sendError(data: Record<string, unknown>) {
  try {
    void fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    });
  } catch {
    // never throw from error handler
  }
}

export function ErrorLogger() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      sendError({
        msg: event.message,
        stack: event.error instanceof Error ? event.error.stack : undefined,
        url: event.filename,
        line: event.lineno,
        col: event.colno,
      });
    };

    const onUnhandled = (event: PromiseRejectionEvent) => {
      const reason = event.reason as unknown;
      sendError({
        msg: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandled);
    };
  }, []);

  return null;
}
