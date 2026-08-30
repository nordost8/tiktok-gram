/** Dev / agent helpers — exposed on `window.tiktokGramFeed` from VerticalFeedSwiper. */
export interface TiktokGramFeedNavigation {
  next: () => void;
  prev: () => void;
  goTo: (index: number) => void;
  getActiveIndex: () => number;
  getPostCount: () => number;
  /** Advance to the next image in the active photo carousel (no-op otherwise). */
  carouselNext: () => void;
  /** Go back to the previous image in the active photo carousel (no-op otherwise). */
  carouselPrev: () => void;
  /**
   * Returns carousel state for the active post, or null when the active post
   * is not a photo carousel.
   */
  getCarouselState: () => { isPhotoPost: boolean; index: number; total: number } | null;
  /** Navigate to the first loaded post that has a photo album (mediaItems.length > 1). */
  goToFirstImagePost: () => void;
}

declare global {
  interface Window {
    tiktokGramFeed?: TiktokGramFeedNavigation;
  }
}

/** `?tiktokGramDev=1` on `/telegram` — prev/next UI for automated testing only. */
export const TIKTOK_GRAM_DEV_FEED_PARAM = "tiktokGramDev";

export function isDevFeedNavEnabled(
  searchParams?: Pick<URLSearchParams, "get"> | null,
): boolean {
  const params =
    searchParams ??
    (typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null);
  if (!params) return false;
  const value = params.get(TIKTOK_GRAM_DEV_FEED_PARAM);
  return value === "1" || value === "true";
}

/** `?tiktokGramForceImages=1` — prepends a synthetic photo album post for dev/MCP testing. */
export const TIKTOK_GRAM_FORCE_IMAGES_PARAM = "tiktokGramForceImages";

export function isForceImagesEnabled(
  searchParams?: Pick<URLSearchParams, "get"> | null,
): boolean {
  const params =
    searchParams ??
    (typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null);
  if (!params) return false;
  const value = params.get(TIKTOK_GRAM_FORCE_IMAGES_PARAM);
  return value === "1" || value === "true";
}
