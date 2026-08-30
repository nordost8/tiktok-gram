#!/usr/bin/env python3
"""Tests for Postgres photo storage cap."""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from photo_pg_storage import (  # noqa: E402
    DEFAULT_PHOTO_POST_LIMIT,
    count_cached_photo_posts,
    enforce_photo_post_limit,
    photo_post_limit,
)


class PhotoPgStorageTests(unittest.TestCase):
    def test_default_limit(self):
        os.environ.pop("PHOTO_POST_LIMIT", None)
        self.assertEqual(photo_post_limit(), DEFAULT_PHOTO_POST_LIMIT)

    def test_env_limit(self):
        os.environ["PHOTO_POST_LIMIT"] = "100"
        self.assertEqual(photo_post_limit(), 100)
        os.environ.pop("PHOTO_POST_LIMIT", None)

    def test_enforce_no_evict_under_limit(self):
        cur = MagicMock()
        cur.fetchone.side_effect = [
            (True,),   # desc_is_photo_only
            (False,),  # desc_already_cached
            (10,),     # count_cached_photo_posts
        ]
        evicted = enforce_photo_post_limit(cur, "new-desc")
        self.assertEqual(evicted, [])

    def test_enforce_evicts_when_at_limit(self):
        cur = MagicMock()
        cur.fetchone.side_effect = [
            (True,),   # desc_is_photo_only
            (False,),  # desc_already_cached
            (5000,),   # count_cached_photo_posts
        ]
        cur.fetchall.return_value = [("old-1",), ("old-2",)]
        evicted = enforce_photo_post_limit(cur, "new-desc")
        self.assertEqual(evicted, ["old-1", "old-2"])
        delete_calls = [c for c in cur.execute.call_args_list if "DELETE" in str(c)]
        self.assertEqual(len(delete_calls), 2)


if __name__ == "__main__":
    unittest.main()
