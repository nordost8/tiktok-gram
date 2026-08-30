import type { NextRequest } from "next/server";

import {
  enqueueMediaCacheJob,
  shouldEnqueueMediaCache,
} from "~/lib/media/enqueue-media-cache";
import {
  loadMediaForStream,
  type MediaStreamContext,
} from "~/lib/media/load-media";
import { loadMediaBlobFromPostgres } from "~/lib/media/load-postgres-blob";
import { parseRangeHeader } from "~/lib/media/media-range";
import {
  isCachedObjectReady,
  isObjectStorageConfigured,
  streamCachedObject,
} from "~/lib/media/object-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentLengthBytes(media: MediaStreamContext): number | null {
  return media.cachedSizeBytes ?? media.sizeBytes;
}

function mediaErrorResponse(
  status: number,
  error: string,
  media: MediaStreamContext,
  extra?: Record<string, string | null | undefined>,
): Response {
  return new Response(
    JSON.stringify({
      error,
      mediaId: media.mediaId,
      cacheStatus: media.cacheStatus,
      ...extra,
    }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Media-Cache-Status": media.cacheStatus ?? "unknown",
        ...(status === 503 ? { "Retry-After": "10" } : {}),
      },
    },
  );
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ mediaId: string }> },
) {
  const { mediaId } = await context.params;
  const refresh = request.nextUrl.searchParams.has("refresh");

  const media = await loadMediaForStream(mediaId);
  if (!media) {
    return Response.json({ error: "media_not_found", mediaId }, { status: 404 });
  }

  if (media.type === "photo") {
    if (media.cacheStatus === "ready") {
      const blob = await loadMediaBlobFromPostgres(mediaId);
      if (blob) {
        return new Response(new Uint8Array(blob.data), {
          status: 200,
          headers: {
            "Content-Type": blob.mimeType,
            "Content-Length": String(blob.sizeBytes),
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Media-Storage": "postgres",
          },
        });
      }
      return mediaErrorResponse(503, "photo_not_cached", media);
    }

    if (refresh || shouldEnqueueMediaCache(media)) {
      await enqueueMediaCacheJob(mediaId);
    }

    switch (media.cacheStatus) {
      case "failed":
        return mediaErrorResponse(502, "media_cache_failed", media, {
          lastCacheError: media.lastCacheError,
        });
      case "downloading":
        return mediaErrorResponse(503, "media_cache_downloading", media);
      default:
        return mediaErrorResponse(503, "media_cache_pending", media);
    }
  }

  if (!isObjectStorageConfigured()) {
    return mediaErrorResponse(500, "object_storage_not_configured", media);
  }

  if (refresh || shouldEnqueueMediaCache(media)) {
    await enqueueMediaCacheJob(mediaId);
  }

  const range = parseRangeHeader(
    request.headers.get("range"),
    contentLengthBytes(media),
  );

  if (isCachedObjectReady(media) && media.storageKey) {
    try {
      const cached = await streamCachedObject(media, range);
      if (cached) return cached;
      console.warn("[media] object_storage_miss", {
        mediaId,
        storageKey: media.storageKey,
      });
      return mediaErrorResponse(502, "object_storage_miss", media, {
        storageKey: media.storageKey,
      });
    } catch (err) {
      console.error("[media] object_storage_error", {
        mediaId,
        storageKey: media.storageKey,
        err,
      });
      return mediaErrorResponse(503, "object_storage_error", media, {
        storageKey: media.storageKey,
      });
    }
  }

  switch (media.cacheStatus) {
    case "failed":
      return mediaErrorResponse(502, "media_cache_failed", media, {
        lastCacheError: media.lastCacheError,
      });
    case "skipped":
      return mediaErrorResponse(422, "media_cache_skipped", media);
    case "downloading":
      return mediaErrorResponse(503, "media_cache_downloading", media);
    default:
      return mediaErrorResponse(503, "media_cache_pending", media);
  }
}
