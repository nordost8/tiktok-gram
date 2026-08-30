/**
 * Smoke test for /api/media object-storage path (Next must be running on PORT).
 *
 * Usage:
 *   S3_ENDPOINT=... pnpm -F @tiktok-gram/db verify:step11-media-api -- <mediaId>
 */

const baseUrl = process.env.MEDIA_API_BASE_URL ?? "http://127.0.0.1:3000";
const mediaId = process.argv.slice(2).find((arg) => arg !== "--");

if (!mediaId) {
  console.error("Usage: verify-step11-media-api <mediaId>");
  process.exit(1);
}

async function main() {
  const url = `${baseUrl}/api/media/${mediaId}`;

  const full = await fetch(url);
  if (!full.ok) {
    throw new Error(`GET full failed: ${full.status} ${await full.text()}`);
  }
  const source = full.headers.get("x-media-source");
  if (source !== "object-storage") {
    throw new Error(`Expected X-Media-Source=object-storage, got ${source}`);
  }
  const body = await full.arrayBuffer();
  if (body.byteLength < 1) {
    throw new Error("Empty body for cached media");
  }

  const range = await fetch(url, {
    headers: { Range: "bytes=0-1023" },
  });
  if (range.status !== 206) {
    throw new Error(`Range expected 206, got ${range.status}`);
  }
  const cr = range.headers.get("content-range");
  if (!cr?.startsWith("bytes 0-")) {
    throw new Error(`Invalid Content-Range: ${cr}`);
  }
  const rangeBody = await range.arrayBuffer();
  if (rangeBody.byteLength !== 1024) {
    throw new Error(`Range body length ${rangeBody.byteLength}, expected 1024`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      mediaId,
      fullBytes: body.byteLength,
      contentType: full.headers.get("content-type"),
      source,
      rangeContentRange: cr,
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
