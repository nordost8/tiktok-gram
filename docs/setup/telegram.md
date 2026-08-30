# Setup: Telegram

Two entirely separate Telegram identities are involved here. Don't confuse
them.

## 1. The userbot (collects posts)

This is a **real Telegram user account**, logged in over MTProto via
[Telethon](https://docs.telethon.dev/), that joins the channels you add and
polls them for new posts. It is not a Bot API bot — Telegram bots cannot join
channels as a member or read full channel history the way a user account
can, which is why the collector needs a real account.

### Get your own `api_id` / `api_hash`

1. Go to <https://my.telegram.org>, log in with a phone number, open **API
   development tools**, and create an app. This gives you a `TELEGRAM_API_ID`
   and `TELEGRAM_API_HASH`.
2. **You must obtain your own `api_id`/`api_hash` — never reuse this
   project's or anyone else's.** Telegram issues one `api_id` per phone
   number, the `api_hash` cannot be revoked once issued, and Telegram's own
   docs warn that publishing an `api_id` in shared/public code causes an
   `API_ID_PUBLISHED_FLOOD` error for *everyone* using it, including you.
   There is no working around this by rotating hashes — get your own.
3. It's recommended to use a **dedicated Telegram account/phone number** for
   the userbot rather than your personal account, since this account will
   join every channel you configure and its session lives in your database
   (see below).

### Log in

1. Fill in `.env`:
   ```bash
   TELEGRAM_API_ID=<from my.telegram.org>
   TELEGRAM_API_HASH=<from my.telegram.org>
   TELEGRAM_PHONE=+1...
   ```
2. Run:
   ```bash
   pnpm telegram:channels
   ```
   (this runs `scripts/telegram-list-channels.py` — a one-off login-and-list
   check). On first run it will fail and tell you to add
   `TELEGRAM_LOGIN_CODE` to `.env` with the code Telegram just sent to that
   account, then rerun the same command.
3. If the account has 2FA enabled, also fill in `TELEGRAM_2FA_PASSWORD`
   before rerunning.
4. Once logged in, the command prints your account info and the channels
   that account is currently a member of — confirming the session works.

### Where the session lives

The Telethon session (auth key + known entities) is stored in **Postgres**,
in the `telegram_sessions` table, via a custom `PostgresSession`
implementation (`scripts/telegram_session_pg.py`) — not a local `.session`
file. This means the collector and media-worker containers share one login
without any file volume, and a fresh container can pick up right where the
last one left off.

It also means: **anyone with read access to the `telegram_sessions.auth_key`
column has full access to that Telegram account** (send messages, read
chats, join/leave channels — everything). Treat database backups and access
grants accordingly, the same way you'd treat a leaked session file.

## 2. The Mini App bot (what users actually talk to)

This is a normal Bot API bot, used only for:

- the welcome message the Mini App shows on first open, and
- the native Telegram "share" button (`savePreparedInlineMessage`).

It never collects channel content — that's entirely the userbot's job.

1. Message [@BotFather](https://t.me/BotFather) on Telegram, run `/newbot`,
   follow the prompts.
2. Copy the token it gives you into `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=<token from BotFather>
   ```
3. If you have a public `SITE_URL` set, the app registers the bot's webhook
   automatically on boot.

## Next step

Once the userbot is logged in, add channels for it to follow — see
[`docs/setup/channels.md`](channels.md).
