import { env } from "~/env";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const siteUrl = env.SITE_URL;
  if (!token || !siteUrl) return;

  const webhookUrl = `${siteUrl.replace(/\/$/, "")}/api/bot/webhook`;

  try {
    const info = await fetch(
      `https://api.telegram.org/bot${token}/getWebhookInfo`,
    ).then((r) => r.json()) as { result?: { url?: string } };

    const current = info.result?.url ?? "";
    if (current === webhookUrl) {
      console.log("[bot] webhook already set:", webhookUrl);
      return;
    }

    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: webhookUrl }),
      },
    ).then((r) => r.json());

    if ((res as { ok?: boolean }).ok) {
      console.log("[bot] webhook registered →", webhookUrl);
    } else {
      console.error("[bot] setWebhook failed:", res);
    }
  } catch (e) {
    console.error("[bot] webhook setup error:", e);
  }
}
