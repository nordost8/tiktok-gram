# Setup: adding channels

Requires the userbot to already be logged in — see
[`docs/setup/telegram.md`](telegram.md).

## Add a channel

```bash
pnpm channel:add @some_channel
# also accepts a t.me link or a numeric channel id:
pnpm channel:add https://t.me/some_channel
pnpm channel:add -1001206439755
```

This runs `scripts/add-channel.py`, which:

1. **Joins the channel with the userbot account** (`JoinChannelRequest`) —
   adding a channel here makes your Telegram userbot actually become a
   member of it, the same as if you joined manually.
2. Inserts (or reactivates, if it was previously removed) a row in
   `telegram_channels` with `status = 'active'`.
3. Deliberately leaves `last_synced_message_id` unset — the collector treats
   `NULL` as "do a full initial scan" the next time it runs.

Nothing is ingested by this command alone — run the collector afterwards
(`pnpm channel:add` prints a reminder) to actually pull posts in:

```bash
python3 scripts/collector-sync.py
# or, via Docker, in production:
docker compose --profile cron run --rm collector
```

## Remove a channel

```bash
pnpm channel:remove @some_channel
pnpm channel:remove --dry-run @some_channel   # preview only, changes nothing
```

`scripts/remove-channel.py` does the reverse, in order:

1. Looks up the channel in Postgres.
2. Deletes every R2 object (`storage_key`) belonging to that channel's posts.
3. Deletes the channel row (cascades to its posts, media, likes, saves,
   views via `ON DELETE CASCADE`).
4. Leaves the Telegram channel with the userbot (`LeaveChannelRequest`) —
   best-effort; a failure here is logged as a warning but doesn't roll back
   the DB/R2 deletion that already happened.

`--dry-run` logs everything it *would* do (including how many R2 objects and
which channel row) without touching R2, Postgres, or Telegram.

## User-suggested channels

The Mini App has a "suggest a channel" screen
(`apps/nextjs/src/components/profile/SuggestChannelScreen.tsx`) where any
user can submit a channel name/link plus optional contact info. These land
in the `channel_suggestions` table for the operator to review manually —
submitting a suggestion does **not** automatically add or join the channel.
Use `pnpm channel:add` yourself once you've reviewed a suggestion and decided
to act on it.
