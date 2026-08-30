import { loadPostAudioForStream } from "~/lib/media/load-post-audio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a photo post's TikTok-recommended sound from Postgres (audio_data bytea).
 *
 * Mirrors the PG branch of /api/media/[mediaId] for photos: serves bytes directly
 * with audio/mpeg + long immutable cache. 404 for non-ready or missing data.
 * (R2 now holds video only.)
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ descId: string }> },
) {
  const { descId } = await context.params;

  const audio = await loadPostAudioForStream(descId);
  if (!audio || audio.status !== "ready" || !audio.data) {
    return Response.json(
      { error: "audio_not_ready", descId, status: audio?.status ?? null },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const data = audio.data;
  const sizeBytes = data.length;
  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(sizeBytes),
      "Cache-Control": "public, max-age=86400, immutable",
      "X-Audio-Storage": "postgres",
    },
  });
}
