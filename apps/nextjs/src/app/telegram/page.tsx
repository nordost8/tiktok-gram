"use client";

import { TelegramApp } from "~/components/app/TelegramApp";
import { TelegramGuard } from "~/components/telegram/TelegramGuard";
import { AppFrame } from "~/components/app/AppFrame";

export default function TelegramPage() {
  return (
    <TelegramGuard>
      <AppFrame>
        <TelegramApp />
      </AppFrame>
    </TelegramGuard>
  );
}
