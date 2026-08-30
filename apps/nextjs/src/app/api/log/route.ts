import { logger } from "~/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FrontendErrorPayload {
  msg?: string;
  stack?: string;
  url?: string;
  userId?: string;
  [key: string]: unknown;
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as FrontendErrorPayload;
    logger.error("[frontend]" + (body.msg ? " " + body.msg : ""), {
      source: "frontend",
      ...body,
    });
  } catch {
    // ignore malformed payloads
  }
  return Response.json({ ok: true });
}
