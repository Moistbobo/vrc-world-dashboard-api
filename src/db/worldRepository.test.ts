import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { WorldRepository } from './worldRepository';

describe('world records', () => {
  let queryable: TestDb['queryable'];

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
    // pg-mem evaluates `NULL IN (...)` CHECKs as false, so the quality CHECK
    // on world_records rejects inserts/updates that use the default NULL.
    // Drop it in the in-memory test db; no assertion depends on it firing.
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );
  });

  async function addWorld(
    worldId: string,
    guildId: string,
    tags: string[] = [],
    sourceContent: string | null = null
  ): Promise<void> {
    await new WorldRepository(queryable).upsert({
      worldId,
      guildId,
      messageId: '1250000000000000000',
      name: 'Test World',
      authorName: 'Test Author',
      capacity: 16,
      platforms: ['standalonewindows'],
      tags,
      imageUrl: null,
      sourceContent,
      vrchatData: null,
      packageSizes: [],
      createdAt: 1717257600
    });
  }

  describe('updateQuality', () => {
    test('sets quality to good', async () => {
      await addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(queryable);
      expect(await repo.updateQuality('wrld_abc', 'guild-1', 'good')).toBe(
        true
      );
      expect(
        (await repo.getByWorldAndGuild('wrld_abc', 'guild-1'))?.quality
      ).toBe('good');
    });

    test('clears quality with null', async () => {
      await addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(queryable);
      await repo.updateQuality('wrld_abc', 'guild-1', 'good');
      expect(await repo.updateQuality('wrld_abc', 'guild-1', null)).toBe(true);
      expect(
        (await repo.getByWorldAndGuild('wrld_abc', 'guild-1'))?.quality
      ).toBeNull();
    });

    test('clearing an already-null quality reports unchanged', async () => {
      await addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(queryable);
      expect(await repo.updateQuality('wrld_abc', 'guild-1', null)).toBe(false);
    });

    test('returns false when the world does not exist', async () => {
      const repo = new WorldRepository(queryable);
      expect(await repo.updateQuality('wrld_abc', 'guild-1', 'good')).toBe(
        false
      );
    });
  });

  describe('updateTagsOnly', () => {
    test('sets tags without modifying source_content', async () => {
      await addWorld('wrld_abc', 'guild-1', ['kino'], 'original source');
      const repo = new WorldRepository(queryable);

      expect(
        await repo.updateTagsOnly('wrld_abc', 'guild-1', ['horror', 'game'])
      ).toBe(true);

      const record = (await repo.getByWorldAndGuild('wrld_abc', 'guild-1'))!;
      expect(record.tags).toEqual(['horror', 'game']);
      expect(record.sourceContent).toBe('original source');
    });

    test('returns false when the tags are unchanged', async () => {
      await addWorld('wrld_abc', 'guild-1', ['horror']);
      const repo = new WorldRepository(queryable);

      expect(await repo.updateTagsOnly('wrld_abc', 'guild-1', ['horror'])).toBe(
        false
      );
    });

    test('returns false when the record does not exist', async () => {
      const repo = new WorldRepository(queryable);

      expect(
        await repo.updateTagsOnly('wrld_missing', 'guild-1', ['horror'])
      ).toBe(false);
    });
  });

  describe('getAllPaginated', () => {
    test('filters by worldIds without malformed bind params', async () => {
      await addWorld('wrld_abc', 'guild-1');
      await addWorld('wrld_def', 'guild-2');
      const repo = new WorldRepository(queryable);

      const page = await repo.getAllPaginated(10, 0, {
        worldIds: ['wrld_abc', 'wrld_def']
      });
      expect(page.total).toBe(2);
      expect(page.rows.map((r) => r.worldId).sort()).toEqual([
        'wrld_abc',
        'wrld_def'
      ]);
    });

    test('filters by quality values without malformed bind params', async () => {
      await addWorld('wrld_abc', 'guild-1');
      const repo = new WorldRepository(queryable);
      await repo.updateQuality('wrld_abc', 'guild-1', 'good');

      const page = await repo.getAllPaginated(10, 0, { quality: ['good'] });
      expect(page.total).toBe(1);
      expect(page.rows[0].quality).toBe('good');
    });
  });
});

describe('migration 009_grant_tags_write_to_curator_and_admin', () => {
  test('upgrades a pre-existing role, is idempotent, and is safe when a role row is missing', async () => {
    const { queryable, db } = createTestDb();
    await runMigrations(queryable);

    // pg-mem's AST-coverage check chokes on re-running
    // `CREATE TABLE IF NOT EXISTS _migrations` once the table exists, so
    // replay it as a no-op to let runMigrations re-run on the same db.
    const replayGuard = db.public.interceptQueries((query) =>
      query.startsWith('CREATE TABLE IF NOT EXISTS _migrations') ? [] : null
    );

    await queryable.query(
      `UPDATE roles SET permissions = $1::text[] WHERE name = 'curator'`,
      [['worlds:read', 'tags:read', 'meta:read', 'worlds:write']]
    );
    await queryable.query(
      `DELETE FROM _migrations WHERE name = '009_grant_tags_write_to_curator_and_admin'`
    );

    await runMigrations(queryable);

    const curator = await queryable.query<{ permissions: string[] }>(
      `SELECT permissions FROM roles WHERE name = $1`,
      ['curator']
    );
    expect(curator.rows[0].permissions).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:write',
      'tags:write'
    ]);

    await queryable.query(
      `DELETE FROM _migrations WHERE name = '009_grant_tags_write_to_curator_and_admin'`
    );
    await runMigrations(queryable);

    const curatorAgain = await queryable.query<{ permissions: string[] }>(
      `SELECT permissions FROM roles WHERE name = $1`,
      ['curator']
    );
    expect(curatorAgain.rows[0].permissions).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:write',
      'tags:write'
    ]);

    await queryable.query(`DELETE FROM roles WHERE name = 'curator'`);
    await queryable.query(
      `DELETE FROM _migrations WHERE name = '009_grant_tags_write_to_curator_and_admin'`
    );
    await expect(runMigrations(queryable)).resolves.toBeUndefined();
    replayGuard.unsubscribe();
  });
});
