# sos-world-tagger-api — API Guide

The API exposes the world records stored in the Postgres database. It is
intended for dashboards, CI tools, and the Discord bot itself. Read endpoints
mirror the bot's original embedded API; mutation endpoints replace the bot's
direct database writes.

---

## Base URL

```
http://<host>:<port>
```

| Setting | Default | Env Variable |
|---------|---------|--------------|
| Host    | `0.0.0.0` | `API_HOST`   |
| Port    | `3000`    | `API_PORT`   |

---

## Authentication

All endpoints **except** `GET /api/health` require a valid Bearer token:

```
Authorization: Bearer <your-api-token>
```

Tokens are stored in the database and map to a role that carries a set
of permissions.

If the header is missing, malformed, or the token is unknown or revoked, the
server responds with `401 Unauthorized`. If the token is valid but its role
lacks the permission required by the endpoint, the server responds with
`403 Forbidden`.

### Provisioning tokens

Tokens are created, listed, and revoked with the CLI. The raw token is printed
once at creation and cannot be recovered later, so save it immediately.

```bash
# Create a token with a role
pnpm token:create -- --name bot --role curator

# List tokens (name, role, created, last used, revoked status)
pnpm token:list

# Revoke a token
pnpm token:revoke -- --name bot
```

### Roles

Roles own permissions. Changing a role applies immediately to every token
holding it, without re-provisioning tokens.

| Role | Permissions |
|------|-------------|
| `viewer` | `worlds:read`, `tags:read`, `meta:read` |
| `curator` | viewer permissions plus `worlds:write`, `tags:write` |
| `admin` | same as curator today; token generation is planned future work |

The seed roles are created automatically by the database migration. Custom
roles can be defined:

```bash
# List roles and their permissions
pnpm role:list

# Create a custom role
pnpm role:create -- --name curator-v2 --perms worlds:read,tags:read,worlds:write

# Add or remove permissions on a role
pnpm role:update -- --name curator-v2 --add meta:read --remove tags:read
```

### Permissions

| Permission | Routes |
|------------|--------|
| `worlds:read` | `GET /api/worlds`, `GET /api/worlds/search`, `GET /api/worlds/ids`, `GET /api/worlds/:worldId`, `POST /api/worlds/extract` |
| `worlds:write` | `POST /api/worlds`, `DELETE /api/worlds/:worldId`, `PUT /api/worlds/:worldId/quality`, `PUT /api/worlds/:worldId/tags`, `PUT /api/worlds/:worldId/high-priority`, `DELETE /api/worlds/:worldId/high-priority` |
| `tags:read` | `GET /api/tags` |
| `tags:write` | `PUT /api/worlds/:worldId/tags/edit` |
| `meta:read` | `GET /api/meta` |

`GET /api/me` requires no specific permission — any valid token can read its own
identity.

---

## Origin and IP Restrictions

You can lock down the API so only specific browser origins and/or source IP
addresses can reach it. Configure these via environment variables:

| Variable | Description |
|----------|-------------|
| `API_ALLOWED_ORIGINS` | Comma-separated list of allowed `Origin` values. Used for CORS preflight and origin header validation. Supports `*` wildcards. Example: `https://sosd.googoogaagaa.club,https://testnet.googoogaagaa.club`. |
| `API_ALLOWED_IPS` | Comma-separated list of allowed source IP addresses. Example: `203.0.113.42,127.0.0.1`. When set, the API trusts loopback reverse proxies (e.g. Caddy or Nginx on the same host) to provide the real client IP via `X-Forwarded-For`. |

A request to any endpoint except `/api/health` must satisfy **at least one**
configured restriction in addition to presenting a valid token:

- Its `Origin` header matches one of the allowed origins, **or**
- Its source IP matches one of the allowed IPs.

If neither rule is configured, only Bearer token auth is enforced and CORS
falls back to the wildcard `*` for backwards compatibility. The health endpoint
remains publicly reachable for monitoring.

---

## Read Endpoints

### 1. Health Check

```
GET /api/health
```

No authentication or origin/IP restrictions required. Returns basic server
health and database stats.

**Example response**

```json
{
  "status": "ok",
  "worldCount": 1423,
  "dbVersion": 1
}
```

---

### 2. List Worlds

```
GET /api/worlds
```

Returns a paginated, filterable list of world records.

**Query parameters**

| Parameter     | Type              | Default | Max | Description |
|---------------|-------------------|---------|-----|-------------|
| `limit`       | number            | `50`    | 500 | Number of records to return. |
| `offset`      | number            | `0`     | —   | Number of records to skip (for pagination). |
| `tag`         | string / string[] | —       | —   | Filter by tag(s). Comma-separated or repeated. Multiple values use AND logic. |
| `platform`    | string / string[] | —       | —   | Filter by supported platform(s). Comma-separated or repeated. Multiple values use AND logic. |
| `quality`     | string / string[] | —       | —   | Filter by quality. Values: `good`, `bad`. |
| `search`      | string            | —       | —   | Search across name, author, source content, world id, and tags. |
| `minCapacity` | integer           | —       | —   | Minimum world capacity (inclusive). Must be ≥ 1 and ≤ 80. |
| `maxCapacity` | integer           | —       | —   | Maximum world capacity (inclusive). Must be ≥ 1 and ≤ 80. |
| `worldId`     | string / string[] | —       | —   | Filter to specific world ID(s). Comma-separated or repeated. Exact match only. |
| `dayRange`    | integer           | —       | 365 | Return only worlds tagged within the last N days. Values below `0` are treated as `0` (no filter); values above `365` are clamped to `365`. Tagged date uses `internal_add_date` when present, otherwise falls back to `created_at`. |
| `highPriority` | boolean           | —       | —   | When `true`, return only high-priority worlds. Requires `worlds:write`; viewer tokens get `403 Forbidden`. |

**Response**

```json
{
  "total": 1423,
  "limit": 50,
  "offset": 0,
  "worlds": [
    {
      "worldId": "wrld_abc123",
      "name": "Midnight Bar",
      "authorName": "VRChat",
      "capacity": 40,
      "platforms": ["android", "standalonewindows"],
      "tags": ["social", "hangout", "bar"],
      "imageUrl": "https://api.vrchat.cloud/api/1/file/...",
      "vrchatUrl": "https://vrchat.com/home/world/wrld_abc123",
      "quality": "good",
      "highPriority": true,
      "createdAt": "2025-06-01T12:00:00.000Z"
    }
  ]
}
```

The `quality`, `highPriority`, and `guildId` fields are present only for
tokens with the `worlds:write` permission; viewer tokens receive the record
without them.

All filters combine with AND logic. Example:

```
GET /api/worlds?minCapacity=10&maxCapacity=40&quality=good&tag=horror&platform=android
GET /api/worlds?dayRange=7&tag=horror&quality=good
```

---

### 3. Search Worlds

```
GET /api/worlds/search?name=<world-name>
```

Performs a live fuzzy search against the VRChat API and returns the top
matching worlds. Used by the bot to resolve a world ID from a plain-text
world name (e.g. Twitter/X posts without a direct world link).

**Query parameter**

| Parameter | Type   | Required | Description |
|-----------|--------|----------|-------------|
| `name`    | string | yes      | World name to search for. |

**Response**

```json
{
  "worlds": [
    {
      "id": "wrld_abc123",
      "name": "Midnight Bar",
      "authorName": "VRChat",
      "capacity": 40,
      "imageUrl": "https://api.vrchat.cloud/api/1/file/...",
      "unityPackages": []
    }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "name query parameter is required" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `502`  | `{ "error": "Failed to search worlds on VRChat" }` |

---

### 4. Get Single World

```
GET /api/worlds/:worldId
```

Returns the most recent record for a specific VRChat world ID. The
`quality`, `highPriority`, and `guildId` fields follow the same rule as
`GET /api/worlds`: present only for tokens with `worlds:write`.

**Path parameter**

| Parameter | Type   | Description |
|-----------|--------|-------------|
| `worldId` | string | The VRChat world ID (e.g. `wrld_abc123`). |

**Error response** (world not found)

```json
{
  "error": "World not found"
}
```

Status code: **404**

---

### 5. List World IDs

```
GET /api/worlds/ids
```

Returns every distinct world ID currently stored, sorted ascending. This
replaces the former `GET /api/worlds/pairs` endpoint, which was removed when
world records collapsed to one row per world; a client still calling `/pairs`
now hits the detail route with an unknown world ID and receives a 404.

**Response**

```json
{
  "ids": ["wrld_abc123", "wrld_def456"]
}
```

---

### 6. List All Tags

```
GET /api/tags
```

Returns every tag in the canonical `tags` catalog plus every unique tag across
all world records, sorted by frequency (most common first). Unused catalog
tags are included with a count of `0`. Each entry carries the tag's emoji and
hex color from the `tags` table, the single source of truth for tag metadata.
In-data tags missing from the catalog fall back to `"❓"` and `"#94a3b8"`.

**Response**

```json
{
  "tags": [
    { "tag": "horror", "count": 312, "emoji": "👻", "hexColor": "#c084fc" },
    { "tag": "chill", "count": 0, "emoji": "😎", "hexColor": "#06b6d4" }
  ]
}
```

---

### 7. Metadata Counts

```
GET /api/meta
```

Returns high-level dataset counts for quality ratings and platform support
across all world records. Tokens with `worlds:write` also receive
`highPriorityCount`.

**Response**

```json
{
  "qualityGood": 123,
  "qualityBad": 12,
  "platformDesktop": 80,
  "platformAndroid": 45,
  "platformiOS": 6,
  "highPriorityCount": 7
}
```

`highPriorityCount` is present only for tokens with `worlds:write`.

---

## Mutation Endpoints

The bot uses these endpoints to add, update, and delete worlds over HTTP.

World records are keyed by `worldId` alone: there is exactly one record per
world. A `guildId` sent in a mutation body is accepted for backwards
compatibility but ignored, except on `POST /api/worlds` where it remains
required as provenance for the ingest.

### 8. Add World

```
POST /api/worlds
```

The API fetches VRChat data for the world, extracts tags from the message
content, and upserts the record keyed by `worldId`. When the world already
exists, the existing row is updated and its `guildId` is refreshed with the
submitting guild.

**Request body**

```json
{
  "worldId": "wrld_abc123",
  "guildId": "123456789012345678",
  "messageId": "1250000000000000000",
  "content": "https://vrchat.com/home/world/wrld_abc123 Tags: horror, game",
  "messageTimestamp": 1717257600,
  "checkDuplicate": true
}
```

| Field              | Type     | Required | Description |
|--------------------|----------|----------|-------------|
| `worldId`          | string   | yes      | VRChat world ID, must match `wrld_` + 36 hex chars. |
| `guildId`          | string   | yes      | Discord guild ID submitting the world. Stored as provenance. |
| `messageId`        | string   | yes      | Discord message ID (snowflake). Used as the duplicate-response link and to derive `internalAddDate` when `messageTimestamp` is absent. |
| `content`          | string   | yes      | The entire Discord message text. Tag extraction source. |
| `messageTimestamp` | number   | no       | Unix seconds. Stored as `internalAddDate` when provided; otherwise derived from the snowflake. |
| `checkDuplicate`   | boolean  | no       | Default `true`. Set `false` to force a refetch/upsert (the bot's force-refetch flow). |

**New world** — status `201`:

```json
{
  "duplicate": false,
  "world": { "...": "sanitized world object (same shape as GET responses)" }
}
```

**Duplicate** — status `200`:

```json
{
  "duplicate": true,
  "existingMessageId": "1240000000000000000",
  "world": { "...": "sanitized existing world object" }
}
```

The bot replies to the new message with a link to the original message built
from `existingMessageId` and the channel.

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "Invalid body. Expected { worldId, guildId, messageId, content }" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `502`  | `{ "error": "Failed to fetch world data from VRChat" }` |

---

### 9. Extract Worlds

```
POST /api/worlds/extract
```

Resolves VRChat world IDs from message content. Handles direct world links,
Twitter/X links (fetching the tweet via VxTwitter), and plain-text world
names (VRChat search + fuzzy matching). All extraction logic lives in the
API; the bot just forwards message content.

**Request body**

```json
{
  "content": "https://x.com/someuser/status/123"
}
```

**Response** — status `200`:

```json
{
  "worlds": [
    { "worldId": "wrld_abc123", "sourceContent": "https://x.com/someuser/status/123" }
  ]
}
```

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "Invalid body. Expected { content }" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `502`  | `{ "error": "Failed to extract worlds from content" }` |

---

### 10. Delete World

```
DELETE /api/worlds/:worldId
```

Archives the world's record into `deleted_world_records` and removes it from
the live table. This is the undo-tag / remove-reaction flow. The request body
may be empty; a `guildId` sent in the body is accepted and ignored.

**Request body**

```json
{}
```

**Success** — status `204`, no body.

**Errors**

| Status | Body |
|--------|------|
| `401`  | `{ "error": "Unauthorized" }` |
| `404`  | `{ "error": "World not found" }` |

---

### 11. Set Quality

```
PUT /api/worlds/:worldId/quality
```

Sets the quality rating (`good` / `bad`) on the world's record. This is the
👍/👎 reaction flow. Send `"quality": null` to clear the rating. No-op when
the quality is unchanged. A `guildId` in the body is accepted and ignored.

**Request body**

```json
{
  "guildId": "123456789012345678",
  "quality": "good"
}
```

| Field      | Type                      | Required | Description |
|------------|---------------------------|----------|-------------|
| `quality`  | `"good"` \| `"bad"` \| null | yes      | Rating to set; `null` clears it. |
| `guildId`  | string                    | no       | Deprecated. Accepted and ignored. |

**Success** — status `200`:

```json
{
  "updated": true
}
```

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "Invalid body. Expected { quality }" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `404`  | `{ "error": "World not found" }` |

---

### 12. Set Tags

```
PUT /api/worlds/:worldId/tags
```

Recomputes tags and updates the world's record. This is the crawlHistory
backfill flow. Tags are extracted server-side using the shared taxonomy; the
client no longer sends them. No-op when nothing changed. A `guildId` in the
body is accepted and ignored.

`sourceContent` is persisted verbatim as the record's source text. When the
bot backfills a multi-world message, it additionally sends `tagSource` (the
combined tag-extraction input); the server computes tags from
`tagSource ?? sourceContent` but stores only `sourceContent`. This keeps
per-world stored source text faithful while deriving tags from the same
combined input the live flow uses.

**Request body**

```json
{
  "guildId": "123456789012345678",
  "sourceContent": "the original message text",
  "tagSource": "combined cleaned tag source (optional)"
}
```

`sourceContent` may be `null`. `tagSource` is optional. `guildId` is
deprecated: accepted and ignored.

**Success** — status `200`:

```json
{
  "updated": true,
  "tags": ["horror", "game"]
}
```

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "Invalid body. Expected { sourceContent }" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `404`  | `{ "error": "World not found" }` |

---

### 13. Get Current Token

```
GET /api/me
```

Returns the identity of the authenticated token. No permission gate — any
valid token (including `viewer`) can read its own identity.

**Response** — status `200`:

```json
{
  "name": "bot",
  "role": "curator",
  "permissions": ["worlds:read", "tags:read", "meta:read", "worlds:write"]
}
```

**Errors**

| Status | Body |
|--------|------|
| `401`  | `{ "error": "Unauthorized" }` |

---

### 14. Mark World High Priority

```
PUT /api/worlds/:worldId/high-priority
```

Adds the world to the high-priority list. Idempotent: returns `added: false`
when the world is already on the list. The record must exist in
`world_records`. The request body may be empty; a `guildId` is accepted and
ignored.

**Request body**

```json
{}
```

**Success** — status `200`:

```json
{
  "added": true
}
```

**Errors**

| Status | Body |
|--------|------|
| `401`  | `{ "error": "Unauthorized" }` |
| `403`  | `{ "error": "Forbidden" }` |
| `404`  | `{ "error": "World not found" }` |

---

### 15. Remove World High Priority

```
DELETE /api/worlds/:worldId/high-priority
```

Removes the world from the high-priority list. Idempotent: returns
`removed: false` when the world is not on the list. The record must exist in
`world_records`. The request body may be empty; a `guildId` is accepted and
ignored.

**Request body**

```json
{}
```

**Success** — status `200`:

```json
{
  "removed": true
}
```

**Errors**

| Status | Body |
|--------|------|
| `401`  | `{ "error": "Unauthorized" }` |
| `403`  | `{ "error": "Forbidden" }` |
| `404`  | `{ "error": "World not found" }` |

---

### 16. Edit World Tags

```
PUT /api/worlds/:worldId/tags/edit
```

Directly sets the tags on the world's record. Unlike
`PUT /api/worlds/:worldId/tags` (which recomputes tags from message content),
the client supplies the tags and `source_content` is left untouched. Requires
the `tags:write` permission (held by `curator` and `admin` roles). A
`guildId` in the body is accepted and ignored.

Tags are validated against the shared taxonomy; variant spellings are
canonicalized server-side (e.g. `vrmv` → `particle live / vrmv`). Unknown
tags cause a `400` naming the invalid values. An empty `tags` array clears the
world's tags. No-op when the tags are unchanged.

**Request body**

```json
{
  "guildId": "123456789012345678",
  "tags": ["horror", "game"]
}
```

`tags` accepts up to 20 strings.

**Success** — status `200`:

```json
{
  "updated": true,
  "tags": ["horror", "game"]
}
```

**Errors**

| Status | Body |
|--------|------|
| `400`  | `{ "error": "Invalid body. Expected { tags }" }` |
| `400`  | `{ "error": "Invalid tags: <unknown tags>" }` |
| `401`  | `{ "error": "Unauthorized" }` |
| `403`  | `{ "error": "Forbidden" }` |
| `404`  | `{ "error": "World not found" }` |

---

## World Record Schema

Each world object returned by the API has the following fields:

| Field             | Type                     | Description |
|-------------------|--------------------------|-------------|
| `worldId`         | string                   | VRChat world ID (e.g. `wrld_abc123`). |
| `name`            | string \| null           | Display name of the world. |
| `authorName`      | string \| null           | Name of the author / creator. |
| `capacity`        | number \| null           | Maximum player capacity. |
| `platforms`       | string[]                 | Supported platforms (`android`, `standalonewindows`, etc.). |
| `packageSizes`    | (number \| null)[]       | Download size in MB per platform, aligned 1:1 with `platforms`. `null` when the size could not be determined. |
| `tags`            | string[]                 | Tags applied to this world record. |
| `imageUrl`        | string \| null           | Thumbnail image URL from VRChat API. |
| `vrchatUrl`       | string                   | Link to the world on the VRChat website. |
| `quality`         | `"good"` \| `"bad"` \| null | Manual quality rating (if set). Present only for tokens with `worlds:write`. |
| `highPriority`    | boolean                 | Whether the world is on the high-priority list. Present only for tokens with `worlds:write`. |
| `guildId`         | string                   | Discord guild that last submitted or updated the world. Present only for tokens with `worlds:write`. |
| `createdAt`       | string \| undefined      | ISO 8601 timestamp of when the record was created. |
| `internalAddDate` | string \| null           | ISO 8601 timestamp of when the world was originally tagged, if known. |

Internal fields such as `messageId`, `sourceContent`, and `vrchatData` are
intentionally stripped from API responses.

---

## Error Responses

| Status Code | Meaning                  | Body |
|-------------|--------------------------|------|
| `400`       | Invalid query params / body | `{ "error": "..." }` |
| `401`       | Missing / invalid / revoked token | `{ "error": "Unauthorized" }` |
| `403`       | Disallowed origin or IP, or token lacks the required permission | `{ "error": "Forbidden" }` |
| `404`       | World not found / route  | `{ "error": "World not found" }` / `{ "error": "Not Found" }` |
| `502`       | VRChat fetch failure     | `{ "error": "Failed to fetch world data from VRChat" }` |

---

## Example Usage (cURL)

```bash
# Health check (no auth)
curl http://localhost:3000/api/health

# List first 20 worlds tagged "social"
curl -H "Authorization: Bearer my-token" \
  "http://localhost:3000/api/worlds?limit=20&tag=social"

# Get a specific world
curl -H "Authorization: Bearer my-token" \
  "http://localhost:3000/api/worlds/wrld_abc123"

# Search worlds by name (live VRChat search)
curl -H "Authorization: Bearer my-token" \
  "http://localhost:3000/api/worlds/search?name=Midnight%20Bar"

# List all tags
curl -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/tags

# Add a world (bot flow)
curl -X POST -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{
    "worldId": "wrld_abc123",
    "guildId": "123456789012345678",
    "messageId": "1250000000000000000",
    "content": "https://vrchat.com/home/world/wrld_abc123 Tags: horror, game"
  }' \
  http://localhost:3000/api/worlds

# Force refetch an already-tagged world
curl -X POST -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{
    "worldId": "wrld_abc123",
    "guildId": "123456789012345678",
    "messageId": "1250000000000000000",
    "content": "https://vrchat.com/home/world/wrld_abc123",
    "checkDuplicate": false
  }' \
  http://localhost:3000/api/worlds

# Delete a world (undo tag; body optional)
curl -X DELETE -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/worlds/wrld_abc123

# Set quality (👍/👎 reactions)
curl -X PUT -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{"quality": "good"}' \
  http://localhost:3000/api/worlds/wrld_abc123/quality

# Set tags (crawlHistory backfill; tags computed server-side)
curl -X PUT -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{"sourceContent": "the original message text"}' \
  http://localhost:3000/api/worlds/wrld_abc123/tags

# Edit tags directly (tags:write token required; tags validated against taxonomy)
curl -X PUT -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{"tags": ["horror", "game"]}' \
  http://localhost:3000/api/worlds/wrld_abc123/tags/edit

# Extract world IDs from message content (Twitter/X resolution included)
curl -X POST -H "Authorization: Bearer my-token" \
  -H "Content-Type: application/json" \
  -d '{"content": "https://x.com/someuser/status/123"}' \
  http://localhost:3000/api/worlds/extract

# Current token identity
curl -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/me

# Mark / unmark a world as high priority (bodies optional)
curl -X PUT -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/worlds/wrld_abc123/high-priority

curl -X DELETE -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/worlds/wrld_abc123/high-priority

# List the distinct world IDs (replaces the removed /api/worlds/pairs)
curl -H "Authorization: Bearer my-token" \
  http://localhost:3000/api/worlds/ids

# List only high-priority worlds (worlds:write token required)
curl -H "Authorization: Bearer my-token" \
  "http://localhost:3000/api/worlds?highPriority=true"
```
