import { LOCAL_ANONYMOUS_ID_KEY } from "./constants";
import { getAppProfileContext } from "./profile-context";

function getOrCreateLocalAnonymousId(): string {
  const existing = localStorage.getItem(LOCAL_ANONYMOUS_ID_KEY);
  if (existing) return existing;
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `local_${crypto.randomUUID()}`
      : `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(LOCAL_ANONYMOUS_ID_KEY, id);
  return id;
}

export function getTrpcProfileHeaders(): Record<string, string> {
  if (typeof window === "undefined") {
    return {};
  }

  const profile = getAppProfileContext();
  const headers: Record<string, string> = {};

  if (profile.telegramUserId) {
    headers["x-telegram-user-id"] = profile.telegramUserId;
    const user = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (user?.first_name) headers["x-telegram-first-name"] = user.first_name;
    if (user?.last_name) headers["x-telegram-last-name"] = user.last_name;
    if (user?.username) headers["x-telegram-username"] = user.username;
    const photoUrl = (user as { photo_url?: string } | undefined)?.photo_url;
    if (photoUrl) headers["x-telegram-photo-url"] = photoUrl;
  } else if (profile.localAnonymousId) {
    headers["x-local-anonymous-id"] = profile.localAnonymousId;
  } else {
    headers["x-local-anonymous-id"] = getOrCreateLocalAnonymousId();
  }

  return headers;
}
