const BASE = process.env.API_BASE ?? "http://localhost:3000";
const PROFILE = "verify-api-local-1";

async function trpc<T>(
  path: string,
  input?: unknown,
  method: "GET" | "POST" = "GET",
  withProfile = true,
): Promise<T> {
  const url = new URL(`${BASE}/api/trpc/${path}`);
  if (method === "GET" && input !== undefined) {
    url.searchParams.set(
      "input",
      JSON.stringify({ json: input }),
    );
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (withProfile) {
    headers["x-local-anonymous-id"] = PROFILE;
  }

  const res = await fetch(url, {
    method,
    headers,
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
  const ping = await trpc<{ ok: boolean }>("health.ping", undefined, "GET", false);
  if (!ping.ok) throw new Error("health.ping failed");

  const status1 = await trpc<{
    onboardingCompleted: boolean;
    availableInterests: { id: string }[];
  }>("onboarding.getStatus");

  if (status1.availableInterests.length !== 12) {
    throw new Error("Expected 12 interests");
  }

  const ids = status1.availableInterests.slice(0, 3).map((i) => i.id);

  try {
    await trpc("onboarding.saveInterests", { interestIds: ids.slice(0, 2) }, "POST");
    throw new Error("saveInterests should reject <3");
  } catch {
    // expected
  }

  await trpc("onboarding.saveInterests", { interestIds: ids }, "POST");

  const feed = await trpc<{
    items: { primaryMedia: { type: string } }[];
  }>("feed.forYou", { limit: 5 });

  if (feed.items.length === 0) throw new Error("feed.forYou returned no items");
  if (!feed.items[0]?.primaryMedia?.type) {
    throw new Error("feed item missing primaryMedia");
  }

  console.log(
    JSON.stringify({
      ok: true,
      feedItems: feed.items.length,
      onboardingCompleted: true,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
