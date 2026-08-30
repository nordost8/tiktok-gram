import { NextResponse } from "next/server";

import { db } from "@tiktok-gram/db/client";
import { mediaEvents } from "@tiktok-gram/db/schema";

/**
 * Client→server beacon for media-display outcomes, persisted FOREVER.
 *
 * Video bytes are served directly from R2 (presigned URLs); the Pi never proxies
 * them. So when a video fails in someone's Telegram WebView we have no server
 * access log for it — this beacon is the only signal. We therefore:
 *   1. INSERT every event into the permanent `media_events` table (survives
 *      container recreation, log rotation, and profile deletion), and
 *   2. ALSO emit a structured stdout line so it's greppable live:
 *        docker logs tiktok-gram-web 2>&1 | grep media-event
 *
 * NOTE: in practice only failures arrive here — reportMediaEvent beacons errors
 * only, sending successes to PostHog instead (a row per view would be far too
 * much write traffic for the Pi). So this table is a failure log, NOT a source
 * for success rates; use the PostHog `media_shown` event for the denominator.
 */
export const runtime = "nodejs";

interface MediaEventBody {
  outcome?: "shown" | "error";
  postId?: string;
  mediaId?: string;
  mediaType?: string;
  channel?: string;
  cacheStatus?: string | null;
  reason?: string;
  srcKind?: string;
  mediaUrl?: string;
  attempt?: number;
  loadMs?: number;
  mediaErrorCode?: number;
  mediaErrorMessage?: string;
  afterShown?: boolean;
}

/** Strip the query string so we never persist presigned R2 signatures. */
function redactUrl(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

function clampStr(v: unknown, max: number): string | null {
  if (typeof v !== "string" || v.length === 0) return null;
  return v.length > max ? v.slice(0, max) : v;
}

function clampInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** Failure detail + caller identity for the jsonb `extra` column (null if empty). */
function buildExtra(
  body: MediaEventBody,
  profileHeader: string | null,
): Record<string, unknown> | null {
  const extra: Record<string, unknown> = {};
  if (profileHeader) extra.telegramUserId = profileHeader;
  const code = clampInt(body.mediaErrorCode);
  if (code !== null) extra.mediaErrorCode = code;
  const message = clampStr(body.mediaErrorMessage, 512);
  if (message) extra.mediaErrorMessage = message;
  if (typeof body.afterShown === "boolean") extra.afterShown = body.afterShown;
  return Object.keys(extra).length > 0 ? extra : null;
}

export async function POST(req: Request) {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!parsed || typeof parsed !== "object") {
    return new NextResponse(null, { status: 204 });
  }
  const body = parsed as MediaEventBody;

  const userAgent = req.headers.get("user-agent");
  const profileHeader = req.headers.get("x-telegram-user-id");

  const row = {
    profileId: null as string | null,
    outcome: body.outcome === "shown" ? "shown" : "error",
    postId: clampStr(body.postId, 128),
    mediaId: clampStr(body.mediaId, 128),
    mediaType: clampStr(body.mediaType, 16),
    channel: clampStr(body.channel, 256),
    cacheStatus: clampStr(body.cacheStatus, 32),
    reason: clampStr(body.reason, 256),
    srcKind: clampStr(body.srcKind, 32),
    mediaUrl: redactUrl(body.mediaUrl),
    attempt: clampInt(body.attempt),
    loadMs: clampInt(body.loadMs),
    userAgent: clampStr(userAgent, 512),
    // `extra` is jsonb, so failure detail lands here without a migration. The
    // MediaError code is what makes a beacon actually diagnosable — see the
    // comment on MediaEventInput.mediaErrorCode.
    extra: buildExtra(body, profileHeader),
  };

  const line = { tag: "media-event", ...row, ts: new Date().toISOString() };
  if (row.outcome === "error") {
    console.error("[media-event]", JSON.stringify(line));
  } else {
    console.info("[media-event]", JSON.stringify(line));
  }

  // Persist permanently. Telemetry must never break the client → swallow errors.
  try {
    await db.insert(mediaEvents).values(row);
  } catch (err) {
    console.error(
      "[media-event] persist_failed",
      JSON.stringify({
        mediaId: row.mediaId,
        err: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return new NextResponse(null, { status: 204 });
}
