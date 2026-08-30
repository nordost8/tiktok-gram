"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { useTRPC } from "~/trpc/react";
import { trackEvent } from "~/lib/analytics";

interface SuggestChannelScreenProps {
  onBack: () => void;
  /**
   * Already-translated label for the closing button. Defaults to
   * `profile.suggestChannel.backToProfile` — the default is computed inside
   * the component body (not as a literal default parameter value) because
   * `t()` isn't available until after hooks run.
   */
  backLabel?: string;
}

export function SuggestChannelScreen({ onBack, backLabel }: SuggestChannelScreenProps) {
  const { t } = useTranslation();
  const label = backLabel ?? t("profile.suggestChannel.backToProfile");
  const trpc = useTRPC();
  const [text, setText] = useState("");
  const [contact, setContact] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation(
    trpc.profile.suggestChannel.mutationOptions({
      onSuccess: () => { setSubmitted(true); trackEvent("channel_suggested"); },
    }),
  );

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    mutation.mutate({ text: trimmed, contact: contact.trim() || undefined });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      <header className="flex shrink-0 items-center justify-center border-b border-zinc-900 px-4 py-4">
        <h1 className="text-lg font-semibold">{t("profile.suggestChannel.title")}</h1>
      </header>

      {/* overflow-hidden keeps the page from resizing when the soft keyboard opens */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-6">
        {submitted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="relative flex h-28 w-28 items-center justify-center">
              <span className="splash-glow bg-splash absolute inset-2 rounded-full opacity-30 blur-2xl" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/onboarding/success-cheers.png"
                alt=""
                draggable={false}
                className="relative h-28 w-28 object-contain drop-shadow-[0_10px_24px_rgba(0,0,0,0.5)]"
              />
            </div>
            <p className="font-display text-lg font-bold">{t("profile.suggestChannel.thanks")}</p>
            <p className="text-sm text-zinc-400">
              {t("profile.suggestChannel.reviewNotice")}
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-4 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black"
            >
              {label}
            </button>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-400">
              {t("profile.suggestChannel.intro")}
            </p>
            {/*
              font-size must be ≥ 16px on iOS to prevent the browser from
              zooming the viewport when the textarea is focused.
            */}
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("profile.suggestChannel.channelPlaceholder")}
              rows={5}
              maxLength={500}
              style={{ fontSize: "16px" }}
              className="w-full resize-none rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />
            <p className="mt-1 text-right text-xs text-zinc-600">{text.length}/500</p>

            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t("profile.suggestChannel.contactPlaceholder")}
              maxLength={128}
              style={{ fontSize: "16px" }}
              className="mt-3 w-full rounded-2xl border border-zinc-800 bg-zinc-950 px-4 py-3 text-white placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
            />

            <button
              type="button"
              disabled={!text.trim() || mutation.isPending}
              onClick={handleSubmit}
              className="mt-4 w-full rounded-full bg-white py-3 text-sm font-semibold text-black disabled:opacity-40"
            >
              {mutation.isPending ? t("profile.suggestChannel.sending") : t("profile.suggestChannel.submit")}
            </button>
            {mutation.isError ? (
              <p className="mt-2 text-center text-xs text-red-400">
                {t("profile.suggestChannel.error")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
