import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations } from '../db/schema';
import { createTestDb, type TestDb } from '../db/testUtils';
import {
  loadApiTokens,
  loadDeletedWorldRecords,
  loadHighPriorityWorlds,
  loadRoles,
  loadWorldRecords
} from './load-from-sqlite';

function createFixture(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE roles (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      permissions TEXT,
      created_at  INTEGER
    );
    CREATE TABLE api_tokens (
      id           INTEGER PRIMARY KEY,
      token_hash   TEXT NOT NULL UNIQUE,
      name         TEXT NOT NULL,
      role_id      INTEGER NOT NULL,
      created_at   INTEGER,
      last_used_at INTEGER,
      revoked_at   INTEGER
    );
    CREATE TABLE world_records (
      id                INTEGER PRIMARY KEY,
      world_id          TEXT NOT NULL,
      guild_id          TEXT NOT NULL,
      message_id        TEXT NOT NULL,
      name              TEXT,
      author_name       TEXT,
      capacity          INTEGER,
      platforms         TEXT,
      tags              TEXT,
      image_url         TEXT,
      source_content    TEXT,
      vrchat_data       TEXT,
      package_sizes     TEXT,
      quality           TEXT,
      internal_add_date INTEGER,
      created_at        INTEGER,
      updated_at        INTEGER
    );
    CREATE TABLE deleted_world_records (
      id                INTEGER PRIMARY KEY,
      world_id          TEXT NOT NULL,
      guild_id          TEXT NOT NULL,
      message_id        TEXT NOT NULL,
      name              TEXT,
      author_name       TEXT,
      capacity          INTEGER,
      platforms         TEXT,
      tags              TEXT,
      image_url         TEXT,
      source_content    TEXT,
      vrchat_data       TEXT,
      package_sizes     TEXT,
      internal_add_date INTEGER,
      created_at        INTEGER,
      updated_at        INTEGER,
      deleted_at        INTEGER
    );
    CREATE TABLE high_priority_worlds (
      world_id          TEXT NOT NULL,
      guild_id          TEXT NOT NULL,
      added_at          INTEGER,
      added_by_token_id INTEGER
    );
  `);

  const roles = db.prepare(
    `INSERT INTO roles (id, name, permissions, created_at) VALUES (?, ?, ?, ?)`
  );
  roles.run(1, 'viewer', '["worlds:read","tags:read","meta:read"]', 1710000000);
  roles.run(4, 'editor', '["worlds:read","worlds:write"]', 1710000001);

  const tokens = db.prepare(
    `INSERT INTO api_tokens
       (id, token_hash, name, role_id, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  tokens.run(1, 'hash_viewer', 'viewer-token', 1, 1710000002, 1710000100, null);
  tokens.run(2, 'hash_editor', 'editor-token', 4, 1710000003, null, null);
  tokens.run(
    3,
    'hash_revoked',
    'revoked-token',
    4,
    1710000004,
    1710000200,
    1710000300
  );

  const worlds = db.prepare(
    `INSERT INTO world_records
       (id, world_id, guild_id, message_id, name, author_name, capacity,
        platforms, tags, image_url, source_content, vrchat_data,
        package_sizes, quality, internal_add_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  worlds.run(
    1,
    'wrld_abc',
    'guild-1',
    'msg-1',
    'Alpha World',
    'Author A',
    16,
    '["standalonewindows","android"]',
    '["horror","kino"]',
    'https://img/a.png',
    'source content',
    '{"version":3}',
    '[104.5,78.2]',
    'good',
    1710000100,
    1710000200,
    1710000300
  );
  worlds.run(
    2,
    'wrld_def',
    'guild-2',
    'msg-2',
    null,
    null,
    null,
    '',
    '',
    null,
    null,
    null,
    '',
    null,
    null,
    null,
    null
  );

  const deleted = db.prepare(
    `INSERT INTO deleted_world_records
       (id, world_id, guild_id, message_id, name, author_name, capacity,
        platforms, tags, image_url, source_content, vrchat_data,
        package_sizes, internal_add_date, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  deleted.run(
    1,
    'wrld_gone',
    'guild-3',
    'msg-3',
    'Deleted World',
    'Author B',
    8,
    '["quest"]',
    '["deleted"]',
    null,
    null,
    null,
    '[12.5]',
    1710000400,
    1710000500,
    1710000600,
    1710000700
  );

  const highPriority = db.prepare(
    `INSERT INTO high_priority_worlds (world_id, guild_id, added_at, added_by_token_id)
     VALUES (?, ?, ?, ?)`
  );
  highPriority.run('wrld_abc', 'guild-1', 1710000800, 1);

  return db;
}

describe('load-from-sqlite', () => {
  let source: DatabaseSync;
  let tmpDir: string;
  let queryable: TestDb['queryable'];
  let db: TestDb['db'];

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-sqlite-'));
    source = createFixture(path.join(tmpDir, 'worlds.db'));
    ({ queryable, db } = createTestDb());
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_constraint_1'
    );
    // pg-mem does not implement pg_get_serial_sequence/setval, so the
    // sequence-resync in syncSequence becomes a no-op here.
    db.public.interceptQueries((query) =>
      query.startsWith('SELECT setval') ? [] : null
    );
  });

  afterEach(() => {
    source.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runLoad(): Promise<void> {
    const sourceRoleNameById = new Map<number, string>();
    for (const row of source
      .prepare(`SELECT id, name FROM roles`)
      .all() as unknown as { id: number; name: string }[]) {
      sourceRoleNameById.set(row.id, row.name);
    }

    const roleIdsByName = await loadRoles(queryable, source);
    await loadApiTokens(queryable, source, roleIdsByName, sourceRoleNameById);
    await loadWorldRecords(queryable, source);
    await loadDeletedWorldRecords(queryable, source);
    await loadHighPriorityWorlds(queryable, source);
  }

  test('loads roles, resolving seeded roles by name and inserting custom ones', async () => {
    await runLoad();

    const roles = await queryable.query<{
      id: number;
      name: string;
      permissions: string[];
      created_at: number;
    }>(`SELECT id, name, permissions, created_at FROM roles ORDER BY id`);

    expect(roles.rows).toHaveLength(4);
    const viewer = roles.rows.find((r) => r.name === 'viewer')!;
    expect(viewer.id).toBe(1);
    expect(viewer.permissions).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read'
    ]);
    const editor = roles.rows.find((r) => r.name === 'editor')!;
    expect(editor.id).toBe(4);
    expect(editor.permissions).toEqual(['worlds:read', 'worlds:write']);
  });

  test('loads api_tokens with role ids resolved by role name', async () => {
    await runLoad();

    const tokens = await queryable.query<{
      id: number;
      token_hash: string;
      name: string;
      role_id: number;
      revoked_at: number | null;
    }>(
      `SELECT id, token_hash, name, role_id, revoked_at
       FROM api_tokens ORDER BY id`
    );

    expect(tokens.rows).toHaveLength(3);
    expect(tokens.rows[0]).toMatchObject({ name: 'viewer-token', role_id: 1 });
    expect(tokens.rows[1]).toMatchObject({ name: 'editor-token', role_id: 4 });
    expect(tokens.rows[2]).toMatchObject({
      name: 'revoked-token',
      role_id: 4,
      revoked_at: 1710000300
    });
  });

  test('loads world_records, converting JSON columns to native arrays', async () => {
    await runLoad();

    const worlds = await queryable.query<{
      world_id: string;
      guild_id: string;
      name: string | null;
      capacity: number | null;
      platforms: string[];
      package_sizes: number[];
      quality: string | null;
      internal_add_date: number | null;
      created_at: number | null;
    }>(
      `SELECT world_id, guild_id, name, capacity, platforms, package_sizes,
              quality, internal_add_date, created_at
       FROM world_records ORDER BY world_id`
    );

    expect(worlds.rows).toHaveLength(2);
    expect(worlds.rows[0]).toMatchObject({
      world_id: 'wrld_abc',
      guild_id: 'guild-1',
      name: 'Alpha World',
      capacity: 16,
      platforms: ['standalonewindows', 'android'],
      package_sizes: [104.5, 78.2],
      quality: 'good',
      internal_add_date: 1710000100,
      created_at: 1710000200
    });
    expect(worlds.rows[1]).toMatchObject({
      world_id: 'wrld_def',
      guild_id: 'guild-2',
      name: null,
      capacity: null,
      platforms: [],
      package_sizes: [],
      quality: null,
      internal_add_date: null
    });

    const junction = await queryable.query<{
      world_id: string;
      tag: string;
    }>(`SELECT world_id, tag FROM world_tags ORDER BY world_id, added_at, id`);
    expect(junction.rows).toEqual([
      { world_id: 'wrld_abc', tag: 'horror' },
      { world_id: 'wrld_abc', tag: 'kino' }
    ]);
  });

  test('loads deleted_world_records and high_priority_worlds', async () => {
    await runLoad();

    const deleted = await queryable.query<{
      world_id: string;
      name: string | null;
      package_sizes: number[];
      deleted_at: number | null;
    }>(
      `SELECT world_id, name, package_sizes, deleted_at
       FROM deleted_world_records`
    );
    expect(deleted.rows).toEqual([
      {
        world_id: 'wrld_gone',
        name: 'Deleted World',
        package_sizes: [12.5],
        deleted_at: 1710000700
      }
    ]);

    const highPriority = await queryable.query<{
      world_id: string;
      guild_id: string;
      added_at: number;
      added_by_token_id: number;
    }>(`SELECT world_id, guild_id, added_at, added_by_token_id
        FROM high_priority_worlds`);
    expect(highPriority.rows).toEqual([
      {
        world_id: 'wrld_abc',
        guild_id: 'guild-1',
        added_at: 1710000800,
        added_by_token_id: 1
      }
    ]);
  });

  test('is idempotent when run twice', async () => {
    await runLoad();
    await runLoad();

    const counts = await queryable.query<{ t: string; n: number }>(
      `SELECT 'roles' AS t, COUNT(*)::int AS n FROM roles
       UNION ALL SELECT 'api_tokens', COUNT(*)::int FROM api_tokens
       UNION ALL SELECT 'world_records', COUNT(*)::int FROM world_records
       UNION ALL SELECT 'world_tags', COUNT(*)::int FROM world_tags
       UNION ALL SELECT 'deleted_world_records', COUNT(*)::int FROM deleted_world_records
       UNION ALL SELECT 'high_priority_worlds', COUNT(*)::int FROM high_priority_worlds`
    );
    expect(counts.rows).toEqual([
      { t: 'roles', n: 4 },
      { t: 'api_tokens', n: 3 },
      { t: 'world_records', n: 2 },
      { t: 'world_tags', n: 2 },
      { t: 'deleted_world_records', n: 1 },
      { t: 'high_priority_worlds', n: 1 }
    ]);
  });
});
