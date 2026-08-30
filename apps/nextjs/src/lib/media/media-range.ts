export type StreamRange = {
  start: number;
  end: number | null;
};

export function parseRangeHeader(
  rangeHeader: string | null,
  sizeBytes: number | null,
): StreamRange | null {
  if (!rangeHeader?.startsWith("bytes=")) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);
  if (!match) return null;

  const start = Number(match[1]);
  if (!Number.isFinite(start) || start < 0) return null;

  const endRaw = match[2];
  const end =
    endRaw && endRaw.length > 0
      ? Number(endRaw)
      : sizeBytes != null
        ? sizeBytes - 1
        : null;

  if (end != null && (!Number.isFinite(end) || end < start)) return null;
  return { start, end };
}

export function defaultMimeType(type: "photo" | "video" | "animation"): string {
  if (type === "photo") return "image/jpeg";
  return "video/mp4";
}
