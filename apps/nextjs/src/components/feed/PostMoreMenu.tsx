"use client";

import { useTranslation } from "react-i18next";

interface PostMoreMenuProps {
  open: boolean;
  isAdmin: boolean;
  onClose: () => void;
  onGoToChannel: () => void;
  onOpenTelegram: () => void;
  onHideChannel: () => void;
  onDownload?: () => void;
  onDebug?: () => void;
}

export function PostMoreMenu({
  open,
  isAdmin,
  onClose,
  onGoToChannel,
  onOpenTelegram,
  onHideChannel,
  onDownload,
  onDebug,
}: PostMoreMenuProps) {
  const { t } = useTranslation();

  if (!open) return null;

  const item =
    "block w-full rounded-xl px-4 py-3 text-left text-sm active:bg-white/5";

  return (
    <div
      className="absolute inset-0 z-50 flex items-end bg-black/50 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full rounded-2xl bg-zinc-900 p-2"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t("feed.postMoreMenu.aria")}
      >
        <button
          type="button"
          className={`${item} font-medium text-white`}
          onClick={() => {
            onClose();
            onHideChannel();
          }}
        >
          {t("feed.postMoreMenu.hideChannel")}
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            onClose();
            onOpenTelegram();
          }}
        >
          {t("feed.actions.openInTelegram")}
        </button>
        <button
          type="button"
          className={item}
          onClick={() => {
            onClose();
            onGoToChannel();
          }}
        >
          {t("feed.postMoreMenu.goToChannel")}
        </button>
        {onDownload ? (
          <button
            type="button"
            className={`${item} text-zinc-400`}
            onClick={() => {
              onClose();
              onDownload();
            }}
          >
            {t("feed.postMoreMenu.download")}
          </button>
        ) : null}
        {isAdmin && onDebug ? (
          <button
            type="button"
            className={`${item} text-amber-400`}
            onClick={() => {
              onClose();
              onDebug();
            }}
          >
            Debug info
          </button>
        ) : null}
        <button
          type="button"
          className="mt-1 block w-full rounded-xl px-4 py-3 text-center text-sm text-zinc-400"
          onClick={onClose}
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
