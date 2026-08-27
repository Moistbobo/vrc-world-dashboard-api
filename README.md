# sos-world-tagger-api

Standalone REST API for the VRChat world tagging system. This is the API
refactor of the `bot_vrc_world_tagger` project: the bot hosts the Discord bot,
this project hosts the Express API that reads and writes the shared world
database.

The API keeps the existing read endpoints (`/api/worlds`, `/api/tags`,
`/api/meta`, `/api/health`) and adds mutation endpoints so the bot can add,
delete, and update worlds over HTTP instead of touching the database directly.

## Architecture

The bot sends the world ID, the guild ID, and the entire Discord message to the
API on add. The API then:

1. Checks for duplicates scoped to `(worldId, guildId)` and returns the
   original `messageId` when one exists, so the bot can reply with the
   "already tagged" link.
2. Fetches the world's data from the VRChat API.
3. Extracts tags from the message content using the shared taxonomy.
4. Upserts the record into Postgres.

## Setup

```bash
pnpm install
cp .env.sample .env
```

Fill in `.env` with:

| Variable | Description |
|----------|-------------|
| `VRC_USERNAME` / `VRC_PASSWORD` / `VRC_TOTP_KEY` | VRChat credentials used to fetch world data on add |
| `WORLD_NAME_MATCHERS` / `AUTHOR_NAME_MATCHERS` | Comma-separated label terms for extracting world/author names from plain-text tweets |
| `API_PORT` / `API_HOST` | Bind address, defaults `3000` / `0.0.0.0` |
| `API_ALLOWED_ORIGINS` | Comma-separated allowed `Origin` values. Leave empty to allow any. |
| `API_ALLOWED_IPS` | Comma-separated allowed source IPs. Leave empty to skip. |
| `DISABLE_API_RESTRICTIONS` | Set `true` to bypass origin/IP allowlists (dev only). |
| `LOG_IP_HASH_SECRET` | Optional HMAC key for hashing client IPs in logs. Random per process when unset. |
| `DATABASE_URL` | Postgres connection string, e.g. `postgres://user:pass@127.0.0.1:5432/sos_world_tagger`. Required at runtime. |
| `DATABASE_PATH` | Legacy SQLite file used only by the one-time `pnpm load-from-sqlite` migration script. Defaults `./worlds.db`. |

API tokens are stored in the database and carry a role. Provision them with
`pnpm token:create -- --name <name> --role <role>` (roles: `viewer`, `curator`,
`admin`). See [docs/API.md](docs/API.md) for the full reference.

## Running

```bash
pnpm start        # build and run
pnpm test         # vitest
pnpm lint         # eslint (zero warnings allowed)
pnpm format       # prettier
```

## Endpoints

Full documentation lives in [docs/API.md](docs/API.md).

Read endpoints:

- `GET /api/health`
- `GET /api/me` (current token: name, role, permissions)
- `GET /api/worlds` (paginated, filterable)
- `GET /api/worlds/search?name=...` (live VRChat world search by name)
- `GET /api/worlds/:worldId`
- `GET /api/tags`
- `GET /api/meta`

Extraction endpoint:

- `POST /api/worlds/extract` — resolve world IDs from message content
  (direct links, Twitter/X links, plain-text world names). Body:
  `{ content }`.

Mutation endpoints:

- `POST /api/worlds` — add a world. Body: `{ worldId, guildId, messageId,
  content, messageTimestamp?, checkDuplicate? }`. Returns `201` with
  `{ duplicate: false, world }` for a new world, or `200` with
  `{ duplicate: true, existingMessageId, world }` for a duplicate.
- `DELETE /api/worlds/:worldId` — delete a world. Body: `{ guildId }`.
- `PUT /api/worlds/:worldId/quality` — set quality. Body:
  `{ guildId, quality: 'good' | 'bad' }`.
- `PUT /api/worlds/:worldId/tags` — recompute tags from source content. Body:
  `{ guildId, sourceContent: string | null, tagSource?: string }`. Tags are
  extracted server-side (from `tagSource` when provided, else `sourceContent`);
  `sourceContent` is stored verbatim. The response includes the computed
  `tags`.
- `PUT /api/worlds/:worldId/high-priority` — mark a world high priority. Body:
  `{ guildId }`. Returns `{ added: boolean }`; `false` when already marked.
- `DELETE /api/worlds/:worldId/high-priority` — unmark a world. Body:
  `{ guildId }`. Returns `{ removed: boolean }`; `false` when not marked.

## Future work

- Allow `admin` tokens to generate access tokens over the API (new
  `tokens:create` permission and `POST /api/tokens` endpoint).
