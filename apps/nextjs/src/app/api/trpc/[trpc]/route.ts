import type { NextRequest } from "next/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { appRouter, createTRPCContext } from "@tiktok-gram/api";
import { logger } from "~/lib/logger";
import { getPresignedMediaUrl } from "~/lib/media/object-storage";

const setCorsHeaders = (res: Response) => {
  res.headers.set("Access-Control-Allow-Origin", "*");
  res.headers.set("Access-Control-Request-Method", "*");
  res.headers.set("Access-Control-Allow-Methods", "OPTIONS, GET, POST");
  res.headers.set("Access-Control-Allow-Headers", "*");
};

export const OPTIONS = () => {
  const response = new Response(null, { status: 204 });
  setCorsHeaders(response);
  return response;
};

const handler = async (req: NextRequest) => {
  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    router: appRouter,
    req,
    createContext: () =>
      createTRPCContext({
        headers: req.headers,
        // Ready video bytes are served DIRECTLY from R2 via presigned URLs — the
        // Raspberry Pi must never proxy media bytes (it can't be a CDN). Signing
        // is cheap and stays on the Pi; the actual download goes client→R2.
        resolveMediaUrl: getPresignedMediaUrl,
      }),
    onError({ error, path }) {
      logger.error("[trpc]", { path, code: error.code, msg: error.message, stack: error.cause instanceof Error ? error.cause.stack : undefined });
    },
  });

  setCorsHeaders(response);
  return response;
};

export { handler as GET, handler as POST };
