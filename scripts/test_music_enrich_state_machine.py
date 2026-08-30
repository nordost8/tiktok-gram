"""Unit tests for the music enrichment state machine.

Covers the locked lifecycle:
    music_needed → music_pending → ready (done) | failed (after 3 attempts)

All DB access goes through a FakeCursor/FakeConn (mirrors
``test_collector_music_integration.py``) — no real Postgres / R2 / network. The
focus is the SQL transitions and the 3-attempt cap + loud terminal failure +
per-post isolation, all driven through the real module functions.

Run:
    python scripts/test_music_enrich_state_machine.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import music_enrich_callback as cb
import music_enrich_db as enrich_db


# ── Fake DB plumbing ──────────────────────────────────────────────────────────

class FakeCursor:
    """Records executes; serves a scripted fetchone() result for the next call.

    ``fetch_result`` is the row returned by the next ``fetchone()`` (a tuple for
    the ``RETURNING`` queries here, or None to simulate "no matching row").
    ``rowcount`` is set from ``fetch_result`` so cur.rowcount stays consistent.
    ``raise_on`` lets a test simulate a DB blow-up to prove isolation.
    """

    def __init__(self, *, fetch_result: Any = None, raise_on: str | None = None):
        self.calls: list[tuple[str, tuple]] = []
        self._fetch_result = fetch_result
        self._raise_on = raise_on
        self.rowcount = 0

    def execute(self, sql, params=None):
        norm = " ".join(sql.split())
        if self._raise_on and self._raise_on in norm:
            raise RuntimeError("simulated DB failure")
        self.calls.append((norm, tuple(params) if params else ()))
        self.rowcount = 1 if self._fetch_result is not None else 0

    def fetchone(self):
        return self._fetch_result

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class FakeConn:
    def __init__(self, cursor: FakeCursor):
        self._cursor = cursor
        self.committed = False

    def cursor(self, *a, **kw):
        return self._cursor

    def commit(self):
        self.committed = True

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class _Patch:
    """Patch ``db_connect`` on a module to yield a given FakeCursor."""

    def __init__(self, module, cursor: FakeCursor):
        self._module = module
        self._cursor = cursor
        self._old = None

    def __enter__(self):
        self._old = self._module.db_connect
        self._module.db_connect = lambda: FakeConn(self._cursor)
        return self._cursor

    def __exit__(self, *a):
        self._module.db_connect = self._old


# Capture tiktok_gram_log output so we can assert log levels (loud ERROR vs WARN).
class _CaptureLog:
    def __init__(self, *modules):
        self._modules = modules
        self._old: list = []
        self.messages: list[str] = []

    def __enter__(self):
        def _sink(msg, *a, **kw):
            self.messages.append(msg)

        for m in self._modules:
            self._old.append((m, m.tiktok_gram_log))
            m.tiktok_gram_log = _sink
        return self

    def __exit__(self, *a):
        for m, fn in self._old:
            m.tiktok_gram_log = fn

    def has_error(self) -> bool:
        return any("ERROR" in msg for msg in self.messages)

    def has_warn(self) -> bool:
        return any("WARN" in msg for msg in self.messages)


def _last_update(cur: FakeCursor):
    """Return (sql, params) of the last UPDATE telegram_post_descriptions call."""
    for sql, params in reversed(cur.calls):
        if sql.startswith("UPDATE telegram_post_descriptions"):
            return sql, params
    return None


# ── Claim: music_needed → pending, increments attempts ────────────────────────

def test_claim_fires_from_music_needed_and_increments_attempts():
    # RETURNING audio_attempts → a row means the claim won.
    cur = FakeCursor(fetch_result=(1,))
    with _Patch(enrich_db, cur):
        won = enrich_db._claim_post_for_music("d1")
    assert won == 1, "claim returns the new audio_attempts when it wins"
    sql, params = _last_update(cur)
    assert "status = 'fetching_audio'" in sql
    assert "audio_attempts = audio_attempts + 1" in sql
    assert "status = 'needs_audio'" in sql, (
        "claim must be guarded on the needs_audio source state"
    )
    assert "tiktok_music_job_id" not in sql, "claim must NOT touch/gate on job id"
    assert "RETURNING audio_attempts" in sql
    assert params == ("d1",)


def test_claim_lost_when_not_music_needed():
    # No RETURNING row (already music_pending/none/etc.) → claim not won.
    cur = FakeCursor(fetch_result=None)
    with _Patch(enrich_db, cur):
        won = enrich_db._claim_post_for_music("d1")
    assert won is None, "claim must return None when the row was not in music_needed"


# ── Release: music_pending → music_needed, attempts NOT decremented ───────────

def test_release_returns_to_music_needed_without_touching_attempts():
    cur = FakeCursor(fetch_result=None)
    with _Patch(enrich_db, cur):
        enrich_db._release_post_claim("d1", "boom")
    sql, params = _last_update(cur)
    assert "status = 'needs_audio'" in sql, (
        "release target must be needs_audio so the cron re-drives it"
    )
    assert "audio_attempts" not in sql, "release must not change the attempt count"
    assert "status = 'fetching_audio'" in sql, "only roll back an in-flight row"
    assert params == ("boom", "d1")


# ── Callback done: music_pending → ready ──────────────────────────────────────

def test_callback_done_marks_ready_from_pending():
    cur = FakeCursor(fetch_result=None)  # _store_track uses rowcount, set below
    cur.rowcount = 0
    with _Patch(cb, cur):
        # rowcount needs to be 1 to count as success; emulate by overriding execute.
        orig_execute = cur.execute

        def exec_ok(sql, params=None):
            orig_execute(sql, params)
            cur.rowcount = 1

        cur.execute = exec_ok
        cb._store_track(
            "d1", job_id="job-1", title="T", author="A", storage_key="postgres"
        )
    sql, params = _last_update(cur)
    assert "status = 'ready'" in sql
    assert "status = 'fetching_audio'" in sql, "ready promotion guarded on status"
    assert params == ("T", "A", "postgres", "d1")


# ── Callback failed: attempts 1,2 → music_needed (WARN); 3 → failed (ERROR) ───

def test_callback_failed_attempt_1_back_to_music_needed():
    # RETURNING (audio_attempts, status) — CASE picked needs_audio.
    cur = FakeCursor(fetch_result=(1, "needs_audio"))
    with _CaptureLog(cb) as log, _Patch(cb, cur):
        cb._store_failed("d1", job_id="job-1", error="pick failed")
    sql, params = _last_update(cur)
    assert "CASE WHEN audio_attempts >= %s THEN 'failed'" in sql
    assert "ELSE 'needs_audio' END" in sql
    assert "RETURNING audio_attempts" in sql
    assert log.has_warn(), "non-terminal failure should log at WARN"
    assert not log.has_error(), "attempt 1 must not be a loud terminal failure"


def test_callback_failed_attempt_2_back_to_music_needed():
    cur = FakeCursor(fetch_result=(2, "needs_audio"))
    with _CaptureLog(cb) as log, _Patch(cb, cur):
        cb._store_failed("d1", job_id="job-1", error="pick failed again")
    assert log.has_warn()
    assert not log.has_error(), "attempt 2 is still retryable, not terminal"


def test_callback_failed_attempt_3_terminal_failed_and_loud():
    # DB CASE resolves to 'failed' once attempts >= 3.
    cur = FakeCursor(fetch_result=(3, "failed"))
    with _CaptureLog(cb) as log, _Patch(cb, cur):
        cb._store_failed("d1", job_id="job-1", error="final boom")
    sql, params = _last_update(cur)
    assert "audio_last_error = %s" in sql
    # audio_last_error must carry the error text.
    assert "final boom" in params, "audio_last_error must be set on terminal failure"
    assert log.has_error(), "terminal (attempt 3) failure MUST log loudly at ERROR"
    assert any("TERMINAL FAILURE" in m for m in log.messages)
    assert any("3 attempts" in m for m in log.messages)


def test_callback_failed_attempt_cap_is_three():
    assert cb._MAX_AUDIO_ATTEMPTS == 3, "attempt cap is locked at 3"


def test_callback_failed_no_matching_row_is_noisy_noop():
    # Re-delivery after a terminal write → no RETURNING row → WARN, no crash.
    cur = FakeCursor(fetch_result=None)
    with _CaptureLog(cb) as log, _Patch(cb, cur):
        cb._store_failed("d1", job_id="stale", error="late")
    assert log.has_warn(), "a no-op failure write must still be logged, never silent"


# ── Isolation: one post's exception must not break another ────────────────────

def test_callback_isolation_one_failure_does_not_block_next():
    results: list[dict] = []

    # Post A: _store_failed raises (simulated DB failure on the UPDATE).
    cur_a = FakeCursor(raise_on="UPDATE telegram_post_descriptions")
    with _CaptureLog(cb) as log_a, _Patch(cb, cur_a):
        res_a = cb._handle_callback(
            "A", job_id="job-A", status="failed", body={"error": "x"}
        )
    results.append(res_a)
    assert res_a["ok"] is False, "a blown-up post returns a structured error"
    assert "RuntimeError" in res_a["error"]
    assert log_a.has_error(), "the isolated failure must be logged loudly"

    # Post B: processed right after, must succeed independently.
    cur_b = FakeCursor(fetch_result=(1, "needs_audio"))
    with _CaptureLog(cb), _Patch(cb, cur_b):
        res_b = cb._handle_callback(
            "B", job_id="job-B", status="failed", body={"error": "y"}
        )
    results.append(res_b)
    assert res_b["ok"] is True, "post B is unaffected by post A's failure"
    assert res_b["descId"] == "B"


def test_handle_callback_http_error_propagates_for_bad_input():
    from fastapi import HTTPException

    # done without download_url → records failure then raises a real 400.
    cur = FakeCursor(fetch_result=(1, "needs_audio"))
    raised = False
    with _CaptureLog(cb), _Patch(cb, cur):
        try:
            cb._handle_callback("d1", job_id="j", status="done", body={})
        except HTTPException as exc:
            raised = True
            assert exc.status_code == 400
    assert raised, "input-shape errors must surface as HTTPException, not be swallowed"


def test_enrich_db_skips_when_not_music_needed():
    # _enrich guard: a post not in music_needed is left alone (no claim/POST).
    import music_enrich as pure

    old_enabled = pure.music_enabled
    old_load = enrich_db.load_post_audio_state
    try:
        enrich_db.music_enabled = lambda: True
        enrich_db.load_post_audio_state = lambda d: {
            "id": d,
            "status": "caching",
            "published_at": None,
        }
        out = enrich_db._enrich("d1")
        assert out.get("skipped") == "already_in_flight", (
            "a 'none' (video) post must not be enriched — only music_needed is"
        )
    finally:
        enrich_db.music_enabled = old_enabled
        enrich_db.load_post_audio_state = old_load


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for t in tests:
        try:
            t()
            print(f"  ok  {t.__name__}")
            passed += 1
        except Exception as e:  # noqa: BLE001
            print(f"  XX  {t.__name__}: {e}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)
