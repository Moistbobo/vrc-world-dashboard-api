import type { Queryable } from './client';
import { getQueryable } from './pool';
import type { MutationResult } from './mutationResult';
import logger from '../logger';

export class HighPriorityRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  async add(
    worldId: string,
    addedByTokenId?: number
  ): Promise<MutationResult<{ added: boolean }>> {
    return this.db.withTransaction<MutationResult<{ added: boolean }>>(
      async (tx) => {
        const world = await tx.query(
          `SELECT 1 FROM world_records WHERE world_id = $1`,
          [worldId]
        );
        if (world.rows.length === 0) {
          return { status: 'notFound' };
        }

        const result = await tx.query(
          `INSERT INTO high_priority_worlds (world_id, added_by_token_id)
           VALUES ($1, $2)
           ON CONFLICT (world_id) DO NOTHING`,
          [worldId, addedByTokenId ?? null]
        );
        const added = (result.rowCount ?? 0) > 0;
        if (added) {
          logger.info(`Marked world ${worldId} as high priority`);
        }
        return { status: 'ok', added };
      }
    );
  }

  async remove(worldId: string): Promise<MutationResult<{ removed: boolean }>> {
    return this.db.withTransaction<MutationResult<{ removed: boolean }>>(
      async (tx) => {
        const world = await tx.query(
          `SELECT 1 FROM world_records WHERE world_id = $1`,
          [worldId]
        );
        if (world.rows.length === 0) {
          return { status: 'notFound' };
        }

        const result = await tx.query(
          `DELETE FROM high_priority_worlds WHERE world_id = $1`,
          [worldId]
        );
        const removed = (result.rowCount ?? 0) > 0;
        if (removed) {
          logger.info(`Removed high priority flag for world ${worldId}`);
        }
        return { status: 'ok', removed };
      }
    );
  }
}

let repoInstance: HighPriorityRepository | null = null;

export function getHighPriorityRepository(): HighPriorityRepository {
  if (!repoInstance) {
    repoInstance = new HighPriorityRepository();
  }
  return repoInstance;
}

export function resetHighPriorityRepository(): void {
  repoInstance = null;
}
