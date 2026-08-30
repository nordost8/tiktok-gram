# Feed ranking

The whole point of an inspectable feed is that you can read the scoring
function instead of trusting a black box. This document mirrors the real
implementation in
[`packages/api/src/lib/feed-query.ts`](../packages/api/src/lib/feed-query.ts) —
read that file directly if anything here goes stale.

## The scoring formula

For each candidate post (`scorePost()`):

```
hoursAgo   = (now - publishedAt) in hours
freshness  = max(0, 72 - hoursAgo) / 72        // 1.0 when brand new, 0 once older than 72h

engagement = likes  * 3
           + saves  * 4
           + views  * 0.1

categoryBoost     = 20  if the post's channel category is one of the viewer's interests, else 0
videoBoost        = 35  if the primary media is a video, else 0
subscriptionBoost = 120 if the viewer is subscribed to the post's channel, else 0

score = freshness * 30 + engagement + categoryBoost + videoBoost + subscriptionBoost
```

A few things worth calling out about the real numbers:

- **Subscription dominates.** At `120`, being subscribed to a channel outweighs
  everything else combined for all but the most-liked posts — subscribed
  content is meant to reliably surface.
- **Freshness decays linearly to zero over 72 hours**, then contributes
  nothing at all (not negative) — an old post from a channel you're
  subscribed to still gets its full `120`, just no freshness bonus.
- **Saves (4) outweigh likes (3) outweigh views (0.1 per view)** — a save is
  the strongest voluntary engagement signal available, a raw view is the
  weakest (and views accumulate fast, so it's weighted down accordingly).
- **Video gets a flat +35** over photo/animation, independent of the
  photo-ratio cap described below.

## Candidate selection, before scoring

`fetchFeedPosts()` doesn't score the whole table — it first filters to posts
that are:

- `status = 'ready'` (the single visibility gate — see the `postStatusEnum`
  lifecycle in `packages/db/src/schema.ts`: caching/needs_audio/fetching_audio/failed
  posts never reach the feed),
- not in a channel the viewer has hidden,
- matching the requested `channelIds` filter if one was given, otherwise
  either matching one of the viewer's interest categories *or* belonging to a
  channel they're subscribed to,
- not already viewed by this profile (unless the caller explicitly asked to
  include viewed posts, e.g. paging through liked/saved history).

It then pulls `limit * 3` candidates (ordered by recency) as the pool to
score and re-rank — a headroom factor so the diversity and photo-ratio passes
below have real alternatives to pick from, not just the single freshest post
per channel.

## Diversity cap

After sorting by score, `applyDiversity()` walks the ranked list and caps any
single channel at **2 posts per page**, backfilling from the remaining
highest-scored posts if the page isn't full once every channel has hit its
cap of 2 (so a full page is still returned even if only one or two channels
have qualifying content).

## Photo ratio cap

`capPhotoRatio()` then enforces that at most `floor(limit * 0.5)` posts on a
page are photos (default 50%), interleaving the allowed photos evenly across
the non-photo posts rather than clustering them. This only applies to the
main feed pagination — direct post lookups (e.g. opening a shared post link)
skip this shaping so a single linked photo post is never dropped.

## Cursor / pagination

Pages are keyed by an opaque `(publishedAt, id)` cursor, base64url-encoded.
The main feed (excluding already-viewed posts) always hands back a cursor
based on the *first* (highest-scored) item of the current page, since the
"already viewed" filter — not the cursor — is what prevents repeats there.
History views (saved/liked, which intentionally re-show viewed posts) instead
page by the oldest item's `(publishedAt, id)`, standard keyset pagination.
