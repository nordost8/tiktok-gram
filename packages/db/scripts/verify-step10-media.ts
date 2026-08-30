import { sql } from "drizzle-orm";

import { db, dbPool } from "../src/client";

const BASE = process.env.API_BASE ?? "http://localhost:3000";

async function main() {
  const rows = await db.execute<{ id: string; type: string }>(sql`
    SELECT m.id, m.type::text AS type
    FROM telegram_post_media m
    INNER JOIN telegram_posts p ON p.id = m.post_id
    WHERE p.status = 'ready'
      AND m.telegram_access_hash IS NOT NULL
    ORDER BY p.published_at DESC
    LIMIT 1
  `);

  const media = rows.rows[0];
  if (!media) {
    throw new Error("No real media in DB — run pnpm telegram:collect babel");
  }

  const url = `${BASE}/api/media/${media.id}`;
  const head = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1023" } });

  if (head.status !== 206 && head.status !== 200) {
    const text = await head.text();
    throw new Error(`GET ${url} failed: ${head.status} ${text.slice(0, 200)}`);
  }

  const buf = await head.arrayBuffer();
  if (buf.byteLength < 16) {
    throw new Error(`Expected media bytes, got ${buf.byteLength}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      mediaId: media.id,
      type: media.type,
      status: head.status,
      bytes: buf.byteLength,
      contentType: head.headers.get("content-type"),
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await dbPool.end();
  });
