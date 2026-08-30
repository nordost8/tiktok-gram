#!/usr/bin/env python3
"""
Stress-test feed video streaming over LAN (realistic Range reads).

Simulates concurrent viewers:
  1. Optional light tRPC feed.forYou (session bootstrap)
  2. Warm chunk: Range bytes=0-262143 (like VerticalFeedSwiper)
  3. Sequential Range reads throttled to --bitrate-mbps (default 2.5 Mbit/s per viewer)

Usage:
  python3 scripts/feed-video-stress.py
  python3 scripts/feed-video-stress.py --base-url http://localhost:3000 --ramp 1,5,10,20
  python3 scripts/feed-video-stress.py --users 10 --watch-sec 20 --bitrate-mbps 3

Env:
  STRESS_BASE_URL   default http://localhost:3000
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import aiohttp

ROOT = Path(__file__).resolve().parents[1]
WARM_BYTES = 256 * 1024
CHUNK_BYTES = 256 * 1024


@dataclass
class ViewerResult:
    ok: bool
    user_id: int
    media_id: str
    warm_ms: float
    bytes_read: int
    chunks: int
    errors: list[str] = field(default_factory=list)
    status_codes: list[int] = field(default_factory=list)


def load_env() -> None:
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


async def trpc_feed_media_ids(
    session: aiohttp.ClientSession,
    base: str,
    profile: str,
    limit: int,
) -> list[tuple[str, int | None]]:
    """Return [(mediaId, sizeBytes|null), ...] from feed.forYou."""
    url = f"{base.rstrip('/')}/api/trpc/feed.forYou"
    params = urlencode({"input": json.dumps({"json": {"limit": limit}})})
    headers = {
        "content-type": "application/json",
        "x-local-anonymous-id": profile,
    }

    async with session.get(f"{url}?{params}", headers=headers) as resp:
        body = await resp.json()
        if resp.status != 200:
            raise RuntimeError(f"feed.forYou HTTP {resp.status}: {body}")

    data = body.get("result", {}).get("data", {}).get("json")
    if not data:
        err = body.get("error") or body
        raise RuntimeError(f"feed.forYou failed: {err}")

    items: list[tuple[str, int | None]] = []
    for item in data.get("items") or []:
        media = item.get("primaryMedia") or {}
        if media.get("type") not in ("video", "animation"):
            continue
        if media.get("cacheStatus") not in (None, "ready"):
            continue
        url_path = media.get("url") or ""
        if "/api/media/" not in url_path:
            continue
        media_id = url_path.rstrip("/").split("/")[-1]
        items.append((media_id, media.get("sizeBytes")))
    return items


async def read_range(
    session: aiohttp.ClientSession,
    url: str,
    start: int,
    end: int,
) -> tuple[int, bytes]:
    headers = {"Range": f"bytes={start}-{end}"}
    async with session.get(url, headers=headers) as resp:
        data = await resp.read()
        return resp.status, data


async def simulate_viewer(
    session: aiohttp.ClientSession,
    base: str,
    user_id: int,
    media_id: str,
    watch_sec: float,
    bitrate_bps: float,
    bootstrap_feed: bool,
    profile: str,
) -> ViewerResult:
    result = ViewerResult(
        ok=False,
        user_id=user_id,
        media_id=media_id,
        warm_ms=0.0,
        bytes_read=0,
        chunks=0,
    )
    api_url = f"{base.rstrip('/')}/api/media/{media_id}"

    try:
        if bootstrap_feed:
            await trpc_feed_media_ids(session, base, profile, limit=5)

        # Resolve the stream URL once (follow redirect like a browser does).
        # After the first redirect, all Range requests go directly to the
        # resolved URL — bypassing the Pi for every subsequent chunk.
        async with session.get(
            api_url,
            headers={"Range": f"bytes=0-{WARM_BYTES - 1}"},
            allow_redirects=True,
            max_redirects=5,
        ) as first_resp:
            stream_url = str(first_resp.url)
            t0 = time.perf_counter()
            warm = await first_resp.read()
            result.warm_ms = (time.perf_counter() - t0) * 1000
            status = first_resp.status
        result.status_codes.append(status)
        if status not in (200, 206) or len(warm) < 1024:
            result.errors.append(f"warm_failed status={status} len={len(warm)}")
            return result

        result.bytes_read += len(warm)
        result.chunks += 1
        offset = len(warm)
        target_bytes = int(bitrate_bps * watch_sec)
        chunk_interval = CHUNK_BYTES / bitrate_bps

        # All subsequent chunks go directly to stream_url (R2 presigned URL).
        while result.bytes_read < target_bytes:
            t_chunk = time.perf_counter()
            end = offset + CHUNK_BYTES - 1
            status, chunk = await read_range(session, stream_url, offset, end)
            result.status_codes.append(status)
            if status == 416:
                break  # past end of file — normal for short videos
            if status not in (200, 206):
                result.errors.append(f"chunk_failed status={status} at={offset}")
                return result
            if not chunk:
                break
            result.bytes_read += len(chunk)
            result.chunks += 1
            offset += len(chunk)

            elapsed = time.perf_counter() - t_chunk
            sleep_for = chunk_interval - elapsed
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)

        result.ok = True
        return result
    except Exception as exc:  # noqa: BLE001
        result.errors.append(str(exc))
        return result


async def run_wave(
    base: str,
    users: int,
    media_pool: list[str],
    watch_sec: float,
    bitrate_mbps: float,
    bootstrap_feed: bool,
    timeout_sec: float,
) -> dict[str, Any]:
    bitrate_bps = bitrate_mbps * 1_000_000 / 8  # bytes/s
    connector = aiohttp.TCPConnector(limit=users + 4, force_close=True)
    timeout = aiohttp.ClientTimeout(total=timeout_sec, connect=10, sock_read=60)

    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        tasks = []
        for i in range(users):
            media_id = media_pool[i % len(media_pool)]
            profile = f"stress-viewer-{uuid.uuid4().hex[:12]}"
            tasks.append(
                simulate_viewer(
                    session,
                    base,
                    i,
                    media_id,
                    watch_sec,
                    bitrate_bps,
                    bootstrap_feed and i == 0,
                    profile,
                ),
            )
        t0 = time.perf_counter()
        results = await asyncio.gather(*tasks)
        wall = time.perf_counter() - t0

    ok = [r for r in results if r.ok]
    fail = [r for r in results if not r.ok]
    warm_times = [r.warm_ms for r in ok]
    total_bytes = sum(r.bytes_read for r in results)
    agg_mbps = (total_bytes * 8) / wall / 1_000_000 if wall > 0 else 0.0

    status_hist: dict[int, int] = {}
    for r in results:
        for code in r.status_codes:
            status_hist[code] = status_hist.get(code, 0) + 1

    return {
        "users": users,
        "ok": len(ok),
        "fail": len(fail),
        "error_rate": round(len(fail) / users, 3) if users else 0,
        "wall_sec": round(wall, 2),
        "total_mb": round(total_bytes / 1_000_000, 2),
        "aggregate_mbps": round(agg_mbps, 2),
        "warm_p50_ms": round(statistics.median(warm_times), 1) if warm_times else None,
        "warm_p95_ms": round(
            sorted(warm_times)[max(0, int(len(warm_times) * 0.95) - 1)],
            1,
        )
        if warm_times
        else None,
        "status_codes": status_hist,
        "sample_errors": [r.errors for r in fail[:5]],
    }


async def discover_media(base: str, limit: int) -> list[str]:
    connector = aiohttp.TCPConnector(limit=4)
    timeout = aiohttp.ClientTimeout(total=30)
    profile = f"stress-discover-{uuid.uuid4().hex[:8]}"
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        # onboarding skip: save interests if needed
        status_url = f"{base.rstrip('/')}/api/trpc/onboarding.getStatus"
        params = urlencode({"input": json.dumps({"json": {}})})
        headers = {"content-type": "application/json", "x-local-anonymous-id": profile}
        async with session.get(f"{status_url}?{params}", headers=headers) as resp:
            status_body = await resp.json()
        status = status_body.get("result", {}).get("data", {}).get("json") or {}
        if not status.get("onboardingCompleted"):
            interests = [i["id"] for i in (status.get("availableInterests") or [])[:3]]
            save_url = f"{base.rstrip('/')}/api/trpc/onboarding.saveInterests"
            async with session.post(
                save_url,
                headers=headers,
                json={"json": {"interestIds": interests}},
            ) as _:
                pass

        items = await trpc_feed_media_ids(session, base, profile, limit)
        if not items:
            raise RuntimeError("No ready video items in feed")
        return [m[0] for m in items]


def parse_ramp(value: str) -> list[int]:
    return [int(x.strip()) for x in value.split(",") if x.strip()]


async def main_async() -> int:
    load_env()
    parser = argparse.ArgumentParser(description="LAN stress test: feed video streaming")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("STRESS_BASE_URL", "http://localhost:3000"),
    )
    parser.add_argument("--users", type=int, default=0, help="Single wave size (if no --ramp)")
    parser.add_argument(
        "--ramp",
        default="1,2,5,10,15,20,25,30",
        help="Comma-separated concurrent viewer counts",
    )
    parser.add_argument("--watch-sec", type=float, default=15.0)
    parser.add_argument(
        "--bitrate-mbps",
        type=float,
        default=2.5,
        help="Per-viewer target bitrate (realistic mobile video)",
    )
    parser.add_argument("--feed-limit", type=int, default=15)
    parser.add_argument(
        "--media-id",
        action="append",
        dest="media_ids",
        help="Explicit media UUID(s); skip feed discovery",
    )
    parser.add_argument(
        "--bootstrap-feed",
        action="store_true",
        help="One viewer also calls feed.forYou (cheap, adds realism)",
    )
    parser.add_argument("--timeout-sec", type=float, default=120.0)
    parser.add_argument(
        "--fail-threshold",
        type=float,
        default=0.15,
        help="Stop ramp when error_rate exceeds this",
    )
    args = parser.parse_args()

    base = args.base_url.rstrip("/")
    print(f"Target: {base}", flush=True)
    print(
        f"Profile: warm {WARM_BYTES // 1024}KB, "
        f"then ~{args.bitrate_mbps} Mbit/s/viewer for {args.watch_sec}s",
        flush=True,
    )

    if args.media_ids:
        media_pool = args.media_ids
    else:
        print("Discovering ready videos from feed…", flush=True)
        media_pool = await discover_media(base, args.feed_limit)
        print(f"Pool: {len(media_pool)} videos", flush=True)

    waves = [args.users] if args.users > 0 else parse_ramp(args.ramp)
    summary: list[dict[str, Any]] = []

    for n in waves:
        print(f"\n--- Wave: {n} concurrent viewers ---", flush=True)
        wave = await run_wave(
            base,
            n,
            media_pool,
            args.watch_sec,
            args.bitrate_mbps,
            args.bootstrap_feed,
            args.timeout_sec,
        )
        summary.append(wave)
        print(json.dumps(wave, ensure_ascii=False, indent=2), flush=True)
        if wave["error_rate"] > args.fail_threshold:
            print(
                f"Stopping ramp: error_rate {wave['error_rate']} > {args.fail_threshold}",
                flush=True,
            )
            break
        await asyncio.sleep(2)

    max_ok = max((w for w in summary if w["error_rate"] <= args.fail_threshold), key=lambda w: w["users"], default=None)
    print("\n========== SUMMARY ==========", flush=True)
    if max_ok:
        print(
            f"Sustained ~{max_ok['users']} concurrent video viewers "
            f"({args.bitrate_mbps} Mbit/s each, {args.watch_sec}s watch)",
            flush=True,
        )
        print(
            f"  aggregate throughput: {max_ok['aggregate_mbps']} Mbit/s, "
            f"warm p50: {max_ok['warm_p50_ms']} ms",
            flush=True,
        )
    else:
        print("No wave passed error threshold.", flush=True)
    return 0


def main() -> None:
    try:
        raise SystemExit(asyncio.run(main_async()))
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
