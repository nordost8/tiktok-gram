import { eq } from "drizzle-orm";

import type { db as Db } from "@tiktok-gram/db/client";
import { telegramUserChannelSubscriptions } from "@tiktok-gram/db/schema";

import { channelAvatarApiPath } from "./map-post";

type ChannelRow = {
  id: string;
  username: string | null;
  title: string;
  avatarUrl: string | null;
  categorySlug: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export async function attachSubscriptionState(
  db: typeof Db,
  profileId: string,
  channels: ChannelRow[],
) {
  if (channels.length === 0) return [];

  const subs = await db
    .select({ channelId: telegramUserChannelSubscriptions.channelId })
    .from(telegramUserChannelSubscriptions)
    .where(eq(telegramUserChannelSubscriptions.profileId, profileId));

  const subscribedIds = new Set(subs.map((s) => s.channelId));

  return channels.map((channel) => ({
    id: channel.id,
    username: channel.username,
    title: channel.title,
    avatarUrl: channelAvatarApiPath(channel.id),
    categorySlug: channel.categorySlug,
    subscribed: subscribedIds.has(channel.id),
  }));
}
