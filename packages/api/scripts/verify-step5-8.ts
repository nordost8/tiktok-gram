const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PROFILE = process.env.VERIFY_PROFILE ?? "verify-ui-local";

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

  const feed = await trpc<{ items: unknown[] }>("feed.forYou", { limit: 3 });
  if (feed.items.length === 0) throw new Error("feed empty");

  const channels = await trpc<unknown[]>("channels.list");
  if (!channels.length) throw new Error("channels.list empty");

  const me = await trpc<{ counters: { saved: number } }>("profile.me");
  if (typeof me.counters.saved !== "number") throw new Error("profile.me invalid");

  const page = await fetch(`${BASE}/telegram`);
  if (!page.ok) throw new Error(`/telegram status ${page.status}`);

  console.log(
    JSON.stringify({
      ok: true,
      feedItems: feed.items.length,
      channels: channels.length,
      pageStatus: page.status,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
