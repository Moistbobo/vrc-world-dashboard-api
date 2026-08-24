import { newDb, type IMemoryDb } from 'pg-mem';
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
 */
export function createTestDb(): TestDb {
  const db = newDb();
  const { Pool: MemPool } = db.adapters.createPg();
  const pool = new MemPool() as unknown as Pool;
  const queryable = createQueryable(pool);
  return { db, pool, queryable };
}
