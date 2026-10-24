import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';

function noopMigrationsTableGuard(db: TestDb['db']) {
  return db.public.interceptQueries((query) =>
    query.startsWith('CREATE TABLE IF NOT EXISTS _migrations') ? [] : null
  );
}

async function replayMigration018(
  queryable: TestDb['queryable'],
  db: TestDb['db']
): Promise<void> {
  const guard = noopMigrationsTableGuard(db);
  await queryable.query(
    `DELETE FROM _migrations WHERE name = '018_add_thumbnail_image_url'`
  );
  await runMigrations(queryable);
  guard.unsubscribe();
}

describe('migration 018_add_thumbnail_image_url', () => {
  test('adds thumbnail_image_url to both world tables', async () => {
    const { queryable } = createTestDb();
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );

    await queryable.query(
      `SELECT thumbnail_image_url FROM world_records LIMIT 1`
    );
    await queryable.query(
      `SELECT thumbnail_image_url FROM deleted_world_records LIMIT 1`
    );
  });

  test('backfills existing rows from vrchat_data on both tables', async () => {
    const { queryable, db } = createTestDb();
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );

    await queryable.query(
      `INSERT INTO world_records (world_id, guild_id, message_id, vrchat_data)
       VALUES
         ('wrld_with', 'guild-1', 'msg-1', '{"thumbnailImageUrl":"https://thumb/with.png"}'),
         ('wrld_empty', 'guild-1', 'msg-2', '{"thumbnailImageUrl":""}'),
         ('wrld_missing', 'guild-1', 'msg-3', '{}'),
         ('wrld_null', 'guild-1', 'msg-4', NULL),
         ('wrld_existing', 'guild-1', 'msg-5', '{"thumbnailImageUrl":"https://thumb/new.png"}')`
    );
    await queryable.query(
      `UPDATE world_records SET thumbnail_image_url = 'https://thumb/existing.png'
       WHERE world_id = 'wrld_existing'`
    );
    await queryable.query(
      `INSERT INTO deleted_world_records (world_id, guild_id, message_id, vrchat_data)
       VALUES ('wrld_gone', 'guild-1', 'msg-6', '{"thumbnailImageUrl":"https://thumb/gone.png"}')`
    );

    await replayMigration018(queryable, db);

    const live = await queryable.query<{
      world_id: string;
      thumbnail_image_url: string | null;
    }>(
      `SELECT world_id, thumbnail_image_url FROM world_records ORDER BY world_id`
    );
    expect(live.rows).toEqual([
      { world_id: 'wrld_empty', thumbnail_image_url: null },
      {
        world_id: 'wrld_existing',
        thumbnail_image_url: 'https://thumb/existing.png'
      },
      { world_id: 'wrld_missing', thumbnail_image_url: null },
      { world_id: 'wrld_null', thumbnail_image_url: null },
      { world_id: 'wrld_with', thumbnail_image_url: 'https://thumb/with.png' }
    ]);

    const deleted = await queryable.query<{
      thumbnail_image_url: string | null;
    }>(`SELECT thumbnail_image_url FROM deleted_world_records`);
    expect(deleted.rows).toEqual([
      { thumbnail_image_url: 'https://thumb/gone.png' }
    ]);
  });

  test('is safe to replay', async () => {
    const { queryable, db } = createTestDb();
    await runMigrations(queryable);
    await queryable.query(
      'ALTER TABLE world_records DROP CONSTRAINT world_records_quality_check'
    );

    await queryable.query(
      `INSERT INTO world_records (world_id, guild_id, message_id, vrchat_data)
       VALUES ('wrld_a', 'guild-1', 'msg-1', '{"thumbnailImageUrl":"https://thumb/a.png"}')`
    );

    await replayMigration018(queryable, db);
    await replayMigration018(queryable, db);

    const rows = await queryable.query<{
      thumbnail_image_url: string | null;
    }>(`SELECT thumbnail_image_url FROM world_records`);
    expect(rows.rows).toEqual([{ thumbnail_image_url: 'https://thumb/a.png' }]);
  });
});
