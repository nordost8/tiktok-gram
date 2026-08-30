export type ProfileSource = "telegram" | "local";

export interface AppProfileContext {
  profileId: string;
  telegramUserId: string | null;
  localAnonymousId: string | null;
  source: ProfileSource;
  displayName: string | null;
  username: string | null;
  photoUrl: string | null;
}
