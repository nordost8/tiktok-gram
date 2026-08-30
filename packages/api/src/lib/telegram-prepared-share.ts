type PreparedInlineMessageResponse = {
  ok: boolean;
  result?: { id: string };
  description?: string;
};

export type PreparedSharePayload = {
  postId: string;
  channelTitle: string;
  telegramUrl: string;
  text: string | null;
  caption: string | null;
  /** Post has a TikTok track → offer the "with music" deeplink too. */
  hasAudio?: boolean;
  /** Primary media type is photo (no video/animation selected as primary). */
  isPhoto: boolean;
};

/**
 * Mini App deeplink base, e.g. `https://t.me/<bot>/<app>`. When set, shared
 * messages carry "open in tiktok-gram" buttons (?startapp=post_<id> / postm_<id>).
 * Unset → no buttons (unchanged behaviour).
 */
function deeplinkBase(): string | null {
  const base = process.env.TELEGRAM_MINIAPP_DEEPLINK?.trim();
  return base ? base.replace(/\/+$/, "") : null;
}

/** Escape for Telegram HTML parse_mode (text + attribute-safe). */
function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * This package doesn't depend on apps/nextjs's i18n catalog (that would
 * invert the workspace dependency direction), so these few strings are kept
 * local, keyed off the same LOCALE env var the web app reads (see
 * apps/nextjs/src/env.ts).
 */
const isUk = process.env.LOCALE === "uk";
const SHARE_TEXT = isUk
  ? {
      openPlain: "Переглянути в Моя Стрічка",
      openMusic: "🎵 Переглянути з музичним супроводом",
      fallbackTitle: "Моя стрічка",
      fallbackDescription: (channelTitle: string) => `Пост у ${channelTitle}`,
    }
  : {
      openPlain: "Open in tiktok-gram",
      openMusic: "🎵 Open with music",
      fallbackTitle: "tiktok-gram",
      fallbackDescription: (channelTitle: string) => `Post in ${channelTitle}`,
    };

function buildInlineArticle(payload: PreparedSharePayload) {
  const snippet = (payload.caption ?? payload.text ?? "").trim().slice(0, 200);

  // HTML message — the deeplink LABELS are the hyperlinks (no bare URL shown).
  const parts: string[] = [];
  if (snippet) parts.push(escHtml(snippet));
  // Source URL kept so the shared message renders the original post preview.
  parts.push(escHtml(payload.telegramUrl));

  const base = deeplinkBase();
  if (base) {
    const plain = `${base}?startapp=post_${payload.postId}`;
    const music = `${base}?startapp=postm_${payload.postId}`;
    const linkPlain = `<a href="${escHtml(plain)}">${SHARE_TEXT.openPlain}</a>`;
    const linkMusic = `<a href="${escHtml(music)}">${SHARE_TEXT.openMusic}</a>`;
    const hasAudio = !!payload.hasAudio;
    const links: string[] = [];
    if (payload.isPhoto) {
      // Photo post → single link only (music if available, else plain).
      links.push(hasAudio ? linkMusic : linkPlain);
    } else {
      links.push(linkPlain);
      if (hasAudio) links.push(linkMusic);
    }
    parts.push(links.join("\n"));
  }

  return {
    type: "article",
    id: payload.postId,
    title: payload.channelTitle.slice(0, 64) || SHARE_TEXT.fallbackTitle,
    description: snippet || SHARE_TEXT.fallbackDescription(payload.channelTitle),
    input_message_content: {
      message_text: parts.join("\n\n").slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: false,
    },
    url: payload.telegramUrl,
  };
}

/** Bot API 8.0+ — prepared message id for WebApp.shareMessage */
export async function createPreparedShareMessage(
  telegramUserId: string,
  payload: PreparedSharePayload,
): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return null;

  const userId = Number.parseInt(telegramUserId, 10);
  if (!Number.isFinite(userId)) return null;

  const body = {
    user_id: userId,
    result: buildInlineArticle(payload),
    allow_user_chats: true,
    allow_bot_chats: false,
    allow_group_chats: true,
    allow_channel_chats: true,
  };

  const res = await fetch(
    `https://api.telegram.org/bot${token}/savePreparedInlineMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  const data = (await res.json()) as PreparedInlineMessageResponse;
  if (!data.ok || !data.result?.id) {
    console.warn(
      "[telegram] savePreparedInlineMessage failed:",
      data.description ?? res.status,
    );
    return null;
  }

  return data.result.id;
}
