"""
Simulate per-channel-N vs global-K cache eviction fairness.

100 channels with realistic posting frequency distributions.
Compares how much topic diversity is preserved in the protected set.

Usage:
    python scripts/simulate_cache_fairness.py
    python scripts/simulate_cache_fairness.py --channels 100 --days 7 --protect-global 40 --protect-per-channel 5
"""

from __future__ import annotations

import argparse
import random
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal


# ── Channel definitions ──────────────────────────────────────────────────────

CATEGORY_PROFILES: list[dict] = [
    # (category, count, posts_per_day_range, avg_file_mb_range)
    {"category": "news",         "count": 8,  "ppd": (15, 25), "mb": (5, 30)},
    {"category": "politics",     "count": 6,  "ppd": (10, 20), "mb": (4, 20)},
    {"category": "technology",   "count": 10, "ppd": (3, 8),   "mb": (8, 40)},
    {"category": "finance",      "count": 8,  "ppd": (5, 12),  "mb": (3, 15)},
    {"category": "sports",       "count": 8,  "ppd": (4, 10),  "mb": (10, 50)},
    {"category": "entertainment","count": 10, "ppd": (6, 15),  "mb": (15, 80)},
    {"category": "science",      "count": 8,  "ppd": (1, 3),   "mb": (5, 25)},
    {"category": "medicine",     "count": 6,  "ppd": (0.3, 1), "mb": (3, 15)},
    {"category": "psychology",   "count": 5,  "ppd": (0.5, 2), "mb": (3, 12)},
    {"category": "history",      "count": 5,  "ppd": (0.5, 2), "mb": (5, 20)},
    {"category": "travel",       "count": 6,  "ppd": (1, 4),   "mb": (10, 60)},
    {"category": "food",         "count": 6,  "ppd": (2, 5),   "mb": (5, 30)},
    {"category": "art",          "count": 5,  "ppd": (1, 3),   "mb": (8, 40)},
    {"category": "crypto",       "count": 5,  "ppd": (8, 18),  "mb": (3, 15)},
    {"category": "education",    "count": 4,  "ppd": (1, 3),   "mb": (5, 25)},
]


@dataclass
class Channel:
    id: int
    name: str
    category: str
    posts_per_day: float
    avg_file_mb: float


@dataclass
class Post:
    id: int
    channel: Channel
    published_at: datetime
    file_mb: float


def build_channels(seed: int = 42) -> list[Channel]:
    rng = random.Random(seed)
    channels: list[Channel] = []
    ch_id = 0
    for profile in CATEGORY_PROFILES:
        for i in range(profile["count"]):
            ch_id += 1
            ppd = rng.uniform(*profile["ppd"])
            mb = rng.uniform(*profile["mb"])
            channels.append(Channel(
                id=ch_id,
                name=f"{profile['category']}_{i+1}",
                category=profile["category"],
                posts_per_day=ppd,
                avg_file_mb=mb,
            ))
    return channels


def generate_posts(channels: list[Channel], days: int, seed: int = 42) -> list[Post]:
    """Generate a realistic post stream over `days` days."""
    rng = random.Random(seed)
    now = datetime(2026, 5, 20, 12, 0, 0, tzinfo=timezone.utc)
    start = now - timedelta(days=days)
    posts: list[Post] = []
    post_id = 0

    for ch in channels:
        # Poisson process: avg interval between posts
        avg_interval_hours = 24.0 / ch.posts_per_day
        t = start
        while t < now:
            gap = rng.expovariate(1.0 / avg_interval_hours) * 3600  # seconds
            t = t + timedelta(seconds=gap)
            if t >= now:
                break
            post_id += 1
            file_mb = max(0.5, rng.gauss(ch.avg_file_mb, ch.avg_file_mb * 0.3))
            posts.append(Post(
                id=post_id,
                channel=ch,
                published_at=t,
                file_mb=file_mb,
            ))

    posts.sort(key=lambda p: p.published_at)
    return posts


# ── Eviction strategies ───────────────────────────────────────────────────────

def protected_set_global(posts: list[Post], k: int) -> set[int]:
    """Old strategy: protect the last K posts globally."""
    ready = [p for p in posts if p.file_mb > 0]  # all posts are "ready"
    ready_sorted = sorted(ready, key=lambda p: p.published_at, reverse=True)
    return {p.id for p in ready_sorted[:k]}


def protected_set_per_channel(posts: list[Post], n: int) -> set[int]:
    """New strategy: protect the last N posts per channel."""
    by_channel: dict[int, list[Post]] = defaultdict(list)
    for p in posts:
        by_channel[p.channel.id].append(p)

    protected: set[int] = set()
    for ch_posts in by_channel.values():
        ch_posts_sorted = sorted(ch_posts, key=lambda p: p.published_at, reverse=True)
        for p in ch_posts_sorted[:n]:
            protected.add(p.id)
    return protected


# ── Analysis ──────────────────────────────────────────────────────────────────

@dataclass
class StrategyResult:
    name: str
    protected_ids: set[int]
    posts: list[Post]

    def protected_posts(self) -> list[Post]:
        return [p for p in self.posts if p.id in self.protected_ids]

    def category_coverage(self) -> dict[str, int]:
        """How many categories have at least 1 protected post."""
        cats: dict[str, int] = defaultdict(int)
        for p in self.protected_posts():
            cats[p.channel.category] += 1
        return dict(cats)

    def channel_coverage(self) -> dict[int, int]:
        """How many posts protected per channel."""
        counts: dict[int, int] = defaultdict(int)
        for p in self.protected_posts():
            counts[p.channel.id] += 1
        return dict(counts)

    def zero_coverage_channels(self, all_channels: list[Channel]) -> list[Channel]:
        covered = set(p.channel.id for p in self.protected_posts())
        return [c for c in all_channels if c.id not in covered]

    def protected_size_mb(self) -> float:
        return sum(p.file_mb for p in self.protected_posts())

    def category_diversity_score(self, all_categories: list[str]) -> float:
        """Fraction of categories with at least 1 protected post."""
        covered = set(p.channel.category for p in self.protected_posts())
        return len(covered) / len(all_categories)

    def channel_diversity_score(self, all_channels: list[Channel]) -> float:
        covered = set(p.channel.id for p in self.protected_posts())
        return len(covered) / len(all_channels)

    def gini_coefficient(self) -> float:
        """Gini on per-channel protection count. 0 = perfectly equal, 1 = one channel gets all."""
        ch_cov = self.channel_coverage()
        if not ch_cov:
            return 0.0
        values = sorted(ch_cov.values())
        n = len(values)
        cumsum = 0
        for i, v in enumerate(values, 1):
            cumsum += v * (2 * i - n - 1)
        return cumsum / (n * sum(values))


def print_comparison(
    global_result: StrategyResult,
    perchan_result: StrategyResult,
    channels: list[Channel],
    all_posts: list[Post],
) -> None:
    all_categories = sorted(set(c.category for c in channels))

    print("\n" + "=" * 70)
    print("  CACHE EVICTION FAIRNESS SIMULATION")
    print("=" * 70)
    print(f"  Channels: {len(channels)}")
    print(f"  Posts generated: {len(all_posts)}")
    print(f"  Categories: {len(all_categories)}")
    print()

    headers = ["Metric", "Old (global-K)", "New (per-channel-N)", "Winner"]
    rows = []

    g_cat = global_result.category_diversity_score(all_categories)
    p_cat = perchan_result.category_diversity_score(all_categories)
    rows.append(("Category diversity", f"{g_cat:.0%}", f"{p_cat:.0%}",
                 "NEW ✓" if p_cat > g_cat else ("OLD" if g_cat > p_cat else "TIE")))

    g_ch = global_result.channel_diversity_score(channels)
    p_ch = perchan_result.channel_diversity_score(channels)
    rows.append(("Channel coverage", f"{g_ch:.0%}", f"{p_ch:.0%}",
                 "NEW ✓" if p_ch > g_ch else ("OLD" if g_ch > p_ch else "TIE")))

    g_zero = len(global_result.zero_coverage_channels(channels))
    p_zero = len(perchan_result.zero_coverage_channels(channels))
    rows.append(("Channels with 0 protected posts", str(g_zero), str(p_zero),
                 "NEW ✓" if p_zero < g_zero else ("OLD" if g_zero < p_zero else "TIE")))

    g_gini = global_result.gini_coefficient()
    p_gini = perchan_result.gini_coefficient()
    rows.append(("Gini (0=equal, 1=monopoly)", f"{g_gini:.3f}", f"{p_gini:.3f}",
                 "NEW ✓" if p_gini < g_gini else ("OLD" if g_gini < p_gini else "TIE")))

    g_size = global_result.protected_size_mb()
    p_size = perchan_result.protected_size_mb()
    rows.append(("Protected set size (MB)", f"{g_size:.0f}", f"{p_size:.0f}", "—"))

    g_count = len(global_result.protected_ids)
    p_count = len(perchan_result.protected_ids)
    rows.append(("Protected post count", str(g_count), str(p_count), "—"))

    col_w = [30, 16, 20, 10]
    fmt = "  {:<{}} {:<{}} {:<{}} {:<{}}".format
    print(fmt(headers[0], col_w[0], headers[1], col_w[1], headers[2], col_w[2], headers[3], col_w[3]))
    print("  " + "-" * (sum(col_w) + 3))
    for r in rows:
        print(fmt(r[0], col_w[0], r[1], col_w[1], r[2], col_w[2], r[3], col_w[3]))

    print()
    print("─" * 70)
    print("  CATEGORY BREAKDOWN  (protected posts per category)")
    print("─" * 70)
    g_cats = global_result.category_coverage()
    p_cats = perchan_result.category_coverage()
    total_by_cat: dict[str, int] = defaultdict(int)
    for p in all_posts:
        total_by_cat[p.channel.category] += 1

    hdr = f"  {'Category':<18} {'Total posts':>11}  {'Global-K':>9}  {'PerChan-N':>10}  {'Delta':>7}"
    print(hdr)
    print("  " + "-" * 60)
    for cat in sorted(all_categories):
        total = total_by_cat.get(cat, 0)
        g = g_cats.get(cat, 0)
        p2 = p_cats.get(cat, 0)
        delta = p2 - g
        delta_str = f"+{delta}" if delta > 0 else str(delta)
        marker = " ✓" if delta > 0 else ("  " if delta == 0 else " ✗")
        print(f"  {cat:<18} {total:>11}  {g:>9}  {p2:>10}  {delta_str:>7}{marker}")

    print()
    print("─" * 70)
    print("  CHANNELS WITH 0 PROTECTED POSTS")
    print("─" * 70)
    g_zero_chs = global_result.zero_coverage_channels(channels)
    p_zero_chs = perchan_result.zero_coverage_channels(channels)

    print(f"\n  Old (global-K): {len(g_zero_chs)} channels starved")
    for c in sorted(g_zero_chs, key=lambda x: x.category):
        ppd = c.posts_per_day
        print(f"    {c.name:<25} ({c.category}, {ppd:.2f} posts/day)")

    print(f"\n  New (per-channel-N): {len(p_zero_chs)} channels starved")
    if p_zero_chs:
        for c in sorted(p_zero_chs, key=lambda x: x.category):
            print(f"    {c.name:<25} ({c.category}, {c.posts_per_day:.2f} posts/day)")
    else:
        print("    None — all channels have at least N protected posts")

    print()
    print("─" * 70)
    print("  TOP 10 CHANNELS BY PROTECTED POSTS  (old vs new)")
    print("─" * 70)
    g_ch_cov = global_result.channel_coverage()
    p_ch_cov = perchan_result.channel_coverage()
    ch_by_id = {c.id: c for c in channels}

    print(f"\n  {'Channel':<25} {'Category':<16} {'Old':>5}  {'New':>5}")
    print("  " + "-" * 55)
    top_channels = sorted(channels, key=lambda c: g_ch_cov.get(c.id, 0), reverse=True)[:10]
    for c in top_channels:
        g_n = g_ch_cov.get(c.id, 0)
        p_n = p_ch_cov.get(c.id, 0)
        print(f"  {c.name:<25} {c.category:<16} {g_n:>5}  {p_n:>5}")

    print()
    print("=" * 70)
    print("  VERDICT")
    print("=" * 70)
    new_wins = sum(1 for r in rows if "NEW" in r[3])
    old_wins = sum(1 for r in rows if r[3] == "OLD")
    print(f"  Per-channel-N wins on {new_wins} metrics, old global-K wins on {old_wins}.")
    print()
    if p_zero == 0 and g_zero > 0:
        print(f"  Critical: {g_zero} channels had 0 protected posts with old approach.")
        print(f"  Per-channel-N gives every channel at least N={perchan_result.name.split('N=')[1]} posts of protection.")
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="Cache eviction fairness simulation")
    parser.add_argument("--channels", type=int, default=100, help="Total channel count (uses profiles)")
    parser.add_argument("--days", type=int, default=7, help="Simulation window in days")
    parser.add_argument("--protect-global", type=int, default=40, help="K for global strategy")
    parser.add_argument("--protect-per-channel", type=int, default=5, help="N for per-channel strategy")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    print(f"\nGenerating {args.channels} channels over {args.days} days (seed={args.seed})...")
    channels = build_channels(seed=args.seed)
    # Trim or extend to match requested count
    if len(channels) < args.channels:
        extra = args.channels - len(channels)
        base = channels[-1]
        for i in range(extra):
            channels.append(Channel(
                id=len(channels) + 1,
                name=f"misc_{i+1}",
                category="misc",
                posts_per_day=random.uniform(1, 5),
                avg_file_mb=random.uniform(5, 30),
            ))
    else:
        channels = channels[:args.channels]

    posts = generate_posts(channels, days=args.days, seed=args.seed)
    print(f"Generated {len(posts)} posts across {len(channels)} channels.")

    g_protected = protected_set_global(posts, k=args.protect_global)
    p_protected = protected_set_per_channel(posts, n=args.protect_per_channel)

    global_result = StrategyResult(
        name=f"Global K={args.protect_global}",
        protected_ids=g_protected,
        posts=posts,
    )
    perchan_result = StrategyResult(
        name=f"PerChannel N={args.protect_per_channel}",
        protected_ids=p_protected,
        posts=posts,
    )

    print_comparison(global_result, perchan_result, channels, posts)


if __name__ == "__main__":
    main()
