export type MediaCandidate = {
  id?: string;
  type: "photo" | "video" | "animation";
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  sizeBytes?: number | null;
  sortOrder?: number | null;
};

function area(m: MediaCandidate): number {
  return (m.width ?? 0) * (m.height ?? 0);
}

function compareVideo(a: MediaCandidate, b: MediaCandidate): number {
  const durationDiff = (b.duration ?? 0) - (a.duration ?? 0);
  if (durationDiff !== 0) return durationDiff;

  const sizeDiff = (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0);
  if (sizeDiff !== 0) return sizeDiff;

  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

function comparePhoto(a: MediaCandidate, b: MediaCandidate): number {
  const areaDiff = area(b) - area(a);
  if (areaDiff !== 0) return areaDiff;
  return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
}

/**
 * 1. video — longest duration → size_bytes → sort_order
 * 2. animation
 * 3. photo — max area → sort_order
 */
export function selectPrimaryMedia(
  media: MediaCandidate[],
): MediaCandidate | null {
  if (media.length === 0) return null;

  const videos = media.filter((m) => m.type === "video");
  if (videos.length > 0) {
    return [...videos].sort(compareVideo)[0] ?? null;
  }

  const animations = media.filter((m) => m.type === "animation");
  if (animations.length > 0) {
    return [...animations].sort(comparePhoto)[0] ?? null;
  }

  const photos = media.filter((m) => m.type === "photo");
  if (photos.length > 0) {
    return [...photos].sort(comparePhoto)[0] ?? null;
  }

  return null;
}

/** Video/animation only — no photo posts in feed. */
export function selectPrimaryVideoMedia(
  media: MediaCandidate[],
): MediaCandidate | null {
  const playable = media.filter(
    (m) => m.type === "video" || m.type === "animation",
  );
  if (playable.length === 0) return null;

  const videos = playable.filter((m) => m.type === "video");
  if (videos.length > 0) {
    return [...videos].sort(compareVideo)[0] ?? null;
  }

  return [...playable.filter((m) => m.type === "animation")].sort(comparePhoto)[0] ?? null;
}

export function isVideoOnlyFeed(): boolean {
  return process.env.COLLECTOR_VIDEO_ONLY !== "0";
}

export function feedAllowsPhotos(): boolean {
  return process.env.FEED_ALLOW_PHOTOS === "1";
}
