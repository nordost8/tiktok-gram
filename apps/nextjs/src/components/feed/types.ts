import type { RouterOutputs } from "@tiktok-gram/api";

type ApiFeedPost = RouterOutputs["feed"]["forYou"]["items"][number];

/** Widen API inference — mapPostToDto fields not always reflected in RouterOutputs. */
export type FeedPost = ApiFeedPost & {
  displayText?: string | null;
  originalText?: string | null;
  translationAvailable?: boolean;
  sourceLang?: string | null;
  audio?: {
    url: string;
    title: string | null;
    author: string | null;
  };
  mediaItems?: Array<{
    id: string;
    type: "photo" | "video" | "animation";
    url: string;
    width: number | null;
    height: number | null;
    mimeType: string | null;
  }>;
};
export type FeedTab = "forYou" | "subscriptions";
