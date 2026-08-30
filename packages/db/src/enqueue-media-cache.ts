import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const ENQUEUE_SCRIPT = path.join(ROOT, "scripts/media-cache-enqueue.py");

export type EnqueueMediaCacheResult = {
  ok: boolean;
  enqueued?: boolean;
  skipped?: string;
  jobId?: string;
};

/** Enqueue primary media download via Python RQ helper (requires REDIS_URL). */
export function enqueueMediaCache(mediaId: string): EnqueueMediaCacheResult {
  if (!process.env.REDIS_URL?.trim()) {
    return { ok: false, skipped: "no_redis" };
  }

  const result = spawnSync("python3", [ENQUEUE_SCRIPT, mediaId], {
    cwd: ROOT,
    env: process.env,
    encoding: "utf-8",
  });

  if (result.error) {
    return { ok: false, skipped: result.error.message };
  }
  if (result.status !== 0) {
    return {
      ok: false,
      skipped: result.stderr?.trim() || `exit ${result.status}`,
    };
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      results?: Array<{
        enqueued?: boolean;
        jobId?: string;
        skipped?: string;
      }>;
    };
    const first = parsed.results?.[0];
    return {
      ok: true,
      enqueued: first?.enqueued,
      jobId: first?.jobId,
      skipped: first?.skipped,
    };
  } catch {
    return { ok: true };
  }
}
