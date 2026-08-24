import { Pool } from 'pg';
import { runMigrations } from './schema';
import { createQueryable } from './client';
import { WorldRepository } from './worldRepository';
import { HighPriorityRepository } from './highPriorityRepository';
import { RoleRepository } from './roleRepository';
import { TokenRepository } from './tokenRepository';

/**
 * Real-Postgres integration suite. pg-mem cannot run `@>` / `&&` / unnest, so
 * the array-operators and the INSERT ... ON CONFLICT DO NOTHING rowCount
 * semantics are covered against a real Postgres here instead. Skips unless
 * TEST_DATABASE_URL is set (load a dedicated throwaway database, e.g.
 * `createdb sos_world_tagger_it`).
 */
const url = process.env.TEST_DATABASE_URL;
const run = url ? describe : describe.skip;

run('Postgres integration', () => {
  const schema = `sos_it_routes_${Date.now()}`;
  let pool: Pool;
  let worlds: WorldRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url });
    const admin = new Pool({ connectionString: url });
    try {
      await pool.query(`CREATE SCHEMA "${schema}"`);
    } finally {
      await admin.end();
    }
    await pool.query(`SET search_path TO "${schema}", public`);
    await runMigrations(createQueryable(pool));
    worlds = new WorldRepository(createQueryable(pool));
    await worlds.upsert({
      worldId: 'wrld_it1',
      guildId: 'guild-1',
      messageId: '1',
      name: 'Integration World',
      authorName: 'Author',
      capacity: 16,
      platforms: ['standalonewindows', 'android'],
      tags: ['horror', 'game'],
      imageUrl: null,
      sourceContent: 'tap jump run',
      vrchatData: null,
      packageSizes: [104.5, 78.2]
    });
    await worlds.upsert({
      worldId: 'wrld_it2',
      guildId: 'guild-1',
      messageId: '2',
      name: 'Other',
      authorName: 'Author',
      capacity: 32,
      platforms: ['android'],
      tags: ['game'],
      imageUrl: null,
      sourceContent: null,
      vrchatData: null,
      packageSizes: []
    });
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  test('multi-tag filter stays AND and rows return numbers, not strings', async () => {
    const page = await worlds.getAllPaginated(10, 0, {
      tags: ['horror', 'game']
    });
    expect(page.total).toBe(1);
    expect(page.rows[0].worldId).toBe('wrld_it1');
    expect(typeof page.rows[0].createdAt).toBe('number');
    expect(page.rows[0].packageSizes).toEqual([104.5, 78.2]);
    expect(page.rows[0].tags).toEqual(['horror', 'game']);
  });

  test('search matches name and tag text via unnest', async () => {
    const byName = await worlds.getAllPaginated(10, 0, { search: 'integrat' });
    expect(byName.total).toBe(1);
    const byTag = await worlds.getAllPaginated(10, 0, { search: 'horror' });
    expect(byTag.total).toBe(1);
  });

  test('facet queries flatten arrays with unnest', async () => {
    const tags = await worlds.getUniqueTags();
    expect(tags).toContainEqual({ tag: 'horror', count: 1 });
    expect(tags).toContainEqual({ tag: 'game', count: 2 });
    const meta = await worlds.getMetadataCounts({
      includeHighPriorityCount: true
    });
    expect(meta.platformDesktop).toBe(1);
    expect(meta.platformAndroid).toBe(2);
    expect(meta.highPriorityCount).toBe(0);
  });

  test('high-priority add is idempotent via rowCount', async () => {
    const hp = new HighPriorityRepository(createQueryable(pool));
    expect(await hp.add('wrld_it1', 'guild-1')).toEqual({ added: true });
    expect(await hp.add('wrld_it1', 'guild-1')).toEqual({ added: false });
    expect(await hp.remove('wrld_it1', 'guild-1')).toEqual({ removed: true });
  });

  test('roles seed and token round-trip with RETURNING id', async () => {
    const roles = new RoleRepository(createQueryable(pool));
    const viewer = await roles.findByName('viewer');
    expect(viewer?.permissions).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read'
    ]);
    const tokens = new TokenRepository(createQueryable(pool));
    const { record } = await tokens.create('it-token', viewer!);
    expect(await tokens.findByHash(record.tokenHash)).toMatchObject({
      name: 'it-token'
    });
    expect(await tokens.revoke('it-token')).toBe(true);
  });
});
