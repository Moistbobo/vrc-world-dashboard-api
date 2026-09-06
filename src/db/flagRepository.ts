import type { Queryable } from './client';
import { getQueryable } from './pool';

export class FlagRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  async getAll(): Promise<string[]> {
    const result = await this.db.query<{ flag: string }>(
      `SELECT flag FROM flags ORDER BY flag`
    );
    return result.rows.map((r) => r.flag);
  }

  async getByWorld(worldId: string): Promise<string[]> {
    const result = await this.db.query<{ flag: string }>(
      `SELECT flag FROM world_flags WHERE world_id = $1 ORDER BY flag`,
      [worldId]
    );
    return result.rows.map((r) => r.flag);
  }

  /**
   * Replace the flags on a world with the given set. Deletes existing junction
   * rows for the world, then inserts one row per flag. Must run inside a
   * transaction so a partial replacement cannot be observed. Returns whether
   * anything changed; replaying the same set is a no-op that returns false.
   */
  async replaceWorldFlags(
    worldId: string,
    flags: string[],
    addedByTokenId?: number
  ): Promise<boolean> {
    return this.db.withTransaction(async (tx) => {
      const existing = await tx.query<{ flag: string }>(
        `SELECT flag FROM world_flags WHERE world_id = $1`,
        [worldId]
      );
      const existingSet = new Set(existing.rows.map((r) => r.flag));
      const newSet = new Set(flags);
      const unchanged =
        existingSet.size === newSet.size &&
        flags.every((f) => existingSet.has(f));
      if (unchanged) {
        return false;
      }

      await tx.query(`DELETE FROM world_flags WHERE world_id = $1`, [worldId]);
      if (flags.length === 0) {
        return true;
      }
      const values = flags.flatMap((f) => [worldId, f, addedByTokenId ?? null]);
      const placeholders = flags
        .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
        .join(', ');
      await tx.query(
        `INSERT INTO world_flags (world_id, flag, added_by_token_id)
         VALUES ${placeholders}`,
        values
      );
      return true;
    });
  }

  async countByFlag(): Promise<{ flag: string; count: number }[]> {
    const result = await this.db.query<{ flag: string; count: number }>(
      `SELECT flag, COUNT(*)::int AS count
       FROM world_flags
       GROUP BY flag
       ORDER BY count DESC, flag`
    );
    return result.rows.map((r) => ({ flag: r.flag, count: r.count }));
  }
}

let repoInstance: FlagRepository | null = null;

export function getFlagRepository(): FlagRepository {
  if (!repoInstance) {
    repoInstance = new FlagRepository();
  }
  return repoInstance;
}

/** Reset the singleton (useful in tests). */
export function resetFlagRepository(): void {
  repoInstance = null;
}
