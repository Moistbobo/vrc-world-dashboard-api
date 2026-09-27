import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { WorldRepository } from './worldRepository';
import { FlagRepository } from './flagRepository';
import type { WorldsQuery } from '../worlds/query';

interface AddOptions {
  tags?: string[];
  flags?: string[];
  capacity?: number;
  platforms?: string[];
  name?: string;
}

describe('worldRepository query DSL', () => {
  let queryable: TestDb['queryable'];

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );
  });

  async function addWorld(
    worldId: string,
    options: AddOptions = {}
  ): Promise<void> {
    await new WorldRepository(queryable).upsert({
      worldId,
      guildId: 'guild-1',
      messageId: '1250000000000000000',
      name: options.name ?? 'Test World',
      authorName: 'Test Author',
      capacity: options.capacity ?? 16,
      platforms: options.platforms ?? ['standalonewindows'],
      tags: options.tags ?? [],
      imageUrl: null,
      sourceContent: null,
      vrchatData: null,
      packageSizes: [],
      createdAt: 1717257600
    });
    if (options.flags && options.flags.length > 0) {
      await new FlagRepository(queryable).replaceWorldFlags(
        worldId,
        options.flags
      );
    }
  }

  function where(groups: WorldsQuery['groups']): WorldsQuery {
    return { groups };
  }

  async function idsMatching(query: WorldsQuery): Promise<string[]> {
    const page = await new WorldRepository(queryable).getAllPaginated(50, 0, {
      where: query
    });
    return page.rows.map((row) => row.worldId).sort();
  }

  test('AC-2 unions two OR groups without duplicate rows', async () => {
    await addWorld('wrld_kino', { tags: ['kino'] });
    await addWorld('wrld_horror', { tags: ['horror'] });
    await addWorld('wrld_both', { tags: ['kino', 'horror'] });
    await addWorld('wrld_chill', { tags: ['chill'] });

    const total = (
      await new WorldRepository(queryable).getAllPaginated(50, 0, {
        where: where([
          {
            connector: 'or',
            conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
          },
          {
            connector: 'or',
            conditions: [{ field: 'tag', op: 'has', value: 'horror' }]
          }
        ])
      })
    ).total;

    expect(total).toBe(3);
    expect(
      await idsMatching(
        where([
          {
            connector: 'or',
            conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
          },
          {
            connector: 'or',
            conditions: [{ field: 'tag', op: 'has', value: 'horror' }]
          }
        ])
      )
    ).toEqual(['wrld_both', 'wrld_horror', 'wrld_kino']);
  });

  test('AC-3 a negated flag has excludes worlds carrying it', async () => {
    await addWorld('wrld_furry', { flags: ['furry'] });
    await addWorld('wrld_clean');

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [
              { field: 'flag', op: 'has', value: 'furry', negate: true }
            ]
          }
        ])
      )
    ).toEqual(['wrld_clean']);
  });

  test('AC-5 an absent tag or flag value matches nothing', async () => {
    await addWorld('wrld_a', { tags: ['kino'], flags: ['furry'] });

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [{ field: 'tag', op: 'has', value: 'nonexistent' }]
          }
        ])
      )
    ).toEqual([]);
    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [{ field: 'flag', op: 'has', value: 'nonexistent' }]
          }
        ])
      )
    ).toEqual([]);
  });

  test('AC-10 an injection-shaped value is bound and leaves the table intact', async () => {
    await addWorld('wrld_a', { tags: ['kino'] });
    const payload = "'; DROP TABLE world_records; --";

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [{ field: 'name', op: 'eq', value: payload }]
          }
        ])
      )
    ).toEqual([]);

    const count = await queryable.query<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM world_records'
    );
    expect(count.rows[0].total).toBe(1);
  });

  test('AC-13 empty groups return the unfiltered list', async () => {
    await addWorld('wrld_a', { tags: ['kino'] });
    await addWorld('wrld_b', { tags: ['horror'] });

    const page = await new WorldRepository(queryable).getAllPaginated(50, 0, {
      where: where([])
    });
    expect(page.total).toBe(2);
    expect(page.rows).toHaveLength(2);
  });

  test('AC-14 an empty group is dropped beside a populated group', async () => {
    await addWorld('wrld_kino', { tags: ['kino'] });
    await addWorld('wrld_horror', { tags: ['horror'] });

    expect(
      await idsMatching(
        where([
          { connector: 'and', conditions: [] },
          {
            connector: 'and',
            conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
          }
        ])
      )
    ).toEqual(['wrld_kino']);
  });

  test('AC-9 sorts by capacity ascending via sortField', async () => {
    await addWorld('wrld_small', { capacity: 10 });
    await addWorld('wrld_mid', { capacity: 20 });
    await addWorld('wrld_big', { capacity: 30 });

    const page = await new WorldRepository(queryable).getAllPaginated(50, 0, {
      where: where([]),
      sortField: 'capacity',
      sortOrder: 'asc'
    });
    expect(page.rows.map((row) => row.capacity)).toEqual([10, 20, 30]);
  });

  test('platform membership uses ANY, not @> or &&', async () => {
    await addWorld('wrld_pc', { platforms: ['standalonewindows', 'android'] });
    await addWorld('wrld_mobile', { platforms: ['android'] });

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [
              { field: 'platform', op: 'has', value: 'standalonewindows' }
            ]
          }
        ])
      )
    ).toEqual(['wrld_pc']);

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [
              { field: 'platform', op: 'hasAny', values: ['ios', 'android'] }
            ]
          }
        ])
      )
    ).toEqual(['wrld_mobile', 'wrld_pc']);
  });

  test('script executes under the pg-mem regex shim', async () => {
    await addWorld('wrld_cyrillic', { name: 'Мир' });
    await addWorld('wrld_named', { name: 'Spooky Mansion' });

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [{ field: 'name', op: 'script', value: 'cyrillic' }]
          }
        ])
      )
    ).toEqual(['wrld_cyrillic']);
  });

  test('tag hasAll requires every tag', async () => {
    await addWorld('wrld_both', { tags: ['kino', 'horror'] });
    await addWorld('wrld_kino', { tags: ['kino'] });

    expect(
      await idsMatching(
        where([
          {
            connector: 'and',
            conditions: [
              { field: 'tag', op: 'hasAll', values: ['kino', 'horror'] }
            ]
          }
        ])
      )
    ).toEqual(['wrld_both']);
  });
});
