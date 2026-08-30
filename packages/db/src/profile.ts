import { eq } from "drizzle-orm";

import type { db } from "./client";
import { telegramAppProfiles } from "./schema";

export type Db = typeof db;

export type TelegramUserInfo = {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
};

export type ProfileLookup =
  | { telegramUserId: string; localAnonymousId?: null; userInfo?: TelegramUserInfo }
  | { telegramUserId?: null; localAnonymousId: string; userInfo?: never };

export async function getOrCreateProfile(db: Db, lookup: ProfileLookup) {
  const now = new Date();

  if (lookup.telegramUserId) {
    const info = lookup.userInfo ?? {};
    const userFields = {
      ...(info.firstName !== undefined && { firstName: info.firstName }),
      ...(info.lastName !== undefined && { lastName: info.lastName }),
      ...(info.username !== undefined && { username: info.username }),
      ...(info.photoUrl !== undefined && { photoUrl: info.photoUrl }),
    };

    const existing = await db.query.telegramAppProfiles.findFirst({
      where: eq(telegramAppProfiles.telegramUserId, lookup.telegramUserId),
    });

    if (existing) {
      const [updated] = await db
        .update(telegramAppProfiles)
        .set({ lastSeenAt: now, updatedAt: now, ...userFields })
        .where(eq(telegramAppProfiles.id, existing.id))
        .returning();
      return updated!;
    }

    const [created] = await db
      .insert(telegramAppProfiles)
      .values({
        telegramUserId: lookup.telegramUserId,
        localAnonymousId: null,
        lastSeenAt: now,
        ...userFields,
      })
      .returning();
    return created!;
  }

  if (!lookup.localAnonymousId) {
    throw new Error("Profile lookup requires telegramUserId or localAnonymousId");
  }
  const localAnonymousId = lookup.localAnonymousId;
  const existing = await db.query.telegramAppProfiles.findFirst({
    where: eq(telegramAppProfiles.localAnonymousId, localAnonymousId),
  });

  if (existing) {
    const [updated] = await db
      .update(telegramAppProfiles)
      .set({ lastSeenAt: now, updatedAt: now })
      .where(eq(telegramAppProfiles.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db
    .insert(telegramAppProfiles)
    .values({
      telegramUserId: null,
      localAnonymousId,
      lastSeenAt: now,
    })
    .returning();

  return created!;
}
