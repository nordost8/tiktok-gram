import { env } from "~/env";
import { getMessage } from "~/lib/i18n";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Deployment-wide LOCALE, not the Telegram user's own `language_code` — a
// more sophisticated version could greet each user in their own language,
// but that's out of scope for this deliberately simple bot handler.
const WELCOME_TEXT = getMessage(env.LOCALE, "bot.welcome");

function miniAppUrl(): string | null {
  const siteUrl = env.SITE_URL;
  return siteUrl ? `${siteUrl.replace(/\/$/, "")}/telegram` : null;
}

async function sendMessage(chatId: number, text: string) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const webAppUrl = miniAppUrl();
  if (!token || !webAppUrl) return;

  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [[
          {
            text: getMessage(env.LOCALE, "bot.openButton"),
            web_app: { url: webAppUrl },
          },
        ]],
      },
    }),
  });
}

export async function POST(request: Request) {
  try {
    const update = await request.json() as {
      message?: { chat: { id: number }; text?: string };
      callback_query?: { message: { chat: { id: number } } };
    };

    const chatId =
      update.message?.chat.id ??
      update.callback_query?.message.chat.id;

    if (chatId) {
      await sendMessage(chatId, WELCOME_TEXT);
    }

    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 200 });
  }
}
