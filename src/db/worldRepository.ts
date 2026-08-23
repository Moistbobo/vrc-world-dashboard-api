import type Database from 'better-sqlite3';
import { getDatabase } from './index';
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

function rowToRecord(row: Record<string, unknown>): WorldRecord {
  const record: WorldRecord = {
    id: row.id as number,
    worldId: row.world_id as string,
    guildId: row.guild_id as string,
    messageId: row.message_id as string,
    name: row.name as string | null,
    authorName: row.author_name as string | null,
    capacity: row.capacity as number | null,
    platforms: safeJsonParse(row.platforms as string | null, []),
    tags: safeJsonParse(row.tags as string | null, []),
    imageUrl: row.image_url as string | null,
    sourceContent: row.source_content as string | null,
    vrchatData: row.vrchat_data as string | null,
    packageSizes: safeJsonParse(row.package_sizes as string | null, []) as (
      number | null
    )[],
    quality: (row.quality as 'good' | 'bad' | null) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
    internalAddDate: (row.internal_add_date as number | null) ?? null
  };
  if (row.high_priority !== undefined) {
    record.highPriority = Boolean(row.high_priority);
  }
  return record;
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export class WorldRepository {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  /**
   * Upsert a world record. Preserves created_at, id, and internal_add_date on
   * update; updates all other fields and sets updated_at to now. When
   * internal_add_date is missing on both insert and the existing row, the
   * current time is used as a fallback.
   */
  upsert(record: WorldRecord): void {
    const sql = `
      INSERT INTO world_records
        (world_id, guild_id, message_id, name, author_name, capacity,
         platforms, tags, image_url, source_content, vrchat_data, package_sizes, created_at, updated_at, internal_add_date)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, strftime('%s','now')), strftime('%s','now'), COALESCE(?, strftime('%s','now')))
      ON CONFLICT(world_id, guild_id) DO UPDATE SET
        name = excluded.name,
        author_name = excluded.author_name,
        capacity = excluded.capacity,
        platforms = excluded.platforms,
        tags = excluded.tags,
        image_url = excluded.image_url,
        source_content = excluded.source_content,
        vrchat_data = excluded.vrchat_data,
        package_sizes = excluded.package_sizes,
        updated_at = excluded.updated_at,
        internal_add_date = COALESCE(world_records.internal_add_date, excluded.internal_add_date)
    `;

    const stmt = this.db.prepare(sql);
    stmt.run(
      record.worldId,
      record.guildId,
      record.messageId,
      record.name,
      record.authorName,
      record.capacity,
      JSON.stringify(record.platforms),
      JSON.stringify(record.tags),
      record.imageUrl,
      record.sourceContent,
      record.vrchatData,
      JSON.stringify(record.packageSizes),
      record.createdAt ?? null,
      record.internalAddDate ?? null
    );

    logger.debug(
      `Upserted world record ${record.worldId} in guild ${record.guildId}`
    );
  }

  /**
   * Set internal_add_date on an existing record only when it is currently null.
   * Used by crawlHistory and the v1 -> v2 migration to backfill the original
   * Discord message timestamp without overwriting an already-known value.
   */
  backfillInternalAddDate(
    worldId: string,
    guildId: string,
    internalAddDate: number
  ): boolean {
    const existing = this.getByWorldAndGuild(worldId, guildId);
    if (!existing || existing.internalAddDate != null) {
      return false;
    }

    const sql = `
      UPDATE world_records
      SET internal_add_date = ?
      WHERE world_id = ? AND guild_id = ?
    `;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(internalAddDate, worldId, guildId);
    const didUpdate = result.changes > 0;
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
  getByWorldId(worldId: string): WorldRecord[] {
    const sql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      WHERE wr.world_id = ?
      ORDER BY wr.created_at DESC
    `;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(worldId) as Record<string, unknown>[];
    return rows.map(rowToRecord);
  }

  /**
   * Get a specific world record by world ID + guild ID.
   */
  getByWorldAndGuild(
    worldId: string,
    guildId: string
  ): WorldRecord | undefined {
    const sql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      WHERE wr.world_id = ? AND wr.guild_id = ?
      LIMIT 1
    `;
    const stmt = this.db.prepare(sql);
    const row = stmt.get(worldId, guildId) as
      Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
  }

  /**
   * Move a world record to the deleted_world_records archive table,
   * then remove it from the live table. Returns true if a row existed.
   */
  deleteByWorldAndGuild(worldId: string, guildId: string): boolean {
    const archiveSql = `
      INSERT INTO deleted_world_records
        (world_id, guild_id, message_id, name, author_name, capacity, platforms, tags, image_url, source_content, vrchat_data, package_sizes, created_at, updated_at, internal_add_date)
      SELECT world_id, guild_id, message_id, name, author_name, capacity, platforms, tags, image_url, source_content, vrchat_data, package_sizes, created_at, updated_at, internal_add_date
      FROM world_records
      WHERE world_id = ? AND guild_id = ?
    `;
    const deleteSql =
      'DELETE FROM world_records WHERE world_id = ? AND guild_id = ?';

    const result = this.db.transaction(() => {
      const archiveStmt = this.db.prepare(archiveSql);
      archiveStmt.run(worldId, guildId);
      const deleteStmt = this.db.prepare(deleteSql);
      return deleteStmt.run(worldId, guildId);
    })();

    const didArchive = result.changes > 0;
    if (didArchive) {
      logger.info(
        `Archived world record ${worldId} from guild ${guildId} into deleted_world_records`
      );
    }
    return didArchive;
  }

  /**
   * Set the quality ('good' | 'bad' | null) on a specific world record.
   * Preserves existing fields; only updates quality and updated_at.
   * Skips the UPDATE if the quality value is unchanged.
   */
  updateQuality(
    worldId: string,
    guildId: string,
    quality: 'good' | 'bad' | null
  ): boolean {
    const existing = this.getByWorldAndGuild(worldId, guildId);
    if (!existing) {
      return false;
    }

    if (existing.quality === quality) {
      logger.debug(
        `Skipping quality update for world ${worldId} in guild ${guildId}: already "${quality}"`
      );
      return false;
    }

    const sql = `
      UPDATE world_records
      SET quality = ?, updated_at = strftime('%s','now')
      WHERE world_id = ? AND guild_id = ?
    `;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(quality, worldId, guildId);
    const didUpdate = result.changes > 0;
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
  updateTags(
    worldId: string,
    guildId: string,
    tags: string[],
    sourceContent: string | null
  ): boolean {
    const existing = this.getByWorldAndGuild(worldId, guildId);
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

    const sql = `
      UPDATE world_records
      SET tags = ?, source_content = ?, updated_at = strftime('%s','now')
      WHERE world_id = ? AND guild_id = ?
    `;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(
      JSON.stringify(tags),
      sourceContent,
      worldId,
      guildId
    );
    const didUpdate = result.changes > 0;
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
  updateTagsOnly(worldId: string, guildId: string, tags: string[]): boolean {
    const existing = this.getByWorldAndGuild(worldId, guildId);
    if (!existing) {
      return false;
    }

    if (JSON.stringify(existing.tags) === JSON.stringify(tags)) {
      logger.debug(
        `Skipping tag-only update for world ${worldId} in guild ${guildId}: tags unchanged`
      );
      return false;
    }

    const sql = `
      UPDATE world_records
      SET tags = ?, updated_at = strftime('%s','now')
      WHERE world_id = ? AND guild_id = ?
    `;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(JSON.stringify(tags), worldId, guildId);
    const didUpdate = result.changes > 0;
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
  getAllWorldGuildPairs(): Set<string> {
    const sql = "SELECT world_id || '-' || guild_id as key FROM world_records";
    const stmt = this.db.prepare(sql);
    const rows = stmt.all() as { key: string }[];
    return new Set(rows.map((r) => r.key));
  }

  /**
   * Build a WHERE clause and parameter list from the given filters.
   * Used by getAllPaginated so facet counts use the exact same filtering
   * rules as the paginated world list.
   */
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
  }): { whereClause: string; params: (string | number)[] } {
    const whereParts: string[] = [];
    const params: (string | number)[] = [];

    if (filters?.guildId) {
      whereParts.push('wr.guild_id = ?');
      params.push(filters.guildId);
    }

    if (filters?.worldIds && filters.worldIds.length > 0) {
      const placeholders = filters.worldIds.map(() => '?').join(', ');
      whereParts.push(`wr.world_id IN (${placeholders})`);
      params.push(...filters.worldIds);
    }

    if (filters?.quality && filters.quality.length > 0) {
      const placeholders = filters.quality.map(() => '?').join(', ');
      whereParts.push(`wr.quality IN (${placeholders})`);
      params.push(...filters.quality);
    }

    if (filters?.tags && filters.tags.length > 0) {
      for (const tag of filters.tags) {
        whereParts.push(
          'EXISTS (SELECT 1 FROM json_each(wr.tags) WHERE value = ?)'
        );
        params.push(tag);
      }
    }

    if (filters?.platforms && filters.platforms.length > 0) {
      for (const platform of filters.platforms) {
        whereParts.push(
          'EXISTS (SELECT 1 FROM json_each(wr.platforms) WHERE value = ?)'
        );
        params.push(platform);
      }
    }

    if (filters?.search) {
      const terms = filters.search.trim().split(/\s+/).filter(Boolean);
      for (const term of terms) {
        const pattern = `%${term}%`;
        whereParts.push(
          `(wr.name LIKE ? OR wr.author_name LIKE ? OR wr.source_content LIKE ? OR wr.world_id LIKE ? OR EXISTS (SELECT 1 FROM json_each(wr.tags) WHERE value LIKE ?))`
        );
        params.push(pattern, pattern, pattern, pattern, pattern);
      }
    }

    if (
      filters?.minCapacity !== undefined ||
      filters?.maxCapacity !== undefined
    ) {
      whereParts.push('wr.capacity IS NOT NULL');
    }

    if (filters?.minCapacity !== undefined) {
      whereParts.push('wr.capacity >= ?');
      params.push(filters.minCapacity);
    }

    if (filters?.maxCapacity !== undefined) {
      whereParts.push('wr.capacity <= ?');
      params.push(filters.maxCapacity);
    }

    if (filters?.dayRange !== undefined && filters.dayRange > 0) {
      whereParts.push(
        `COALESCE(wr.internal_add_date, wr.created_at) >= CAST(strftime('%s', 'now', '-${filters.dayRange} days') AS INTEGER)`
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
  getAllPaginated(
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
  ): { rows: WorldRecord[]; total: number } {
    const { whereClause, params } = this.buildWhereClause(filters);

    const countSql = `SELECT COUNT(*) as total FROM world_records wr ${whereClause}`;
    const countStmt = this.db.prepare(countSql);
    const countRow = countStmt.get(...params) as { total: number } | undefined;
    const total = countRow?.total ?? 0;

    const selectSql = `
      SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
      FROM world_records wr
      LEFT JOIN high_priority_worlds hp
        ON hp.world_id = wr.world_id AND hp.guild_id = wr.guild_id
      ${whereClause}
      ORDER BY wr.created_at DESC LIMIT ? OFFSET ?
    `;
    const selectStmt = this.db.prepare(selectSql);
    const rows = selectStmt.all(...params, limit, offset) as Record<
      string,
      unknown
    >[];

    return {
      rows: rows.map(rowToRecord),
      total
    };
  }

  /**
   * Return high-level dataset metadata counts: quality ratings and platform
   * support across all world records. Desktop support is counted via the
   * `standalonewindows` platform value that VRChat uses for PC/Desktop worlds.
   */
  getMetadataCounts(options?: { includeHighPriorityCount?: boolean }): {
    qualityGood: number;
    qualityBad: number;
    platformDesktop: number;
    platformAndroid: number;
    platformiOS: number;
    highPriorityCount?: number;
  } {
    const qualitySql = `
      SELECT
        (SELECT COUNT(*) FROM world_records WHERE quality = 'good') AS qualityGood,
        (SELECT COUNT(*) FROM world_records WHERE quality = 'bad') AS qualityBad
        ${
          options?.includeHighPriorityCount === true
            ? `, (SELECT COUNT(*) FROM high_priority_worlds) AS highPriorityCount`
            : ''
        }
    `;
    const qualityStmt = this.db.prepare(qualitySql);
    const qualityRow = qualityStmt.get() as
      | { qualityGood: number; qualityBad: number; highPriorityCount?: number }
      | undefined;

    const platformSql = `
      SELECT value AS platform, COUNT(*) AS count
      FROM world_records, json_each(platforms)
      WHERE value IN ('standalonewindows', 'android', 'ios')
      GROUP BY value
    `;
    const platformStmt = this.db.prepare(platformSql);
    const platformRows = platformStmt.all() as {
      platform: string;
      count: number;
    }[];

    const platformCounts = new Map(
      platformRows.map((r) => [r.platform, r.count])
    );

    const counts: {
      qualityGood: number;
      qualityBad: number;
      platformDesktop: number;
      platformAndroid: number;
      platformiOS: number;
      highPriorityCount?: number;
    } = {
      qualityGood: qualityRow?.qualityGood ?? 0,
      qualityBad: qualityRow?.qualityBad ?? 0,
      platformDesktop: platformCounts.get('standalonewindows') ?? 0,
      platformAndroid: platformCounts.get('android') ?? 0,
      platformiOS: platformCounts.get('ios') ?? 0
    };
    if (options?.includeHighPriorityCount === true) {
      counts.highPriorityCount = qualityRow?.highPriorityCount ?? 0;
    }
    return counts;
  }

  /**
   * Get all unique tags across all world records, with occurrence counts.
   */
  getUniqueTags(): { tag: string; count: number }[] {
    const sql = `
      SELECT value as tag, COUNT(*) as count
      FROM world_records, json_each(tags)
      GROUP BY value
      ORDER BY count DESC
    `;
    const stmt = this.db.prepare(sql);
    return stmt.all() as { tag: string; count: number }[];
  }

  /**
   * Total number of world records.
   */
  count(): number {
    const sql = 'SELECT COUNT(*) as total FROM world_records';
    const stmt = this.db.prepare(sql);
    const row = stmt.get() as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * The most recently processed world record.
   */
  getLastProcessed(): WorldRecord | undefined {
    const sql = 'SELECT * FROM world_records ORDER BY created_at DESC LIMIT 1';
    const stmt = this.db.prepare(sql);
    const row = stmt.get() as Record<string, unknown> | undefined;
    return row ? rowToRecord(row) : undefined;
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
