import type { Queryable } from './client';
import { getQueryable } from './pool';
import logger from '../logger';

export class HighPriorityRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  async add(
    worldId: string,
    guildId: string,
    addedByTokenId?: number
  ): Promise<{ added: boolean }> {
    const result = await this.db.query(
      `INSERT INTO high_priority_worlds (world_id, guild_id, added_by_token_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (world_id, guild_id) DO NOTHING`,
      [worldId, guildId, addedByTokenId ?? null]
    );
    const added = (result.rowCount ?? 0) > 0;
    if (added) {
      logger.info(
        `Marked world ${worldId} in guild ${guildId} as high priority`
      );
    }
    return { added };
  }

  async remove(
    worldId: string,
    guildId: string
  ): Promise<{ removed: boolean }> {
    const result = await this.db.query(
      `DELETE FROM high_priority_worlds WHERE world_id = $1 AND guild_id = $2`,
      [worldId, guildId]
    );
    const removed = (result.rowCount ?? 0) > 0;
    if (removed) {
      logger.info(
        `Removed high priority flag for world ${worldId} in guild ${guildId}`
      );
    }
    return { removed };
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
