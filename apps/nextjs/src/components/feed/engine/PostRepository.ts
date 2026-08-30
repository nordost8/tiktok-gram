import type { FeedPost } from "../types";

export type RepositoryStatus =
  | "idle"
  | "fetching"
  | "exhausted"; // no more pages AND no unviewed posts

/**
 * Manages the ordered post list across infinite-query pages.
 * Guarantees O(1) access to any loaded post by absolute index.
 * Triggers prefetch when the consumer approaches the end.
 */
export class PostRepository {
  private posts: FeedPost[] = [];
  private seenIds = new Set<string>();
  private _status: RepositoryStatus = "idle";

  /** Called by controller to request more posts from the network */
  onNearEnd: (() => void) | null = null;
  /** Prefetch fires when within this many posts of the end */
  prefetchThreshold = 5;

  get totalLoaded(): number {
    return this.posts.length;
  }

  get status(): RepositoryStatus {
    return this._status;
  }

  setStatus(s: RepositoryStatus): void {
    this._status = s;
  }

  /**
   * Replace / append posts from a new page snapshot.
   * Called every time React Query delivers new data.
   * Deduplicates by post id.
   */
  sync(incoming: FeedPost[]): { added: number } {
    let added = 0;
    for (const p of incoming) {
      if (this.seenIds.has(p.id)) continue;
      this.seenIds.add(p.id);
      this.posts.push(p);
      added++;
    }
    return { added };
  }

  /** Returns post at absolute index, or null if not loaded yet / out of bounds */
  get(index: number): FeedPost | null {
    if (index < 0) return null;
    return this.posts[index] ?? null;
  }

  /**
   * Returns 3 posts for the virtual slots: [prev, current, next].
   * Always safe — slots can be null (rendered as empty).
   */
  getSlotPosts(activeIndex: number): [FeedPost | null, FeedPost | null, FeedPost | null] {
    return [
      this.posts[activeIndex - 1] ?? null,
      this.posts[activeIndex] ?? null,
      this.posts[activeIndex + 1] ?? null,
    ];
  }

  /**
   * Check if we should prefetch, and if so fire onNearEnd.
   * Call this after every activeIndex change.
   */
  checkPrefetch(activeIndex: number): void {
    if (this._status === "fetching" || this._status === "exhausted") return;
    const distanceToEnd = this.posts.length - 1 - activeIndex;
    if (distanceToEnd <= this.prefetchThreshold) {
      this.onNearEnd?.();
    }
  }

  canGoForward(activeIndex: number): boolean {
    // Can go forward if there's a next post OR if there might be more to fetch
    return activeIndex < this.posts.length - 1 || this._status === "fetching";
  }

  canGoBackward(activeIndex: number): boolean {
    return activeIndex > 0;
  }

  reset(): void {
    this.posts = [];
    this.seenIds.clear();
    this._status = "idle";
  }
}
