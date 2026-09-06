import { MIGRATIONS, runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { FlagRepository } from './flagRepository';
import { FLAG_SEED } from './flagSeed';
import { WorldRepository } from './worldRepository';
import { RoleRepository } from './roleRepository';
import { TokenRepository } from './tokenRepository';

describe('flag migrations', () => {
  let queryable: TestDb['queryable'];
  let db: TestDb['db'];

  beforeEach(async () => {
    ({ queryable, db } = createTestDb());
    await runMigrations(queryable);
    // pg-mem evaluates `NULL IN (...)` CHECKs as false, so the quality CHECK
    // on world_records rejects inserts that use the default NULL. Drop it in
    // the in-memory test db; no assertion depends on it firing.
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );
  });

  it('applies 014_create_flags then 015_create_world_flags after 013', async () => {
    const names = MIGRATIONS.map((m) => m.name);
    const flagsIdx = names.indexOf('014_create_flags');
    const worldFlagsIdx = names.indexOf('015_create_world_flags');
    const rekeyIdx = names.indexOf('013_world_records_world_id_key');
    expect(flagsIdx).toBeGreaterThan(rekeyIdx);
    expect(worldFlagsIdx).toBe(flagsIdx + 1);

    const applied = await queryable.query<{ name: string }>(
      'SELECT name FROM _migrations'
    );
    const appliedNames = new Set(applied.rows.map((r) => r.name));
    expect(appliedNames.has('014_create_flags')).toBe(true);
    expect(appliedNames.has('015_create_world_flags')).toBe(true);
  });

  it('skips already-applied migrations on re-run', async () => {
    const before = await queryable.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name'
    );
    // pg-mem chokes re-parsing the `_migrations` DDL on the second pass even
    // though it exists, so intercept that no-op CREATE the way Postgres would
    // skip it.
    const guard = db.public.interceptQueries((query) =>
      query.includes('_migrations') && query.includes('CREATE TABLE')
        ? []
        : null
    );
    await runMigrations(queryable);
    guard.unsubscribe();
    const after = await queryable.query<{ name: string }>(
      'SELECT name FROM _migrations ORDER BY name'
    );
    expect(after.rows).toEqual(before.rows);
  });

  it('seeds the flags catalog on a fresh DB with NULL created_by_token_id', async () => {
    const result = await queryable.query<{
      flag: string;
      created_by_token_id: number | null;
    }>('SELECT flag, created_by_token_id FROM flags ORDER BY flag');
    expect(result.rows.map((r) => r.flag).sort()).toEqual(
      [...FLAG_SEED].sort()
    );
    for (const row of result.rows) {
      expect(row.created_by_token_id).toBeNull();
    }
  });

  it('cascades world_flags deletion with the world_records row', async () => {
    await addWorld(queryable, 'wrld_abc');
    const repo = new FlagRepository(queryable);
    await repo.replaceWorldFlags('wrld_abc', ['furry']);
    await new WorldRepository(queryable).deleteByWorldId('wrld_abc');
    const result = await queryable.query<{ count: number }>(
      'SELECT COUNT(*)::int as count FROM world_flags'
    );
    expect(result.rows[0].count).toBe(0);
  });

  it('rejects a world_flags row whose flag is not in the catalog', async () => {
    await addWorld(queryable, 'wrld_abc');
    await expect(
      queryable.query(
        `INSERT INTO world_flags (world_id, flag) VALUES ($1, $2)`,
        ['wrld_abc', 'not-a-real-flag']
      )
    ).rejects.toThrow();
  });

  it('rejects a flags row with an unknown created_by_token_id', async () => {
    await expect(
      queryable.query(
        `INSERT INTO flags (flag, created_by_token_id) VALUES ($1, $2)`,
        ['newflag', 999999]
      )
    ).rejects.toThrow();
  });

  it('NULLs flags.created_by_token_id when the token is deleted', async () => {
    const roles = new RoleRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { record } = await new TokenRepository(queryable).create(
      'flag-token',
      viewer
    );
    await queryable.query(
      `INSERT INTO flags (flag, created_by_token_id) VALUES ($1, $2)`,
      ['newflag', record.id]
    );
    await queryable.query('DELETE FROM api_tokens WHERE id = $1', [record.id]);
    const result = await queryable.query<{
      created_by_token_id: number | null;
    }>('SELECT created_by_token_id FROM flags WHERE flag = $1', ['newflag']);
    expect(result.rows[0].created_by_token_id).toBeNull();
  });
});

describe('flagRepository', () => {
  let queryable: TestDb['queryable'];

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );
  });

  it('getAll returns the seeded catalog flags', async () => {
    const repo = new FlagRepository(queryable);
    expect(await repo.getAll()).toEqual([...FLAG_SEED].sort());
  });

  it('getByWorld returns an empty array for a world with no flags', async () => {
    await addWorld(queryable, 'wrld_abc');
    expect(await new FlagRepository(queryable).getByWorld('wrld_abc')).toEqual(
      []
    );
  });

  it('replaceWorldFlags replaces the full set and records added_by_token_id', async () => {
    await addWorld(queryable, 'wrld_abc');
    const roles = new RoleRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { record } = await new TokenRepository(queryable).create(
      'flag-token',
      viewer
    );
    const repo = new FlagRepository(queryable);
    expect(
      await repo.replaceWorldFlags(
        'wrld_abc',
        ['furry', 'low quality'],
        record.id
      )
    ).toBe(true);
    expect(await repo.getByWorld('wrld_abc')).toEqual(['furry', 'low quality']);

    const tokenRows = await queryable.query<{ added_by_token_id: number }>(
      'SELECT DISTINCT added_by_token_id FROM world_flags WHERE world_id = $1',
      ['wrld_abc']
    );
    expect(tokenRows.rows.map((r) => r.added_by_token_id)).toEqual([record.id]);

    expect(await repo.replaceWorldFlags('wrld_abc', ['AI slop'])).toBe(true);
    expect(await repo.getByWorld('wrld_abc')).toEqual(['AI slop']);
  });

  it('replaceWorldFlags returns false when the set is unchanged', async () => {
    await addWorld(queryable, 'wrld_abc');
    const repo = new FlagRepository(queryable);
    await repo.replaceWorldFlags('wrld_abc', ['furry', 'low quality']);
    expect(
      await repo.replaceWorldFlags('wrld_abc', ['low quality', 'furry'])
    ).toBe(false);
    expect(await repo.getByWorld('wrld_abc')).toEqual(['furry', 'low quality']);
  });

  it('replaceWorldFlags with an empty set clears the world flags', async () => {
    await addWorld(queryable, 'wrld_abc');
    const repo = new FlagRepository(queryable);
    await repo.replaceWorldFlags('wrld_abc', ['furry']);
    expect(await repo.replaceWorldFlags('wrld_abc', [])).toBe(true);
    expect(await repo.getByWorld('wrld_abc')).toEqual([]);
  });

  it('countByFlag counts flags actually present', async () => {
    await addWorld(queryable, 'wrld_a');
    await addWorld(queryable, 'wrld_b');
    const repo = new FlagRepository(queryable);
    await repo.replaceWorldFlags('wrld_a', ['furry', 'AI slop']);
    await repo.replaceWorldFlags('wrld_b', ['furry']);
    expect(await repo.countByFlag()).toEqual([
      { flag: 'furry', count: 2 },
      { flag: 'AI slop', count: 1 }
    ]);
  });
});

async function addWorld(
  queryable: TestDb['queryable'],
  worldId: string
): Promise<void> {
  await new WorldRepository(queryable).upsert({
    worldId,
    guildId: 'guild-1',
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
