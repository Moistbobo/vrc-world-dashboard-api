import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import Config from '../config';
import logger from '../logger';
import type { Queryable } from '../db/client';
import { getQueryable } from '../db/pool';
import { runMigrations } from '../db/schema';

/**
 * One-time migration from the legacy SQLite database into Postgres.
 *
 * Load order is FK-safe: roles -> api_tokens -> world_records ->
 * deleted_world_records -> high_priority_worlds. Every insert preserves the
 * source ids and uses ON CONFLICT DO NOTHING so reruns are idempotent.
 *
 * Role ids are NOT copied from SQLite: Postgres migration 006 seeds
 * viewer/curator/admin with its own ids, so api_tokens.role_id is resolved by
 * role NAME against the Postgres roles table.
 */

const MIGRATION_NAMES = [
  '001_create_world_records',
  '002_create_deleted_world_records',
  '003_add_quality_column',
  '004_add_capacity_index',
  '005_add_internal_add_date_column',
  '006_create_roles_and_api_tokens',
  '007_add_package_sizes_column',
  '008_create_high_priority_worlds',
  '009_grant_tags_write_to_curator_and_admin',
  '010_create_tags',
  '011_create_world_tags',
  '012_migrate_world_tags'
];

interface SqliteRoleRow {
  id: number;
  name: string;
  permissions: string | null;
  created_at: number | null;
}

interface SqliteApiTokenRow {
  id: number;
  token_hash: string;
  name: string;
  role_id: number;
  created_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

interface SqliteWorldRow {
  id: number;
  world_id: string;
  guild_id: string;
  message_id: string;
  name: string | null;
  author_name: string | null;
  capacity: number | null;
  platforms: string | null;
  tags: string | null;
  image_url: string | null;
  source_content: string | null;
  vrchat_data: string | null;
  package_sizes: string | null;
  quality: 'good' | 'bad' | null;
  internal_add_date: number | null;
  created_at: number | null;
  updated_at: number | null;
}

interface SqliteDeletedWorldRow extends SqliteWorldRow {
  deleted_at: number | null;
}

interface SqliteHighPriorityRow {
  world_id: string;
  guild_id: string;
  added_at: number | null;
  added_by_token_id: number | null;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

/**
 * The only surface the loaders need from the SQLite reader. Kept minimal so
 * the loaders stay driver-agnostic; node:sqlite's DatabaseSync satisfies it
 * structurally.
 */
interface SqliteSource {
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}

/** JSON-text columns in SQLite become native pg arrays. */
function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || value === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parsePackageSizes(value: unknown): (number | null)[] {
  if (typeof value !== 'string' || value === '') {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as (number | null)[]) : [];
  } catch {
    return [];
  }
}

async function syncSequence(db: Queryable, table: string): Promise<void> {
  await db.query(
    `SELECT setval(
       pg_get_serial_sequence($1, 'id'),
       COALESCE((SELECT MAX(id) FROM ${table}), 1)
     )`,
    [table]
  );
}

/**
 * Copy roles. Seed roles that migration 006 created (viewer/curator/admin)
 * already exist by name, so they are skipped and their Postgres ids recorded.
 * Returns a map of role name -> Postgres role id for api_tokens resolution.
 */
export async function loadRoles(
  db: Queryable,
  source: SqliteSource
): Promise<Map<string, number>> {
  const rows = source
    .prepare(`SELECT id, name, permissions, created_at FROM roles ORDER BY id`)
    .all() as SqliteRoleRow[];

  const roleIdsByName = new Map<string, number>();
  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const existing = await db.query<{ id: string | number }>(
      `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
      [row.name]
    );
    if (existing.rows[0]) {
      roleIdsByName.set(row.name, Number(existing.rows[0].id));
      skipped++;
      continue;
    }

    await db.query(
      `INSERT INTO roles (id, name, permissions, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [
        row.id,
        row.name,
        parseStringArray(row.permissions),
        row.created_at ?? nowSec()
      ]
    );

    const after = await db.query<{ id: string | number }>(
      `SELECT id FROM roles WHERE name = $1 LIMIT 1`,
      [row.name]
    );
    if (!after.rows[0]) {
      logger.warn(
        `Role "${row.name}" (source id ${row.id}) could not be resolved after insert; skipping`
      );
      continue;
    }
    roleIdsByName.set(row.name, Number(after.rows[0].id));
    inserted++;
  }

  await syncSequence(db, 'roles');
  logger.info(
    `roles: ${inserted} inserted, ${skipped} already present, ${roleIdsByName.size} resolvable`
  );
  return roleIdsByName;
}

export async function loadApiTokens(
  db: Queryable,
  source: SqliteSource,
  roleIdsByName: Map<string, number>,
  sourceRoleNameById: Map<number, string>
): Promise<void> {
  const rows = source
    .prepare(
      `SELECT id, token_hash, name, role_id, created_at, last_used_at, revoked_at
       FROM api_tokens ORDER BY id`
    )
    .all() as SqliteApiTokenRow[];

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const roleName = sourceRoleNameById.get(row.role_id);
    const roleId =
      roleName === undefined ? undefined : roleIdsByName.get(roleName);
    if (roleId === undefined) {
      logger.warn(
        `Skipping api_token "${row.name}": role "${roleName ?? 'unknown'}" ` +
          `(source role id ${row.role_id}) not found in Postgres roles`
      );
      skipped++;
      continue;
    }

    const result = await db.query(
      `INSERT INTO api_tokens
         (id, token_hash, name, role_id, created_at, last_used_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        row.id,
        row.token_hash,
        row.name,
        roleId,
        row.created_at ?? nowSec(),
        row.last_used_at,
        row.revoked_at
      ]
    );
    inserted += result.rowCount ?? 0;
  }

  await syncSequence(db, 'api_tokens');
  logger.info(
    `api_tokens: ${inserted} inserted, ${skipped} skipped, ${rows.length - inserted - skipped} already present`
  );
}

export async function loadWorldRecords(
  db: Queryable,
  source: SqliteSource
): Promise<void> {
  const rows = source
    .prepare(
      `SELECT id, world_id, guild_id, message_id, name, author_name, capacity,
              platforms, tags, image_url, source_content, vrchat_data,
              package_sizes, quality, internal_add_date, created_at, updated_at
       FROM world_records ORDER BY id`
    )
    .all() as SqliteWorldRow[];

  const now = nowSec();
  let inserted = 0;

  for (const row of rows) {
    const result = await db.query(
      `INSERT INTO world_records
         (id, world_id, guild_id, message_id, name, author_name, capacity,
          platforms, image_url, source_content, vrchat_data, package_sizes,
          quality, internal_add_date, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       ON CONFLICT DO NOTHING`,
      [
        row.id,
        row.world_id,
        row.guild_id,
        row.message_id,
        row.name,
        row.author_name,
        row.capacity,
        parseStringArray(row.platforms),
        row.image_url,
        row.source_content,
        row.vrchat_data,
        parsePackageSizes(row.package_sizes),
        row.quality ?? null,
        row.internal_add_date ?? null,
        row.created_at ?? now,
        row.updated_at ?? now
      ]
    );
    inserted += result.rowCount ?? 0;

    // Tags live in the world_tags junction now. Ensure each tag exists in
    // the catalog first (FK), then attach one junction row per tag.
    const tags = parseStringArray(row.tags);
    for (const tag of tags) {
      await db.query(
        `INSERT INTO tags (tag, emoji, hex_color)
         VALUES ($1, '❓', '#94a3b8')
         ON CONFLICT (tag) DO NOTHING`,
        [tag]
      );
      await db.query(
        `INSERT INTO world_tags (world_id, guild_id, tag)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [row.world_id, row.guild_id, tag]
      );
    }
  }

  await syncSequence(db, 'world_records');
  logger.info(
    `world_records: ${inserted} inserted, ${rows.length - inserted} already present`
  );
}

export async function loadDeletedWorldRecords(
  db: Queryable,
  source: SqliteSource
): Promise<void> {
  const rows = source
    .prepare(
      `SELECT id, world_id, guild_id, message_id, name, author_name, capacity,
              platforms, tags, image_url, source_content, vrchat_data,
              package_sizes, internal_add_date, created_at, updated_at, deleted_at
       FROM deleted_world_records ORDER BY id`
    )
    .all() as SqliteDeletedWorldRow[];

  const now = nowSec();
  let inserted = 0;

  for (const row of rows) {
    const result = await db.query(
      `INSERT INTO deleted_world_records
         (id, world_id, guild_id, message_id, name, author_name, capacity,
          platforms, tags, image_url, source_content, vrchat_data, package_sizes,
          internal_add_date, created_at, updated_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       ON CONFLICT DO NOTHING`,
      [
        row.id,
        row.world_id,
        row.guild_id,
        row.message_id,
        row.name,
        row.author_name,
        row.capacity,
        parseStringArray(row.platforms),
        parseStringArray(row.tags),
        row.image_url,
        row.source_content,
        row.vrchat_data,
        parsePackageSizes(row.package_sizes),
        row.internal_add_date ?? null,
        row.created_at ?? now,
        row.updated_at ?? now,
        row.deleted_at ?? now
      ]
    );
    inserted += result.rowCount ?? 0;
  }

  await syncSequence(db, 'deleted_world_records');
  logger.info(
    `deleted_world_records: ${inserted} inserted, ${rows.length - inserted} already present`
  );
}

export async function loadHighPriorityWorlds(
  db: Queryable,
  source: SqliteSource
): Promise<void> {
  const rows = source
    .prepare(
      `SELECT world_id, guild_id, added_at, added_by_token_id
       FROM high_priority_worlds ORDER BY world_id, guild_id`
    )
    .all() as SqliteHighPriorityRow[];

  const now = nowSec();
  let inserted = 0;

  for (const row of rows) {
    const result = await db.query(
      `INSERT INTO high_priority_worlds (world_id, guild_id, added_at, added_by_token_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [row.world_id, row.guild_id, row.added_at ?? now, row.added_by_token_id]
    );
    inserted += result.rowCount ?? 0;
  }

  logger.info(
    `high_priority_worlds: ${inserted} inserted, ${rows.length - inserted} already present`
  );
}

/**
 * Run migrations only when Postgres has no world_records table yet; otherwise
 * record the migration names in _migrations so the loaded data is not
 * re-migrated on the next app boot.
 */
async function ensureSchema(db: Queryable): Promise<void> {
  const tableResult = await db.query<{ has_table: boolean }>(
    `SELECT to_regclass('public.world_records') IS NOT NULL AS has_table`
  );

  if (tableResult.rows[0]?.has_table === true) {
    await db.query(
      `CREATE TABLE IF NOT EXISTS _migrations (
         name text PRIMARY KEY,
         applied_at bigint NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))::bigint
       )`
    );
    await db.query(
      `INSERT INTO _migrations (name) SELECT * FROM UNNEST($1::text[]) ON CONFLICT DO NOTHING`,
      [MIGRATION_NAMES]
    );
    logger.info(
      'world_records already exists; seeded _migrations with migration names'
    );
    return;
  }

  await runMigrations(db);
  logger.info('Ran Postgres migrations before loading data');
}

async function withTable<T>(table: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    logger.error(`Failed to load table "${table}":`, error);
    throw error;
  }
}

async function main(): Promise<void> {
  const dbPath = path.resolve(Config.DATABASE_PATH);
  logger.info(`Loading data from SQLite file ${dbPath} into Postgres`);

  const source: SqliteSource = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const db = getQueryable();
    await ensureSchema(db);

    const sourceRoleNameById = new Map<number, string>();
    for (const row of source
      .prepare(`SELECT id, name FROM roles`)
      .all() as SqliteRoleRow[]) {
      sourceRoleNameById.set(row.id, row.name);
    }

    const roleIdsByName = await withTable('roles', () => loadRoles(db, source));
    await withTable('api_tokens', () =>
      loadApiTokens(db, source, roleIdsByName, sourceRoleNameById)
    );
    await withTable('world_records', () => loadWorldRecords(db, source));
    await withTable('deleted_world_records', () =>
      loadDeletedWorldRecords(db, source)
    );
    await withTable('high_priority_worlds', () =>
      loadHighPriorityWorlds(db, source)
    );

    logger.info('SQLite -> Postgres load complete');
  } catch (error) {
    logger.error('Load failed:', error);
    process.exitCode = 1;
  } finally {
    source.close();
  }
}

// jiti rewrites argv[1] to the entry path, so this distinguishes direct
// runs from test imports (require.main is not set by jiti).
if (path.resolve(process.argv[1] || '') === __filename) {
  void main();
}
