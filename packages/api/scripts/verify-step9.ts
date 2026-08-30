const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PROFILE =
  process.env.VERIFY_PROFILE ?? `verify-step9-${Date.now()}`;

async function trpc<T>(
  path: string,
  input?: unknown,
  method: "GET" | "POST" = "GET",
): Promise<T> {
  const url = new URL(`${BASE}/api/trpc/${path}`);
  if (method === "GET" && input !== undefined) {
    url.searchParams.set("input", JSON.stringify({ json: input }));
  }

  const res = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-local-anonymous-id": PROFILE,
    },
    body:
      method === "POST" && input !== undefined
        ? JSON.stringify({ json: input })
        : undefined,
  });

  const body = (await res.json()) as {
    result?: { data?: { json?: T } };
    error?: unknown;
  };

  if (!res.ok || body.error) {
    throw new Error(`tRPC ${path} failed: ${JSON.stringify(body)}`);
  }

  return body.result?.data?.json as T;
}

async function main() {
  const status = await trpc<{
    onboardingCompleted: boolean;
    availableInterests: { id: string }[];
  }>("onboarding.getStatus");

  if (!status.onboardingCompleted) {
    const ids = status.availableInterests.slice(0, 3).map((i) => i.id);
    await trpc("onboarding.saveInterests", { interestIds: ids }, "POST");
  }

  const feed = await trpc<{
    items: { id: string; primaryMedia: { url: string } }[];
  }>("feed.forYou", { limit: 5 });
  if (!feed.items.length) {
    throw new Error("feed empty — run pnpm telegram:collect babel");
  }
  if (!feed.items.every((i) => i.primaryMedia?.url?.startsWith("/api/media/"))) {
    throw new Error("feed must use /api/media/:id URLs");
  }

  const first = feed.items[0];
  if (!first) throw new Error("no feed items");

  await trpc("interactions.toggleLike", { postId: first.id }, "POST");
  await trpc("interactions.toggleSave", { postId: first.id }, "POST");

  const me = await trpc<{
    counters: { liked: number; saved: number };
    selectedInterests: unknown[];
  }>("profile.me");
  if (me.counters.liked < 1) throw new Error("like not reflected in profile.me");
  if (me.counters.saved < 1) throw new Error("save not reflected in profile.me");
  if (!Array.isArray(me.selectedInterests)) {
    throw new Error("profile.me missing selectedInterests");
  }

  const channels = await trpc<{ subscribed: boolean }[]>("channels.list");
  if (channels[0] && typeof channels[0].subscribed !== "boolean") {
    throw new Error("channels.list missing subscribed flag");
  }

  const ch = channels[0];
  if (ch) {
    const sub = await trpc<{ subscribed: boolean }>(
      "channels.toggleSubscribe",
      { channelId: ch.id },
      "POST",
    );
    if (typeof sub.subscribed !== "boolean") {
      throw new Error("toggleSubscribe invalid response");
    }
  }

  const buildCheck = await fetch(`${BASE}/telegram`);
  if (!buildCheck.ok) throw new Error(`/telegram status ${buildCheck.status}`);

  console.log(
    JSON.stringify({
      ok: true,
      step: 9,
      feedItems: feed.items.length,
      profileLiked: me.counters.liked,
      channelsWithSubscribed: channels.length,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
