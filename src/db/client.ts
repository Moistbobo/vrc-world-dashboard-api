import { Pool, QueryResult, QueryResultRow } from 'pg';

/**
 * The only database surface repositories, migrations, and tests depend on.
 * Both a real pg.Pool (wrapped by createQueryable) and the pg-mem adapter's
 * Pool conform to this, so tests can inject an in-memory Postgres.
 */
export interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<R>>;
  withTransaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
}

function txQueryable(client: Queryable, pool: Pool): Queryable {
  return {
    query: (text, values) => client.query(text, values),
    withTransaction: (fn) => runTransaction(pool, fn)
  };
}

async function runTransaction<T>(
  pool: Pool,
  fn: (q: Queryable) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Queryable = txQueryable(
      {
        query: (text, values) => client.query(text, values),
        withTransaction: () =>
          Promise.reject(new Error('nested transactions are not supported'))
      },
      pool
    );
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function createQueryable(pool: Pool): Queryable {
  return {
    query: (text, values) => pool.query(text, values),
    withTransaction: (fn) => runTransaction(pool, fn)
  };
}
