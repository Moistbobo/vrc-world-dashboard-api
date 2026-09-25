import { createTestDb } from './testUtils';

describe('withTransaction', () => {
  it('rejects a nested transaction and never invokes its callback', async () => {
    const { queryable } = createTestDb();
    const nested = vi.fn();
    let error: unknown;

    await queryable.withTransaction(async (tx) => {
      try {
        await tx.withTransaction(nested);
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'nested transactions are not supported'
    );
    expect(nested).not.toHaveBeenCalled();
  });

  it('does not acquire a second connection for a nested attempt', async () => {
    const { queryable, pool } = createTestDb();
    const connect = vi.spyOn(pool, 'connect');

    await queryable.withTransaction(async (tx) => {
      await tx.withTransaction(async () => undefined).catch(() => undefined);
    });

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it('commits work from a top-level transaction', async () => {
    const { queryable } = createTestDb();

    await queryable.withTransaction(async (tx) => {
      await tx.query('CREATE TABLE tx_probe (id integer)');
      await tx.query('INSERT INTO tx_probe (id) VALUES (1)');
    });

    const result = await queryable.query<{ id: number }>(
      'SELECT id FROM tx_probe'
    );
    expect(result.rows).toEqual([{ id: 1 }]);
  });
});
