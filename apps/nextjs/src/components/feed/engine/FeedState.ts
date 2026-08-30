/** State machine phases for the feed swiper. */
export type FeedPhase =
  | { type: "IDLE" }
  | { type: "DRAGGING"; startY: number; lastY: number; lastT: number; velocity: number }
  | { type: "ANIMATING"; direction: "forward" | "backward" | "cancel" }
  | { type: "SETTLED" };

export type SwipeBlockReason =
  | "fetching_next_page"
  | "all_viewed"
  | "at_first_post"
  | "swipe_too_weak"
  | "slide_height_zero";
