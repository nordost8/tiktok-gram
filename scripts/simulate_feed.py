#!/usr/bin/env python3
"""
Feed simulation for a specific user — mimics what the frontend does page by page.
Usage:
  python scripts/simulate_feed.py --username some_telegram_username
  python scripts/simulate_feed.py --username some_telegram_username --feed subscriptions
"""
import argparse
import base64
import json
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

POSTGRES_URL = os.environ["POSTGRES_URL"]
LIMIT = 10
MAX_PAGES = 20  # safety cap


def connect():
    return psycopg2.connect(POSTGRES_URL, cursor_factory=psycopg2.extras.RealDictCursor)


def decode_cursor(cursor: str | None):
    if not cursor:
        return None
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor + "==").decode())
        return {"publishedAt": datetime.fromisoformat(data["publishedAt"]), "id": data["id"]}
    except Exception:
        return None


def encode_cursor(published_at: datetime, post_id: str) -> str:
    payload = json.dumps({"publishedAt": published_at.isoformat(), "id": post_id})
    return base64.urlsafe_b64encode(payload.encode()).rstrip(b"=").decode()


def get_profile(conn, username: str | None = None, tgid: str | None = None, profile_id: str | None = None):
    with conn.cursor() as cur:
        if profile_id:
            cur.execute(
                "SELECT id, telegram_user_id, username, first_name, last_name FROM telegram_app_profiles WHERE id = %s",
                (profile_id,),
            )
        elif tgid:
            cur.execute(
                "SELECT id, telegram_user_id, username, first_name, last_name FROM telegram_app_profiles WHERE telegram_user_id = %s",
                (tgid,),
            )
        else:
            cur.execute(
                "SELECT id, telegram_user_id, username, first_name, last_name FROM telegram_app_profiles WHERE username = %s",
                (username,),
            )
        return cur.fetchone()


def get_interests(conn, profile_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT c.slug FROM telegram_profile_interests pi
            JOIN telegram_interest_categories c ON c.id = pi.interest_id
            WHERE pi.profile_id = %s
            """,
            (profile_id,),
        )
        return {r["slug"] for r in cur.fetchall()}


def get_subscriptions(conn, profile_id: str) -> set[str]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT channel_id FROM telegram_user_channel_subscriptions WHERE profile_id = %s",
            (profile_id,),
        )
        return {r["channel_id"] for r in cur.fetchall()}


def score_post(post, interest_slugs: set, subscribed_channel_ids: set) -> float:
    now = datetime.now(timezone.utc)
    published_at = post["published_at"]
    if published_at.tzinfo is None:
        published_at = published_at.replace(tzinfo=timezone.utc)
    hours_ago = (now - published_at).total_seconds() / 3600
    freshness = max(0, 72 - hours_ago) / 72
    engagement = (
        (post["internal_likes_count"] or 0) * 3
        + (post["internal_saves_count"] or 0) * 4
        + (post["internal_views_count"] or 0) * 0.1
    )
    category_boost = 20 if post["category_slug"] and post["category_slug"] in interest_slugs else 0
    video_boost = 35 if post["media_type"] in ("video", "animation") else 0
    subscription_boost = 120 if post["channel_id"] in subscribed_channel_ids else 0
    return freshness * 30 + engagement + category_boost + video_boost + subscription_boost


def apply_diversity(items: list, limit: int) -> list:
    result = []
    channel_counts: dict[str, int] = {}
    for item in items:
        c = channel_counts.get(item["channel_id"], 0)
        if c >= 2 and len(result) < limit:
            continue
        result.append(item)
        channel_counts[item["channel_id"]] = c + 1
        if len(result) >= limit:
            break
    if len(result) < limit:
        for item in items:
            if item in result:
                continue
            result.append(item)
            if len(result) >= limit:
                break
    return result


def fetch_page(conn, profile_id: str, interest_slugs: set, subscribed_channel_ids: set,
               channel_ids: list | None, cursor: str | None, feed_type: str,
               exclude_viewed: bool = True, simulated_viewed_ids: set | None = None) -> dict:
    decoded = decode_cursor(cursor)

    conditions = [
        "p.status = 'ready'",
        "p.primary_media_id IS NOT NULL",
        "m.telegram_access_hash IS NOT NULL",
    ]
    params: list = []

    if feed_type == "subscriptions" and channel_ids:
        placeholders = ",".join(["%s"] * len(channel_ids))
        conditions.append(f"p.channel_id IN ({placeholders})")
        params.extend(channel_ids)
    elif feed_type == "for_you" and interest_slugs:
        slugs = list(interest_slugs)
        parts = [f"c.category_slug IN ({','.join(['%s']*len(slugs))})"]
        params.extend(slugs)
        if subscribed_channel_ids:
            subs = list(subscribed_channel_ids)
            parts.append(f"p.channel_id IN ({','.join(['%s']*len(subs))})")
            params.extend(subs)
        conditions.append(f"({' OR '.join(parts)})")

    if exclude_viewed:
        if simulated_viewed_ids:
            placeholders = ",".join(["%s"] * len(simulated_viewed_ids))
            conditions.append(f"p.id NOT IN ({placeholders})")
            params.extend(list(simulated_viewed_ids))
        else:
            # Fallback to real DB views if no simulated views yet
            conditions.append(
                "NOT EXISTS (SELECT 1 FROM telegram_user_post_views v WHERE v.post_id = p.id AND v.profile_id = %s)"
            )
            params.append(profile_id)

    if decoded and not exclude_viewed:
        conditions.append(
            "(p.published_at < %s OR (p.published_at = %s AND p.id < %s))"
        )
        params.extend([decoded["publishedAt"], decoded["publishedAt"], decoded["id"]])

    where = " AND ".join(conditions)
    sql = f"""
        SELECT
            p.id, p.channel_id, p.published_at,
            p.internal_views_count, p.internal_likes_count,
            p.internal_saves_count, p.internal_shares_count,
            p.telegram_url, p.text, p.caption,
            c.category_slug, c.title AS channel_title, c.username AS channel_username,
            m.type AS media_type, m.cache_status, m.storage_key
        FROM telegram_posts p
        JOIN telegram_channels c ON c.id = p.channel_id
        JOIN telegram_post_media m ON m.id = p.primary_media_id
        WHERE {where}
        ORDER BY p.published_at DESC, p.id DESC
        LIMIT %s
    """
    params.append(LIMIT * 3)

    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    rows = list(rows)

    ranked = sorted(rows, key=lambda r: score_post(r, interest_slugs, subscribed_channel_ids), reverse=True)
    diverse = apply_diversity(ranked, LIMIT)

    oldest = None
    for p in diverse:
        if oldest is None or p["published_at"] < oldest["published_at"] or (
            p["published_at"] == oldest["published_at"] and p["id"] < oldest["id"]
        ):
            oldest = p

    if exclude_viewed:
        next_cursor = encode_cursor(diverse[0]["published_at"], diverse[0]["id"]) if diverse else None
    else:
        next_cursor = (
            encode_cursor(oldest["published_at"], oldest["id"])
            if diverse and len(diverse) == LIMIT else None
        )

    return {
        "items": diverse,
        "rows_from_db": len(rows),
        "next_cursor": next_cursor,
    }


def main():
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--username", help="Telegram username (without @)")
    group.add_argument("--tgid", help="Telegram user ID (number)")
    group.add_argument("--profile-id", help="Profile UUID in the DB")
    parser.add_argument("--feed", choices=["for_you", "subscriptions"], default="for_you")
    args = parser.parse_args()

    conn = connect()

    profile = get_profile(conn, username=args.username, tgid=args.tgid, profile_id=args.profile_id)
    label = args.tgid or args.username or args.profile_id or "?"
    if not profile:
        print(f"Profile {label} not found in DB")
        sys.exit(1)

    profile_id = profile["id"]
    print(f"Profile: @{profile['username']} | {profile['first_name']} {profile['last_name'] or ''}")
    print(f"telegram_user_id: {profile['telegram_user_id']}")
    print(f"profile_id: {profile_id}")
    print()

    interest_slugs = get_interests(conn, profile_id)
    subscribed_channel_ids = get_subscriptions(conn, profile_id)
    print(f"Interests: {interest_slugs or '(none)'}")
    print(f"Channel subscriptions: {len(subscribed_channel_ids)} channel(s)")
    print()

    channel_ids = list(subscribed_channel_ids) if args.feed == "subscriptions" else None

    cursor = None
    total_posts = 0
    all_post_ids: set[str] = set()
    simulated_viewed: set[str] = set()

    for page in range(1, MAX_PAGES + 1):
        result = fetch_page(
            conn, profile_id, interest_slugs, subscribed_channel_ids,
            channel_ids, cursor, args.feed,
            exclude_viewed=True, simulated_viewed_ids=simulated_viewed,
        )
        items = result["items"]
        rows_from_db = result["rows_from_db"]
        next_cursor = result["next_cursor"]

        print(f"--- Page {page} ---")
        print(f"  Rows from DB: {rows_from_db}  |  After scoring+diversity: {len(items)}  |  nextCursor: {'yes' if next_cursor else 'NONE'}")

        if not items:
            print("  (empty — feed stopped)")
            break

        new_this_page = 0
        for i, post in enumerate(items):
            score = score_post(post, interest_slugs, subscribed_channel_ids)
            dup = " (already seen)" if post["id"] in all_post_ids else ""
            if not dup:
                new_this_page += 1
            print(
                f"  [{total_posts + new_this_page:3d}] {post['channel_username']:20s} | {post['media_type']:9s} | "
                f"score={score:6.1f} | {post['published_at'].strftime('%Y-%m-%d')}{dup}"
            )
            all_post_ids.add(post["id"])
            simulated_viewed.add(post["id"])  # simulate that the user has viewed it

        total_posts = len(all_post_ids)

        if not next_cursor:
            print(f"\nFeed ended naturally after {total_posts} posts (nextCursor absent)")
            break

        cursor = next_cursor
        print()
    else:
        print(f"\nReached the {MAX_PAGES} page limit — {total_posts} posts")

    conn.close()
    print(f"\nTotal unique posts shown: {len(all_post_ids)}")


if __name__ == "__main__":
    main()
