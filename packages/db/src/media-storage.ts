/** Object storage settings for media cache (Cloudflare R2 / S3-compatible). */

export const MEDIA_CACHE_BUCKET = "tiktok-gram-media";
export const MEDIA_STORAGE_BACKEND = "r2";

export function mediaObjectKey(mediaId: string, extension: string) {
  const ext = extension.startsWith(".") ? extension.slice(1) : extension;
  return `media/${mediaId}.${ext}`;
}
