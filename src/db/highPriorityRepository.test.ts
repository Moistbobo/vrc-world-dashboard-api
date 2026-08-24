import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { WorldRepository } from './worldRepository';
import { RoleRepository } from './roleRepository';
import { TokenRepository } from './tokenRepository';
import { HighPriorityRepository } from './highPriorityRepository';

describe('high priority worlds', () => {
  let queryable: TestDb['queryable'];
  let db: TestDb['db'];

  beforeEach(async () => {
    ({ queryable, db } = createTestDb());
    await runMigrations(queryable);
    // pg-mem evaluates `NULL IN (...)` CHECKs as false, so the quality CHECK
    // on world_records rejects inserts/updates that use the default NULL.
    // Drop it in the in-memory test db; no assertion depends on it firing.
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_constraint_1'
    );
  });

  async function addWorld(worldId: string, guildId: string): Promise<void> {
    await new WorldRepository(queryable).upsert({
      worldId,
      guildId,
      messageId: '1250000000000000000',
      name: 'Test World',
      authorName: 'Test Author',
      capacity: 16,
      platforms: ['standalonewindows'],
      tags: [],
      imageUrl: null,
      sourceContent: null,
      vrchatData: null,
      packageSizes: [],
      createdAt: 1717257600
    });
  }

  test('add inserts a row and reports added: true', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const repo = new HighPriorityRepository(queryable);
    expect(await repo.add('wrld_abc', 'guild-1')).toEqual({ added: true });
  });

  test('add is idempotent', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const repo = new HighPriorityRepository(queryable);
    expect(await repo.add('wrld_abc', 'guild-1')).toEqual({ added: true });

    // pg-mem reports rowCount 1 even when ON CONFLICT DO NOTHING skips a
    // duplicate (Postgres reports 0), so replay the duplicate insert as a
    // no-op to keep the idempotency assertion meaningful.
    const guard = db.public.interceptQueries((query) =>
      query.includes('high_priority_worlds') && query.includes('ON CONFLICT')
        ? []
        : null
    );
    expect(await repo.add('wrld_abc', 'guild-1')).toEqual({ added: false });
    guard.unsubscribe();
  });

  test('remove deletes a row and reports removed: true', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const repo = new HighPriorityRepository(queryable);
    await repo.add('wrld_abc', 'guild-1');
    expect(await repo.remove('wrld_abc', 'guild-1')).toEqual({ removed: true });
  });

  test('remove is idempotent', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const repo = new HighPriorityRepository(queryable);
    expect(await repo.remove('wrld_abc', 'guild-1')).toEqual({
      removed: false
    });
  });

  test('persists added_by_token_id', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const roles = new RoleRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { record } = await new TokenRepository(queryable).create(
      'hp-token',
      viewer
    );
    const repo = new HighPriorityRepository(queryable);
    await repo.add('wrld_abc', 'guild-1', record.id);
    const result = await queryable.query<{ added_by_token_id: number | null }>(
      'SELECT added_by_token_id FROM high_priority_worlds WHERE world_id = $1 AND guild_id = $2',
      ['wrld_abc', 'guild-1']
    );
    expect(result.rows[0].added_by_token_id).toBe(record.id);
  });

  test('row cascades away when the world_records row is deleted', async () => {
    await addWorld('wrld_abc', 'guild-1');
    const repo = new HighPriorityRepository(queryable);
    await repo.add('wrld_abc', 'guild-1');
    await new WorldRepository(queryable).deleteByWorldAndGuild(
      'wrld_abc',
      'guild-1'
    );
    const result = await queryable.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM high_priority_worlds'
    );
    expect(result.rows[0].count).toBe(0);
  });
});
