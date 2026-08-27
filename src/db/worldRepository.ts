import type { Queryable } from './client';
import { getQueryable } from './pool';
import { toNumber, toNumberOrNull, toArray } from './mappers';
import logger from '../logger';

export interface WorldRecord {
  id?: number;
  worldId: string;
  guildId: string;
  messageId: string;
  name: string | null;
  authorName: string | null;
  capacity: number | null;
  platforms: string[];
  tags: string[];
  imageUrl: string | null;
  sourceContent: string | null;
  vrchatData: string | null;
  packageSizes: (number | null)[];
  quality?: 'good' | 'bad' | null;
  highPriority?: boolean;
  createdAt?: number;
  updatedAt?: number;
  internalAddDate?: number | null;
}

interface WorldRow extends Record<string, unknown> {
  id: bigint | number;
  world_id: string;
  guild_id: string;
  message_id: string;
  name: string | null;
  author_name: string | null;
  capacity: number | null;
  platforms: string[] | null;
  tags: string[] | null;
  image_url: string | null;
  source_content: string | null;
  vrchat_data: string | null;
  package_sizes: (number | null)[] | null;
  quality: 'good' | 'bad' | null;
  created_at: bigint | number;
  updated_at: bigint | number;
  internal_add_date: bigint | number | null;
  high_priority: boolean | null;
}

function rowToRecord(row: WorldRow): WorldRecord {
  return {
    id: toNumber(row.id),
    worldId: row.world_id,
    guildId: row.guild_id,
    messageId: row.message_id,
    name: row.name,
    authorName: row.author_name,
    capacity: toNumberOrNull(row.capacity),
    platforms: toArray<string>(row.platforms),
    tags: toArray<string>(row.tags),
    imageUrl: row.image_url,
    sourceContent: row.source_content,
    vrchatData: row.vrchat_data,
    packageSizes: toArray<number | null>(row.package_sizes),
    quality: row.quality ?? null,
    createdAt: toNumber(row.created_at),
    updatedAt: toNumber(row.updated_at),
    internalAddDate: toNumberOrNull(row.internal_add_date),
    highPriority: row.high_priority === true
  };
}

export class WorldRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  /**
   * Upsert a world record. Preserves created_at, id, and internal_add_date on
   * update; updates all other fields and sets updated_at to now. When
   * internal_add_date is missing on both insert and the existing row, the
   * current time is used as a fallback.
   */
  async upsert(record: WorldRecord): Promise<void> {
    const sql = `
      INSERT INTO world_records
        (world_id, guild_id, message_id, name, author_name, capacity,
         platforms, tags, image_url, source_content, vrchat_data, package_sizes, created_at, internal_add_date)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($13, (EXTRACT(EPOCH FROM NOW()))::bigint), $14)
      ON CONFLICT(world_id, guild_id) DO UPDATE SET
        name = EXCLUDED.name,
        author_name = EXCLUDED.author_name,
        capacity = EXCLUDED.capacity,
        platforms = EXCLUDED.platforms,
        tags = EXCLUDED.tags,
        image_url = EXCLUDED.image_url,
        source_content = EXCLUDED.source_content,
        vrchat_data = EXCLUDED.vrchat_data,
        package_sizes = EXCLUDED.package_sizes,
        updated_at = (EXTRACT(EPOCH FROM NOW()))::bigint,
        internal_add_date = COALESCE(world_records.internal_add_date, EXCLUDED.internal_add_date)
    `;

    await this.db.query(sql, [
      record.worldId,
      record.guildId,
      record.messageId,
      record.name,
      record.authorName,
      record.capacity,
      record.platforms,
      record.tags,
      record.imageUrl,
      record.sourceContent,
      record.vrchatData,
      record.packageSizes,
      record.createdAt ?? null,
      record.internalAddDate ?? null
    ]);

    logger.debug(
      `Upserted world record ${record.worldId} in guild ${record.guildId}`
    );
  }

  /**
   * Set internal_add_date on an existing record only when it is currently null.
   * Used by crawlHistory and the v1 -> v2 migration to backfill the original
   * Discord message timestamp without overwriting an already-known value.
   */
  async backfillInternalAddDate(
    worldId: string,
    guildId: string,
    internalAddDate: number
  ): Promise<boolean> {
    const existing = await this.getByWorldAndGuild(worldId, guildId);
    if (!existing || existing.internalAddDate != null) {
      return false;
    }

    const result = await this.db.query(
      `UPDATE world_records
       SET internal_add_date = $1
       WHERE world_id = $2 AND guild_id = $3`,
      [internalAddDate, worldId, guildId]
    );
    const didUpdate = (result.rowCount ?? 0) > 0;
    if (didUpdate) {
      logger.info(
        `Backfilled internal_add_date for world ${worldId} in guild ${guildId}: ${internalAddDate}`
      );
    }
    return didUpdate;
  }

  /**
   * Get all guild-scoped records for a given world ID.
   */
  async getByWorldId(worldId: string): Promise<WorldRecord[]> {
    const sql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      WHERE wr.world_id = $1
      ORDER BY wr.created_at DESC
    `;
    const result = await this.db.query<WorldRow>(sql, [worldId]);
    return result.rows.map(rowToRecord);
  }

  /**
   * Get a specific world record by world ID + guild ID.
   */
  async getByWorldAndGuild(
    worldId: string,
    guildId: string
  ): Promise<WorldRecord | undefined> {
    const sql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      WHERE wr.world_id = $1 AND wr.guild_id = $2
      LIMIT 1
    `;
    const result = await this.db.query<WorldRow>(sql, [worldId, guildId]);
    return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
  }

  /**
   * Move a world record to the deleted_world_records archive table,
   * then remove it from the live table. Returns true if a row existed.
   */
  async deleteByWorldAndGuild(
    worldId: string,
    guildId: string
  ): Promise<boolean> {
    const archiveSql = `
      INSERT INTO deleted_world_records
        (world_id, guild_id, message_id, name, author_name, capacity, platforms, tags, image_url, source_content, vrchat_data, package_sizes, internal_add_date, created_at, updated_at)
      SELECT world_id, guild_id, message_id, name, author_name, capacity, platforms, tags, image_url, source_content, vrchat_data, package_sizes, internal_add_date, created_at, updated_at
      FROM world_records
      WHERE world_id = $1 AND guild_id = $2
    `;
    const deleteSql = `DELETE FROM world_records WHERE world_id = $1 AND guild_id = $2`;

    const didDelete = await this.db.withTransaction(async (tx) => {
      await tx.query(archiveSql, [worldId, guildId]);
      const result = await tx.query(deleteSql, [worldId, guildId]);
      return (result.rowCount ?? 0) > 0;
    });

    if (didDelete) {
      logger.info(
        `Archived world record ${worldId} from guild ${guildId} into deleted_world_records`
      );
    }
    return didDelete;
  }

  /**
   * Set the quality ('good' | 'bad' | null) on a specific world record.
   * Preserves existing fields; only updates quality and updated_at.
   * Skips the UPDATE if the quality value is unchanged.
   */
  async updateQuality(
    worldId: string,
    guildId: string,
    quality: 'good' | 'bad' | null
  ): Promise<boolean> {
    const existing = await this.getByWorldAndGuild(worldId, guildId);
    if (!existing) {
      return false;
    }

    if (existing.quality === quality) {
      logger.debug(
        `Skipping quality update for world ${worldId} in guild ${guildId}: already "${quality}"`
      );
      return false;
    }

    const result = await this.db.query(
      `UPDATE world_records
       SET quality = $1, updated_at = (EXTRACT(EPOCH FROM NOW()))::bigint
       WHERE world_id = $2 AND guild_id = $3`,
      [quality, worldId, guildId]
    );
    const didUpdate = (result.rowCount ?? 0) > 0;
    if (didUpdate) {
      logger.info(
        `Set quality to "${quality}" for world ${worldId} in guild ${guildId}`
      );
    }
    return didUpdate;
  }

  /**
   * Update tags and source_content on a specific world record.
   * Preserves all other fields.
   * Skips the UPDATE if both tags and source_content are unchanged.
   */
  async updateTags(
    worldId: string,
    guildId: string,
    tags: string[],
    sourceContent: string | null
  ): Promise<boolean> {
    const existing = await this.getByWorldAndGuild(worldId, guildId);
    if (!existing) {
      return false;
    }

    const tagsChanged = JSON.stringify(existing.tags) !== JSON.stringify(tags);
    const sourceChanged = existing.sourceContent !== sourceContent;

    if (!tagsChanged && !sourceChanged) {
      logger.debug(
        `Skipping tag update for world ${worldId} in guild ${guildId}: no changes`
      );
      return false;
    }

    const result = await this.db.query(
      `UPDATE world_records
       SET tags = $1, source_content = $2, updated_at = (EXTRACT(EPOCH FROM NOW()))::bigint
       WHERE world_id = $3 AND guild_id = $4`,
      [tags, sourceContent, worldId, guildId]
    );
    const didUpdate = (result.rowCount ?? 0) > 0;
    if (didUpdate) {
      logger.info(
        `Updated tags for world ${worldId} in guild ${guildId}: [${tags.join(', ')}]`
      );
    }
    return didUpdate;
  }

  /**
   * Set tags on a specific world record without touching source_content.
   * Preserves all other fields. Skips the UPDATE when the tags are unchanged.
   */
  async updateTagsOnly(
    worldId: string,
    guildId: string,
    tags: string[]
  ): Promise<boolean> {
    const existing = await this.getByWorldAndGuild(worldId, guildId);
    if (!existing) {
      return false;
    }

    if (JSON.stringify(existing.tags) === JSON.stringify(tags)) {
      logger.debug(
        `Skipping tag-only update for world ${worldId} in guild ${guildId}: tags unchanged`
      );
      return false;
    }

    const result = await this.db.query(
      `UPDATE world_records
       SET tags = $1, updated_at = (EXTRACT(EPOCH FROM NOW()))::bigint
       WHERE world_id = $2 AND guild_id = $3`,
      [tags, worldId, guildId]
    );
    const didUpdate = (result.rowCount ?? 0) > 0;
    if (didUpdate) {
      logger.info(
        `Updated tags for world ${worldId} in guild ${guildId}: [${tags.join(', ')}]`
      );
    }
    return didUpdate;
  }

  /**
   * Get all world_id-guild_id pairs for caching.
   */
  async getAllWorldGuildPairs(): Promise<
    { worldId: string; guildId: string }[]
  > {
    const result = await this.db.query<{ world_id: string; guild_id: string }>(
      `SELECT world_id, guild_id FROM world_records`
    );
    return result.rows.map((r) => ({
      worldId: r.world_id,
      guildId: r.guild_id
    }));
  }

  private buildWhereClause(filters?: {
    tags?: string[];
    platforms?: string[];
    guildId?: string;
    quality?: ('good' | 'bad')[];
    search?: string;
    minCapacity?: number;
    maxCapacity?: number;
    worldIds?: string[];
    dayRange?: number;
    highPriorityOnly?: boolean;
  }): { whereClause: string; params: (string | number | string[])[] } {
    const whereParts: string[] = [];
    const params: (string | number | string[])[] = [];

    if (filters?.guildId) {
      whereParts.push(`wr.guild_id = $${params.length + 1}`);
      params.push(filters.guildId);
    }

    if (filters?.worldIds && filters.worldIds.length > 0) {
      const start = params.length;
      const placeholders = filters.worldIds
        .map((_, i) => `$${start + i + 1}`)
        .join(', ');
      whereParts.push(`wr.world_id IN (${placeholders})`);
      params.push(...filters.worldIds);
    }

    if (filters?.quality && filters.quality.length > 0) {
      const start = params.length;
      const placeholders = filters.quality
        .map((_, i) => `$${start + i + 1}`)
        .join(', ');
      whereParts.push(`wr.quality IN (${placeholders})`);
      params.push(...filters.quality);
    }

    if (filters?.tags && filters.tags.length > 0) {
      params.push(filters.tags);
      whereParts.push(`wr.tags @> $${params.length}::text[]`);
    }

    if (filters?.platforms && filters.platforms.length > 0) {
      params.push(filters.platforms);
      whereParts.push(`wr.platforms @> $${params.length}::text[]`);
    }

    if (filters?.search) {
      const terms = filters.search.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const pattern = `%${term}%`;
        params.push(pattern);
        const p = params.length;
        whereParts.push(
          `(wr.name ILIKE $${p} OR wr.author_name ILIKE $${p} OR wr.source_content ILIKE $${p} OR wr.world_id ILIKE $${p} OR EXISTS (SELECT 1 FROM unnest(wr.tags) t WHERE t ILIKE $${p}))`
        );
      }
    }

    if (
      filters?.minCapacity !== undefined ||
      filters?.maxCapacity !== undefined
    ) {
      whereParts.push('wr.capacity IS NOT NULL');
    }

    if (filters?.minCapacity !== undefined) {
      params.push(filters.minCapacity);
      whereParts.push(`wr.capacity >= $${params.length}`);
    }

    if (filters?.maxCapacity !== undefined) {
      params.push(filters.maxCapacity);
      whereParts.push(`wr.capacity <= $${params.length}`);
    }

    if (filters?.dayRange !== undefined && filters.dayRange > 0) {
      const cutoff = Math.floor(Date.now() / 1000) - filters.dayRange * 86400;
      params.push(cutoff);
      whereParts.push(
        `COALESCE(wr.internal_add_date, wr.created_at) >= $${params.length}`
      );
    }

    if (filters?.highPriorityOnly) {
      whereParts.push(
        'EXISTS (SELECT 1 FROM high_priority_worlds hp2 WHERE hp2.world_id = wr.world_id AND hp2.guild_id = wr.guild_id)'
      );
    }

    const whereClause =
      whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    return { whereClause, params };
  }

  /**
   * Paginated list of world records with optional filters.
   * @param limit   Max rows to return
   * @param offset  Rows to skip
   * @param filters Optional filters (tag array = AND logic, platforms array = AND logic, guildId, quality)
   */
  async getAllPaginated(
    limit: number,
    offset: number,
    filters?: {
      tags?: string[];
      platforms?: string[];
      guildId?: string;
      quality?: ('good' | 'bad')[];
      search?: string;
      minCapacity?: number;
      maxCapacity?: number;
      worldIds?: string[];
      dayRange?: number;
      highPriorityOnly?: boolean;
    }
  ): Promise<{ rows: WorldRecord[]; total: number }> {
    const { whereClause, params } = this.buildWhereClause(filters);

    const countResult = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM world_records wr ${whereClause}`,
      params
    );
    const total = countResult.rows[0]?.total ?? 0;

    const selectSql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      ${whereClause}
      ORDER BY wr.created_at DESC LIMIT $${
        params.length + 1
      } OFFSET $${params.length + 2}
    `;
    const selectResult = await this.db.query<WorldRow>(selectSql, [
      ...params,
      limit,
      offset
    ]);

    return {
      rows: selectResult.rows.map(rowToRecord),
      total
    };
  }

  /**
   * Return high-level dataset metadata counts: quality ratings and platform
   * support across all world records. Desktop support is counted via the
   * `standalonewindows` platform value that VRChat uses for PC/Desktop worlds.
   */
  async getMetadataCounts(options?: {
    includeHighPriorityCount?: boolean;
  }): Promise<{
    qualityGood: number;
    qualityBad: number;
    platformDesktop: number;
    platformAndroid: number;
    platformiOS: number;
    highPriorityCount?: number;
  }> {
    const qualitySql = `
      SELECT
        (SELECT COUNT(*)::int FROM world_records WHERE quality = 'good') AS qualitygood,
        (SELECT COUNT(*)::int FROM world_records WHERE quality = 'bad') AS qualitybad
        ${
          options?.includeHighPriorityCount === true
            ? `, (SELECT COUNT(*)::int FROM high_priority_worlds) AS highprioritycount`
            : ''
        }
    `;
    const qualityResult = await this.db.query<{
      qualitygood: number;
      qualitybad: number;
      highprioritycount?: number;
    }>(qualitySql);

    const platformResult = await this.db.query<{
      platform: string;
      count: number;
    }>(`
      SELECT platform AS platform, COUNT(*)::int AS count
      FROM world_records, unnest(platforms) AS platform
      WHERE platform IN ('standalonewindows', 'android', 'ios')
      GROUP BY platform
    `);

    const platformCounts = new Map(
      platformResult.rows.map((r) => [r.platform, r.count])
    );

    const qualityRow = qualityResult.rows[0];
    console.log(qualityRow);
    const counts: {
      qualityGood: number;
      qualityBad: number;
      platformDesktop: number;
      platformAndroid: number;
      platformiOS: number;
      highPriorityCount?: number;
    } = {
      qualityGood: qualityRow?.qualitygood ?? 0,
      qualityBad: qualityRow?.qualitybad ?? 0,
      platformDesktop: platformCounts.get('standalonewindows') ?? 0,
      platformAndroid: platformCounts.get('android') ?? 0,
      platformiOS: platformCounts.get('ios') ?? 0
    };
    if (options?.includeHighPriorityCount === true) {
      counts.highPriorityCount = qualityRow?.highprioritycount ?? 0;
    }
    return counts;
  }

  /**
   * Get all unique tags across all world records, with occurrence counts.
   */
  async getUniqueTags(): Promise<{ tag: string; count: number }[]> {
    const result = await this.db.query<{ tag: string; count: number }>(`
      SELECT tag AS tag, COUNT(*)::int AS count
      FROM world_records, unnest(tags) AS tag
      GROUP BY tag
      ORDER BY count DESC
    `);
    return result.rows;
  }

  /**
   * Total number of world records.
   */
  async count(): Promise<number> {
    const result = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int as total FROM world_records`
    );
    return result.rows[0]?.total ?? 0;
  }

  /**
   * The most recently processed world record.
   */
  async getLastProcessed(): Promise<WorldRecord | undefined> {
    const result = await this.db.query<WorldRow>(
      `SELECT * FROM world_records ORDER BY created_at DESC LIMIT 1`
    );
    return result.rows[0] ? rowToRecord(result.rows[0]) : undefined;
  }
}

// Singleton instance
let repoInstance: WorldRepository | null = null;

export function getWorldRepository(): WorldRepository {
  if (!repoInstance) {
    repoInstance = new WorldRepository();
  }
  return repoInstance;
}

/** Reset the singleton (useful in tests). */
export function resetWorldRepository(): void {
  repoInstance = null;
}
