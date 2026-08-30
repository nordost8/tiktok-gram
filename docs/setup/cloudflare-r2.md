# Setup: Cloudflare R2

Video is stored in a Cloudflare R2 bucket and streamed to the browser via
short-lived presigned URLs — the app never proxies video bytes (see
[`apps/nextjs/src/lib/media/object-storage.ts`](../../apps/nextjs/src/lib/media/object-storage.ts)).
Photos and audio are small enough to live directly in Postgres instead, so
they don't touch R2 at all.

## 1. Create a Cloudflare account and an R2 bucket

1. Sign up / log in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **R2 Object Storage** → **Create bucket**. Name it whatever you like
   (the default in this repo's examples is `tiktok-gram-media`) and pick
   **Standard** storage (not Infrequent Access — Infrequent Access does not
   get the same egress/pricing treatment described below).

## 2. Create a scoped API token

1. In R2 → **Manage API Tokens** → **Create API Token**.
2. Scope it to **Object Read & Write**, restricted to the one bucket you just
   created — don't create an account-wide token for this.
3. Cloudflare shows the **Access Key ID** and **Secret Access Key** exactly
   once. Copy both immediately; the secret cannot be retrieved again (you'd
   have to issue a new token).

## 3. Fill in `.env`

```bash
S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
S3_ACCESS_KEY_ID="<the access key id from step 2>"
S3_SECRET_ACCESS_KEY="<the secret access key from step 2>"
S3_BUCKET="tiktok-gram-media"
S3_REGION="auto"
```

`<ACCOUNT_ID>` is your Cloudflare account ID, visible on the R2 overview page
or in the dashboard URL.

## 4. Bucket visibility and CORS

The bucket does **not** need to be public — every video URL the app hands
out is a short-lived presigned URL (`getPresignedMediaUrl`, 1 hour expiry,
cached client-side for ~58 minutes). It does, however, need a **CORS
policy** allowing your app's origin, because the browser fetches these R2
URLs cross-origin directly (not proxied through the Next.js server). In the
bucket's **Settings → CORS Policy**, add an entry allowing `GET` (and
`HEAD`) from your app's origin(s) — your production domain and
`http://localhost:3000` for local dev.

## 5. Free tier

Per Cloudflare's published pricing (as of writing — verify current limits
before relying on them):

- **10 GB-month** of Standard storage, free
- **1,000,000** Class A operations/month, free (writes, lists)
- **10,000,000** Class B operations/month, free (reads)
- **Zero egress fees** — Standard storage only, doesn't apply to
  Infrequent Access

This repo's [fair-eviction media cache](../media-cache.md) keeps total
cached video under a 9.8 GB budget by default specifically to stay inside
the 10 GB free tier with headroom for R2's decimal-byte accounting.
