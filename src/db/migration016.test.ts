import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';

function noopMigrationsTableGuard(db: TestDb['db']) {
  // pg-mem's AST-coverage check chokes on re-running
  // `CREATE TABLE IF NOT EXISTS _migrations` once the table exists.
  return db.public.interceptQueries((query) =>
    query.startsWith('CREATE TABLE IF NOT EXISTS _migrations') ? [] : null
  );
}

function taggedDateIndex(db: TestDb['db']) {
  return db.public
    .getTable('world_records')
    .listIndices()
    .find((index) => index.name === 'idx_worlds_tagged_date');
}

// pg-mem has no pg_indexes view, so index presence is asserted against its
// in-memory catalog (IMemoryTable.listIndices()).
describe('migration 016_worlds_tagged_date_index', () => {
  test('creates an expression index on COALESCE(internal_add_date, created_at)', async () => {
    const { db, queryable } = createTestDb();
    await runMigrations(queryable);

    const index = taggedDateIndex(db);
    expect(index).toBeDefined();
    // pg-mem does not serialize the expression text to IndexDef.expressions
    // (it stores [null]), so assert it is an expression-borne index entry.
    expect(index!.expressions.length).toBeGreaterThan(0);
  });

  test('is idempotent when runMigrations runs twice', async () => {
    const { db, queryable } = createTestDb();
    await runMigrations(queryable);

    const guard = noopMigrationsTableGuard(db);
    await runMigrations(queryable);
    guard.unsubscribe();

    const matches = db.public
      .getTable('world_records')
      .listIndices()
      .filter((index) => index.name === 'idx_worlds_tagged_date');
    expect(matches).toHaveLength(1);
  });
});
