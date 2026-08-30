"use client";

import { useEffect, useState } from "react";

export function TelegramGuard({ children }: { children: React.ReactNode }) {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      setAllowed(true);
      return;
    }
    // telegram-web-app.js loads sync in <head>, so initData is available here
    setAllowed(!!window.Telegram?.WebApp?.initData);
  }, []);

  if (!allowed) return null;
  return <>{children}</>;
}
