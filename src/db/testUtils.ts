import { newDb, DataType, type IMemoryDb } from 'pg-mem';
import { Pool } from 'pg';
import { createQueryable, type Queryable } from './client';

export interface TestDb {
  db: IMemoryDb;
  pool: Pool;
  queryable: Queryable;
}

/**
 * Build an in-memory Postgres backed by pg-mem with a Queryable that repos
 * can be injected with.
 *
 * pg-mem does not ship the POSIX regex operators the query DSL's `script`
 * operator emits, so register `~` / `!~` with JavaScript's RegExp engine.
 */
export function createTestDb(): TestDb {
  const db = newDb();
  db.public.registerOperator({
    operator: '~',
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) =>
      new RegExp(pattern, 'u').test(value)
  });
  db.public.registerOperator({
    operator: '!~',
    left: DataType.text,
    right: DataType.text,
    returns: DataType.bool,
    implementation: (value: string, pattern: string) =>
      !new RegExp(pattern, 'u').test(value)
  });
  const { Pool: MemPool } = db.adapters.createPg();
  const pool = new MemPool() as unknown as Pool;
  const queryable = createQueryable(pool);
  return { db, pool, queryable };
}
