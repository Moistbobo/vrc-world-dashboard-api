import { Pool } from 'pg';
import Config from '../config';
import logger from '../logger';
import { createQueryable, Queryable } from './client';

let pool: Pool | null = null;

/**
 * Lazily-created Postgres connection pool (lazy so jest-mocked config never
 * builds a live pool at import time).
 */
export function getPool(): Pool {
  if (pool) {
    return pool;
  }
  pool = new Pool({ connectionString: Config.DATABASE_URL });
  return pool;
}

export function getQueryable(): Queryable {
  return createQueryable(getPool());
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Postgres pool closed');
  }
}
