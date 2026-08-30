import {
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { MEDIA_CACHE_BUCKET } from "@tiktok-gram/db";

import { env } from "~/env";

import type { MediaStreamContext } from "./load-media";
import type { StreamRange } from "./media-range";
import { defaultMimeType } from "./media-range";

let client: S3Client | null = null;

const presignedUrlCache = new Map<string, { url: string; expiresAt: number }>();
const PRESIGN_TTL_MS = 3500_000; // ~58 min, below the 1h expiry

export function isObjectStorageConfigured(): boolean {
  return Boolean(
    env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
  );
}

export function getS3Client(): S3Client {
  if (!isObjectStorageConfigured()) {
    throw new Error("S3 object storage is not configured");
  }
  if (!client) {
    client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? "us-east-1",
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID!,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
    });
  }
  return client;
}

export async function getPresignedMediaUrl(storageKey: string): Promise<string> {
  const now = Date.now();
  const cached = presignedUrlCache.get(storageKey);
  if (cached && cached.expiresAt > now) return cached.url;

  const bucket = env.S3_BUCKET ?? MEDIA_CACHE_BUCKET;
  const command = new GetObjectCommand({ Bucket: bucket, Key: storageKey });
  const url = await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });
  presignedUrlCache.set(storageKey, { url, expiresAt: now + PRESIGN_TTL_MS });
  return url;
}

export function isCachedObjectReady(
  media: MediaStreamContext,
): media is MediaStreamContext & {
  cacheStatus: "ready";
  storageKey: string;
  cacheRangeReady: true;
} {
  return (
    media.type !== "photo" &&
    media.cacheStatus === "ready" &&
    Boolean(media.storageKey) &&
    media.cacheRangeReady === true
  );
}

function effectiveSizeBytes(media: MediaStreamContext): number | null {
  return media.cachedSizeBytes ?? media.sizeBytes;
}

function buildRangeHeader(
  range: StreamRange,
  totalSize: number | null,
): string {
  const end =
    range.end ?? (totalSize != null ? totalSize - 1 : undefined);
  if (end == null) {
    return `bytes=${range.start}-`;
  }
  return `bytes=${range.start}-${end}`;
}

export async function fetchAvatarObject(
  storageKey: string,
): Promise<Response | null> {
  if (!isObjectStorageConfigured()) return null;

  const bucket = env.S3_BUCKET ?? MEDIA_CACHE_BUCKET;

  try {
    const output = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!output.Body) return null;

    const headers: Record<string, string> = {
      "Content-Type": output.ContentType ?? "image/jpeg",
      "Cache-Control": "public, max-age=604800, immutable",
    };
    if (output.ContentLength != null) {
      headers["Content-Length"] = String(output.ContentLength);
    }

    return new Response(
      output.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      { status: 200, headers },
    );
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { name?: string }).name === "NotFound" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }
    console.error("[avatar-object]", storageKey, error);
    return null;
  }
}

export async function fetchAudioObject(
  storageKey: string,
): Promise<Response | null> {
  if (!isObjectStorageConfigured()) return null;

  const bucket = env.S3_BUCKET ?? MEDIA_CACHE_BUCKET;

  try {
    const output = await getS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!output.Body) return null;

    const headers: Record<string, string> = {
      "Content-Type": output.ContentType ?? "audio/mpeg",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=604800, immutable",
    };
    if (output.ContentLength != null) {
      headers["Content-Length"] = String(output.ContentLength);
    }

    return new Response(
      output.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      { status: 200, headers },
    );
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { name?: string }).name === "NotFound" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }
    console.error("[audio-object]", storageKey, error);
    return null;
  }
}

export async function streamCachedObject(
  media: MediaStreamContext & { storageKey: string },
  range: StreamRange | null,
): Promise<Response | null> {
  if (!isObjectStorageConfigured()) return null;

  const bucket = env.S3_BUCKET ?? MEDIA_CACHE_BUCKET;
  const totalSize = effectiveSizeBytes(media);

  try {
    const s3 = getS3Client();

    if (range == null) {
      const head = await s3.send(
        new HeadObjectCommand({ Bucket: bucket, Key: media.storageKey }),
      );
      const size = head.ContentLength ?? totalSize;
      const output = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: media.storageKey }),
      );
      if (!output.Body) return null;

      const headers = buildCachedHeaders(
        media,
        size,
        null,
        output.ContentType ?? undefined,
      );
      return new Response(
        output.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        { status: 200, headers },
      );
    }

    const rangeHeader = buildRangeHeader(range, totalSize);
    const output = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: media.storageKey,
        Range: rangeHeader,
      }),
    );
    if (!output.Body) return null;

    const parsed = parseContentRange(output.ContentRange, range, totalSize);
    const headers = buildCachedHeaders(
      media,
      parsed.total,
      parsed,
      output.ContentType ?? undefined,
    );

    return new Response(
      output.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      {
        status: 206,
        headers,
      },
    );
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { name?: string }).name === "NotFound" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      return null;
    }
    console.error("[object-storage]", media.mediaId, error);
    throw error;
  }
}

function parseContentRange(
  contentRange: string | undefined,
  range: StreamRange,
  totalSize: number | null,
): { start: number; end: number; total: number | null; length: number } {
  if (contentRange) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange);
    if (match) {
      const start = Number(match[1]);
      const end = Number(match[2]);
      const total = match[3] === "*" ? totalSize : Number(match[3]);
      return { start, end, total: total ?? totalSize, length: end - start + 1 };
    }
  }

  const end =
    range.end ?? (totalSize != null ? totalSize - 1 : range.start);
  return {
    start: range.start,
    end,
    total: totalSize,
    length: end - range.start + 1,
  };
}

function buildCachedHeaders(
  media: MediaStreamContext,
  totalSize: number | null | undefined,
  part: { start: number; end: number; total: number | null; length: number } | null,
  contentType?: string,
): Headers {
  const mime =
    contentType ??
    media.mimeType ??
    defaultMimeType(media.type);

  const headers = new Headers({
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400, immutable",
    "X-Media-Source": "object-storage",
  });

  if (part) {
    const total = part.total ?? "*";
    headers.set(
      "Content-Range",
      `bytes ${part.start}-${part.end}/${total}`,
    );
    headers.set("Content-Length", String(part.length));
  } else if (totalSize != null) {
    headers.set("Content-Length", String(totalSize));
  }

  return headers;
}
