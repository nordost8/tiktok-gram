import { eq } from "drizzle-orm";

import { db } from "@tiktok-gram/db/client";
import { telegramChannels } from "@tiktok-gram/db/schema";

import { channelAvatarObjectKey } from "./channel-storage";

export async function loadChannelForAvatar(channelId: string) {
  const [row] = await db
    .select({
      id: telegramChannels.id,
      title: telegramChannels.title,
      username: telegramChannels.username,
      avatarUrl: telegramChannels.avatarUrl,
    })
    .from(telegramChannels)
    .where(eq(telegramChannels.id, channelId))
    .limit(1);

  if (!row) return null;

  const storageKey =
    row.avatarUrl?.startsWith("channels/") === true
      ? row.avatarUrl
      : channelAvatarObjectKey(row.id);

  return { ...row, storageKey };
}
