"use client";

import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useTRPC } from "~/trpc/react";
import { useAppConfig } from "~/components/app/AppConfigProvider";
import { LOCAL_ANONYMOUS_ID_KEY } from "~/lib/telegram/constants";
import {
  HAPTIC_ENABLED_KEY,
  isHapticEnabled,
  setHapticEnabled,
} from "~/lib/telegram/settings";
import { allowsWriteToPm, requestWriteAccess } from "~/lib/telegram/write-access";
import { trackEvent } from "~/lib/analytics";
import { invalidateFeedQueries } from "~/lib/trpc/invalidate-app-queries";
import { useFeedStyle } from "~/components/style/FeedStyleContext";
import { StylePicker } from "~/components/style/StylePicker";
import {
  Popup,
  PopupActions,
  PopupClose,
  PopupContent,
  useTelegramBackButton,
} from "~/components/ui/Popup";

interface SettingsScreenProps {
  onBack: () => void;
  onEditInterests: () => void;
}

export function SettingsScreen({ onBack, onEditInterests }: SettingsScreenProps) {
  const { t } = useTranslation();
  const { supportUrl, locale } = useAppConfig();
  const [haptic, setHaptic] = useState(true);
  const [wipeHintOpen, setWipeHintOpen] = useState(false);
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
  const [notify, setNotify] = useState<"granted" | "idle" | "requested">("idle");
  const { style, setStyle } = useFeedStyle();
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const hiddenQuery = useQuery(trpc.channels.listHidden.queryOptions());

  const unhideMutation = useMutation(
    trpc.channels.unhideChannel.mutationOptions({
      onSuccess: () => {
        void hiddenQuery.refetch();
        invalidateFeedQueries(queryClient, trpc);
      },
    }),
  );

  useEffect(() => {
    setHaptic(isHapticEnabled());
    if (allowsWriteToPm()) setNotify("granted");
  }, []);

  const closeWipeHint = useCallback(() => setWipeHintOpen(false), []);
  const closeWipeConfirm = useCallback(() => setWipeConfirmOpen(false), []);

  useTelegramBackButton(wipeHintOpen, closeWipeHint);
  useTelegramBackButton(wipeConfirmOpen, closeWipeConfirm);

  const clearLocalData = () => {
    localStorage.removeItem(LOCAL_ANONYMOUS_ID_KEY);
    localStorage.removeItem(HAPTIC_ENABLED_KEY);
    window.location.reload();
  };

  const wipeMutation = useMutation(
    trpc.onboarding.resetEverything.mutationOptions({
      onSettled: () => {
        // Local identifiers gone too, so the next launch starts fresh.
        try {
          localStorage.clear();
        } catch {
          // ignore
        }
        window.location.reload();
      },
    }),
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="flex items-center justify-center border-b border-zinc-900 px-4 py-4">
        <h1 className="text-lg font-semibold">{t("settings.title")}</h1>
      </header>

      <div className="min-h-0 flex-1 divide-y divide-zinc-900 overflow-y-auto px-4">
        <label className="flex items-center justify-between py-4 text-sm">
          <span>{t("settings.haptic")}</span>
          <input
            type="checkbox"
            checked={haptic}
            onChange={(e) => {
              setHaptic(e.target.checked);
              setHapticEnabled(e.target.checked);
            }}
          />
        </label>
        <div className="flex items-center justify-between gap-3 py-4 text-sm">
          <div className="min-w-0">
            <p>{t("settings.notifications.title")}</p>
            <p className="text-zinc-500">
              {notify === "granted"
                ? t("settings.notifications.granted")
                : notify === "requested"
                  ? t("settings.notifications.requested")
                  : t("settings.notifications.idle")}
            </p>
          </div>
          {notify === "granted" ? (
            <span className="shrink-0 text-xs font-semibold text-zinc-500">
              {t("settings.notifications.enabledBadge")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNotify("requested");
                requestWriteAccess((granted) => setNotify(granted ? "granted" : "idle"));
              }}
              className={
                "shrink-0 rounded-full px-3 py-1 text-xs font-bold text-white " +
                (style === "pop" ? "bg-splash" : "bg-sky-500")
              }
            >
              {t("settings.notifications.allow")}
            </button>
          )}
        </div>
        <div className="py-4 text-sm">
          <p>{t("settings.language.title")}</p>
          <p className="text-zinc-500">
            {locale === "uk" ? t("settings.language.uk") : t("settings.language.en")}
          </p>
        </div>
        <div className="py-4 text-sm">
          <p>{t("settings.appearance.title")}</p>
          <p className="text-zinc-500">{t("settings.appearance.subtitle")}</p>
          <StylePicker
            value={style}
            onPick={(next) => {
              setStyle(next);
              trackEvent("style_selected", { style: next, where: "settings" });
            }}
            className="mt-3"
          />
        </div>
        <button type="button" onClick={onEditInterests} className="w-full py-4 text-left text-sm">
          {t("profile.editInterests")}
        </button>

        <div className="py-4 text-sm">
          <p className="font-medium">{t("settings.hiddenChannels.title")}</p>
          <p className="mt-1 text-zinc-500">
            {t("settings.hiddenChannels.description")}
          </p>
          {hiddenQuery.isLoading ? (
            <p className="mt-3 text-zinc-500">{t("common.loading")}</p>
          ) : (hiddenQuery.data?.length ?? 0) === 0 ? (
            <p className="mt-3 text-zinc-600">{t("settings.hiddenChannels.none")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {hiddenQuery.data?.map((ch) => (
                <li
                  key={ch.id}
                  className="flex items-center justify-between gap-3 rounded-xl bg-zinc-950 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{ch.title}</p>
                    <p className="truncate text-xs text-zinc-500">@{ch.username}</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-full bg-zinc-800 px-3 py-1 text-xs font-semibold text-white"
                    onClick={() => unhideMutation.mutate({ channelId: ch.id })}
                  >
                    {t("settings.hiddenChannels.show")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" onClick={clearLocalData} className="w-full py-4 text-left text-sm text-zinc-300">
          {t("settings.clearLocalData")}
        </button>

        {/* Full server-side wipe — destructive, two-step confirm. */}
        <div className="py-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWipeConfirmOpen(true)}
              className="text-left text-sm font-medium text-red-500"
            >
              {t("settings.resetAll")}
            </button>
            <button
              type="button"
              onClick={() => setWipeHintOpen(true)}
              aria-label={t("settings.resetAllHintAriaLabel")}
              aria-expanded={wipeHintOpen}
              className="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-zinc-400 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.25)]"
            >
              ?
            </button>
          </div>
        </div>
        {supportUrl ? (
          <a href={supportUrl} target="_blank" rel="noreferrer" className="block py-4 text-sm text-sky-400">
            {t("profile.support")}
          </a>
        ) : null}
        <p className="py-4 text-xs text-zinc-600">{t("settings.version")}</p>
      </div>

      {/* Hint popup (replaces inline ? text) */}
      <Popup open={wipeHintOpen} onOpenChange={setWipeHintOpen}>
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
            <p className="text-xs leading-relaxed text-zinc-300">
              {t("settings.resetAllHintText")}
            </p>
          </div>
        </PopupContent>
      </Popup>

      {/* Destructive reset confirm (replaces inline red box) */}
      <Popup open={wipeConfirmOpen} onOpenChange={setWipeConfirmOpen}>
        <PopupContent variant="center">
          <p className="text-xs leading-relaxed text-zinc-300">
            {t("settings.resetAllConfirmText")}
          </p>
          <PopupActions className="mt-3">
            <button
              type="button"
              disabled={wipeMutation.isPending}
              onClick={() => wipeMutation.mutate()}
              className="flex-1 rounded-full bg-red-500 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {wipeMutation.isPending ? t("settings.resetAllConfirming") : t("settings.resetAllConfirmYes")}
            </button>
            <button
              type="button"
              disabled={wipeMutation.isPending}
              onClick={() => setWipeConfirmOpen(false)}
              className="flex-1 rounded-full bg-white/[0.06] py-2.5 text-sm font-medium text-zinc-300"
            >
              {t("settings.resetAllCancel")}
            </button>
          </PopupActions>
        </PopupContent>
      </Popup>
    </div>
  );
}
