const SESSION_KEY = "tiktok_gram_viewed_posts";
const MAX_SIZE = 500;

class ViewedPostsStore {
  private set: Set<string>;

  constructor() {
    this.set = this.load();
  }

  has(postId: string): boolean {
    return this.set.has(postId);
  }

  add(postId: string): void {
    this.set.add(postId);
    if (this.set.size > MAX_SIZE) {
      const [first] = this.set;
      if (first) this.set.delete(first);
    }
    this.persist();
  }

  clear(): void {
    this.set.clear();
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
  }

  private persist(): void {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify([...this.set]));
    } catch { /* private mode or storage full */ }
  }

  private load(): Set<string> {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* ignore */ }
    return new Set();
  }
}

// Singleton — survives FeedScreen remount within the same browser session.
export const viewedPostsStore = new ViewedPostsStore();
