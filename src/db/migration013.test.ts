import type { Queryable } from './client';
import { MIGRATIONS, runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';

function noopMigrationsTableGuard(db: TestDb['db']) {
  // pg-mem's AST-coverage check chokes on re-running
  // `CREATE TABLE IF NOT EXISTS _migrations` once the table exists.
  return db.public.interceptQueries((query) =>
    query.startsWith('CREATE TABLE IF NOT EXISTS _migrations') ? [] : null
  );
}

async function runMigrationsThrough(
  queryable: Queryable,
  count: number
): Promise<void> {
  await queryable.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    applied_at bigint NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()))::bigint
  )`);
  for (const migration of MIGRATIONS.slice(0, count)) {
    await queryable.withTransaction(async (tx) => {
      await migration.run(tx);
      await tx.query(`INSERT INTO _migrations (name) VALUES ($1)`, [
        migration.name
      ]);
    });
  }
}

describe('migration 013_world_records_world_id_key', () => {
  test('rebuilds world_records keyed by world_id without an id column', async () => {
    const { queryable } = createTestDb();
    await runMigrations(queryable);

    const columns = await queryable.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'world_records'`
    );
    const names = columns.rows.map((r) => r.column_name);
    expect(names).not.toContain('id');
    expect(names).toContain('guild_id');

    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );
    await queryable.query(
      `INSERT INTO world_records (world_id, guild_id, message_id)
       VALUES ('wrld_abc', 'guild-1', 'm1')`
    );
    await expect(
      queryable.query(
        `INSERT INTO world_records (world_id, guild_id, message_id)
         VALUES ('wrld_abc', 'guild-2', 'm2')`
      )
    ).rejects.toThrow();
    await expect(
      queryable.query(
        `INSERT INTO world_records (world_id, guild_id, message_id)
         VALUES ('wrld_def', 'guild-1', 'm3')`
      )
    ).resolves.toBeDefined();
  });

  test('dedupes multi-guild rows keeping greatest updated_at, ties by greatest id', async () => {
    const { queryable, db } = createTestDb();
    await runMigrationsThrough(queryable, 12);

    await queryable.query(`
      INSERT INTO world_records (world_id, guild_id, message_id, name, quality, updated_at) VALUES
        ('wrld_x', 'guild-a', 'm1', 'old x', 'good', 100),
        ('wrld_x', 'guild-b', 'm2', 'new x', 'bad', 200),
        ('wrld_y', 'guild-a', 'm3', 'tie a', 'good', 300),
        ('wrld_y', 'guild-b', 'm4', 'tie b', 'bad', 300)
    `);
    await queryable.query(`
      INSERT INTO world_tags (world_id, guild_id, tag) VALUES
        ('wrld_x', 'guild-a', 'horror'),
        ('wrld_x', 'guild-b', 'horror'),
        ('wrld_x', 'guild-b', 'game')
    `);

    const guard = noopMigrationsTableGuard(db);
    await runMigrations(queryable);
    guard.unsubscribe();

    const worlds = await queryable.query<{
      world_id: string;
      guild_id: string;
      name: string | null;
    }>(
      `SELECT world_id, guild_id, name FROM world_records ORDER BY world_id`
    );
    expect(worlds.rows).toEqual([
      { world_id: 'wrld_x', guild_id: 'guild-b', name: 'new x' },
      { world_id: 'wrld_y', guild_id: 'guild-b', name: 'tie b' }
    ]);

    const tags = await queryable.query<{ world_id: string; tag: string }>(
      `SELECT world_id, tag FROM world_tags ORDER BY world_id, tag`
    );
    expect(tags.rows).toEqual([
      { world_id: 'wrld_x', tag: 'game' },
      { world_id: 'wrld_x', tag: 'horror' }
    ]);
  });

  test('junction rows cascade away when the world row is deleted', async () => {
    const { queryable } = createTestDb();
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );

    await queryable.query(
      `INSERT INTO world_records (world_id, guild_id, message_id)
       VALUES ('wrld_abc', 'guild-1', 'm1')`
    );
    await queryable.query(
      `INSERT INTO world_tags (world_id, tag) VALUES ('wrld_abc', 'horror')`
    );
    await queryable.query(
      `INSERT INTO high_priority_worlds (world_id) VALUES ('wrld_abc')`
    );

    await queryable.query(`DELETE FROM world_records WHERE world_id = 'wrld_abc'`);

    const junctions = await queryable.query<{ t: string; n: number }>(
      `SELECT 'world_tags' AS t, COUNT(*)::int AS n FROM world_tags
       UNION ALL SELECT 'high_priority_worlds', COUNT(*)::int FROM high_priority_worlds`
    );
    expect(junctions.rows).toEqual([
      { t: 'world_tags', n: 0 },
      { t: 'high_priority_worlds', n: 0 }
    ]);
  });
});
