import { runMigrations } from './schema';
import { createTestDb } from './testUtils';

async function queryRole(
  queryable: ReturnType<typeof createTestDb>['queryable'],
  name: string
): Promise<string[] | undefined> {
  const result = await queryable.query<{ permissions: string[] }>(
    `SELECT permissions FROM roles WHERE name = $1`,
    [name]
  );
  return result.rows[0]?.permissions;
}

describe('migration 017_add_bot_role', () => {
  test('seeds a bot role with the query permission and no write permission', async () => {
    const { queryable } = createTestDb();
    await runMigrations(queryable);

    expect(await queryRole(queryable, 'bot')).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:query'
    ]);
    expect(await queryRole(queryable, 'bot')).not.toContain('worlds:write');
  });

  test('leaves viewer, curator, and admin without worlds:query', async () => {
    const { queryable } = createTestDb();
    await runMigrations(queryable);

    for (const role of ['viewer', 'curator', 'admin']) {
      expect(await queryRole(queryable, role)).not.toContain('worlds:query');
    }
  });

  test('is idempotent and does not duplicate or overwrite the bot role', async () => {
    const { queryable, db } = createTestDb();
    await runMigrations(queryable);

    const replayGuard = db.public.interceptQueries((query) =>
      query.startsWith('CREATE TABLE IF NOT EXISTS _migrations') ? [] : null
    );

    await queryable.query(
      `DELETE FROM _migrations WHERE name = '017_add_bot_role'`
    );
    await runMigrations(queryable);

    const count = await queryable.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total FROM roles WHERE name = 'bot'`
    );
    expect(count.rows[0].total).toBe(1);
    expect(await queryRole(queryable, 'bot')).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:query'
    ]);

    await queryable.query(
      `UPDATE roles SET permissions = $1::text[] WHERE name = 'bot'`,
      [['worlds:read']]
    );
    await queryable.query(
      `DELETE FROM _migrations WHERE name = '017_add_bot_role'`
    );
    await runMigrations(queryable);

    expect(await queryRole(queryable, 'bot')).toEqual(['worlds:read']);
    replayGuard.unsubscribe();
  });
});
