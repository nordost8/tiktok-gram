"""PostgreSQL-backed Telethon session — replaces SQLite session file."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import psycopg2
from telethon.crypto import AuthKey
from telethon.sessions import MemorySession

if TYPE_CHECKING:
    from telethon import TelegramClient

SESSION_NAME = "tiktok-gram-collector"


class PostgresSession(MemorySession):
    def __init__(self, pg_url: str, name: str = SESSION_NAME) -> None:
        super().__init__()
        self._pg_url = pg_url
        self._session_name = name
        self._setup()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _conn(self):
        return psycopg2.connect(self._pg_url)

    def _setup(self) -> None:
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS telegram_sessions (
                        name         TEXT PRIMARY KEY,
                        dc_id        INTEGER,
                        server_address TEXT,
                        port         INTEGER,
                        auth_key     BYTEA,
                        entities     JSONB NOT NULL DEFAULT '[]',
                        updated_at   TIMESTAMPTZ DEFAULT NOW()
                    )
                """)
                conn.commit()
                cur.execute(
                    "SELECT dc_id, server_address, port, auth_key, entities "
                    "FROM telegram_sessions WHERE name = %s",
                    (self._session_name,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

        if not row:
            return
        dc_id, addr, port, key_bytes, entities = row
        if dc_id:
            self.set_dc(dc_id, addr, port)
        if key_bytes:
            self.auth_key = AuthKey(data=bytes(key_bytes))
        if entities:
            rows = entities if isinstance(entities, list) else json.loads(entities)
            for e in rows:
                self._entities.add(
                    (e["id"], e["hash"], e.get("username"), e.get("phone"), e.get("name"))
                )

    # ------------------------------------------------------------------
    # Telethon session interface
    # ------------------------------------------------------------------

    def save(self) -> None:
        if not self.auth_key:
            return
        entities_json = json.dumps([
            {"id": r[0], "hash": r[1], "username": r[2], "phone": r[3], "name": r[4]}
            for r in self._entities
        ])
        conn = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO telegram_sessions
                        (name, dc_id, server_address, port, auth_key, entities, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
                    ON CONFLICT (name) DO UPDATE SET
                        dc_id          = EXCLUDED.dc_id,
                        server_address = EXCLUDED.server_address,
                        port           = EXCLUDED.port,
                        auth_key       = EXCLUDED.auth_key,
                        entities       = EXCLUDED.entities,
                        updated_at     = NOW()
                """, (
                    self._session_name,
                    self.dc_id,
                    self.server_address,
                    self.port,
                    self.auth_key.key,
                    entities_json,
                ))
            conn.commit()
        finally:
            conn.close()

    def close(self) -> None:
        self.save()
        super().close()


# ------------------------------------------------------------------
# One-time migration helper
# ------------------------------------------------------------------

def migrate_from_sqlite(sqlite_path: str, pg_url: str, name: str = SESSION_NAME) -> None:
    """Copy auth key + entities from an existing SQLite session into PostgreSQL."""
    import sqlite3

    conn = sqlite3.connect(sqlite_path)
    try:
        cur = conn.cursor()
        cur.execute("SELECT dc_id, server_address, port, auth_key FROM sessions LIMIT 1")
        row = cur.fetchone()
        if not row:
            print("No session data in SQLite.")
            return
        dc_id, addr, port, auth_key_bytes = row
        cur.execute("SELECT id, hash, username, phone, name FROM entities")
        entities = [
            {"id": r[0], "hash": r[1], "username": r[2], "phone": r[3], "name": r[4]}
            for r in cur.fetchall()
        ]
    finally:
        conn.close()

    pg_conn = psycopg2.connect(pg_url)
    try:
        with pg_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS telegram_sessions (
                    name TEXT PRIMARY KEY, dc_id INTEGER, server_address TEXT,
                    port INTEGER, auth_key BYTEA, entities JSONB NOT NULL DEFAULT '[]',
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("""
                INSERT INTO telegram_sessions
                    (name, dc_id, server_address, port, auth_key, entities, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s::jsonb, NOW())
                ON CONFLICT (name) DO UPDATE SET
                    dc_id=EXCLUDED.dc_id, server_address=EXCLUDED.server_address,
                    port=EXCLUDED.port, auth_key=EXCLUDED.auth_key,
                    entities=EXCLUDED.entities, updated_at=NOW()
            """, (name, dc_id, addr, port, auth_key_bytes, json.dumps(entities)))
        pg_conn.commit()
        print(f"Migrated: DC{dc_id} {addr}:{port}, {len(entities)} entities → PostgreSQL")
    finally:
        pg_conn.close()
