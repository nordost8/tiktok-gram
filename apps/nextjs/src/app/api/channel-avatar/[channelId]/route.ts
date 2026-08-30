import { notFound } from "next/navigation";

import { channelAvatarFallbackSvg } from "~/lib/channel/channel-avatar-fallback";
import { loadChannelForAvatar } from "~/lib/channel/load-channel";
import { fetchAvatarObject, isObjectStorageConfigured } from "~/lib/media/object-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const { channelId } = await context.params;
  const channel = await loadChannelForAvatar(channelId);
  if (!channel) notFound();

  if (isObjectStorageConfigured()) {
    const res = await fetchAvatarObject(channel.storageKey);
    if (res) return res;
  }

  const svg = channelAvatarFallbackSvg(channel.title);
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    },
  });
}
