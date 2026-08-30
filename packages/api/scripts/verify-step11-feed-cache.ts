/**
 * Verify feed DTO exposes cacheStatus on primaryMedia.
 */
const BASE = process.env.API_BASE ?? "http://127.0.0.1:3000";
const PROFILE = process.env.VERIFY_PROFILE ?? `verify-step11-feed-${Date.now()}`;

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
    items: {
      id: string;
      primaryMedia: { url: string; cacheStatus?: string | null };
    }[];
  }>("feed.forYou", { limit: 10 });

  if (!feed.items.length) {
    throw new Error("feed empty");
  }

  const withStatus = feed.items.filter(
    (item) => item.primaryMedia.cacheStatus != null,
  );
  if (withStatus.length === 0) {
    throw new Error("primaryMedia.cacheStatus missing on all feed items");
  }

  const statuses = new Set(
    feed.items.map((item) => item.primaryMedia.cacheStatus),
  );

  console.log(
    JSON.stringify({
      ok: true,
      feedItems: feed.items.length,
      withCacheStatus: withStatus.length,
      statuses: [...statuses],
      sample: feed.items.slice(0, 3).map((item) => ({
        cacheStatus: item.primaryMedia.cacheStatus,
        url: item.primaryMedia.url,
      })),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
