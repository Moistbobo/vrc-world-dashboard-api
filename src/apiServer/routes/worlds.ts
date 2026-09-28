import { Router } from 'express';
import {
  getWorldRepository,
  type WorldFilters
} from '../../db/worldRepository';
import { searchWorldsByName } from '../../vrchat/client';
import { parseIntegerParam, parseStringListQuery } from '../utils/queryParams';
import { sanitizeRecord } from '../utils/sanitize';
import { checkRateLimit } from '../utils/rateLimit';
import logger from '../../logger';
import { requirePermission, type TokenRequest } from '../middleware/auth';
import {
  decodeWorldsQueryParam,
  isSortField,
  parseWorldsQuery,
  WorldsQueryError,
  type SortField,
  type WorldsQuery
} from '../../worlds/query';

const router = Router();

router.get(
  '/api/worlds',
  requirePermission('worlds:read'),
  async (request: TokenRequest, response) => {
    const query = request.query as Record<string, unknown>;

    let limit: number;
    let offset: number;
    try {
      limit =
        parseIntegerParam(query.limit, { name: 'limit', min: 1, max: 999 }) ??
        50;
      offset = parseIntegerParam(query.offset, { name: 'offset', min: 0 }) ?? 0;
    } catch (error) {
      return response.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : 'Invalid pagination parameters'
      });
    }

    const dayRange =
      typeof query.dayRange === 'string'
        ? Math.max(0, Math.min(parseInt(query.dayRange, 10) || 0, 365))
        : 0;

    const tags = parseStringListQuery(query.tag);
    const platforms = parseStringListQuery(query.platform);
    const worldIds = parseStringListQuery(query.worldId);
    const excludeFlags = parseStringListQuery(query.exclude);
    const qualityModes = parseStringListQuery(query.qualityMode);

    const quality = Array.isArray(query.quality)
      ? query.quality
          .map(String)
          .filter((q): q is 'good' | 'bad' => q === 'good' || q === 'bad')
      : query.quality && (query.quality === 'good' || query.quality === 'bad')
        ? [String(query.quality) as 'good' | 'bad']
        : undefined;

    const highPriority =
      query.highPriority === 'true' || query.highPriority === 'false'
        ? query.highPriority === 'true'
        : undefined;

    const canManage =
      request.token?.role.permissions.includes('worlds:write') ?? false;

    if (highPriority === true && !canManage) {
      return response.status(403).send({ error: 'Forbidden' });
    }

    let minCapacity: number | undefined;
    let maxCapacity: number | undefined;
    try {
      minCapacity = parseIntegerParam(query.minCapacity, {
        name: 'minCapacity',
        min: 1,
        max: 80
      });
      maxCapacity = parseIntegerParam(query.maxCapacity, {
        name: 'maxCapacity',
        min: 1,
        max: 80
      });
    } catch (error) {
      return response.status(400).send({
        error:
          error instanceof Error ? error.message : 'Invalid capacity filter'
      });
    }

    if (
      minCapacity !== undefined &&
      maxCapacity !== undefined &&
      minCapacity > maxCapacity
    ) {
      return response.status(400).send({
        error: 'minCapacity must be less than or equal to maxCapacity'
      });
    }

    const filters: WorldFilters = {};
    if (tags) filters.tags = tags;
    if (excludeFlags) filters.excludeFlags = excludeFlags;
    if (query.flagMode === 'include') filters.flagMode = 'include';
    if (platforms) filters.platforms = platforms;
    if (worldIds) filters.worldIds = worldIds;
    if (quality) filters.quality = quality;
    if (qualityModes?.includes('exclude')) filters.qualityMode = 'exclude';
    if (minCapacity !== undefined) filters.minCapacity = minCapacity;
    if (maxCapacity !== undefined) filters.maxCapacity = maxCapacity;
    if (dayRange > 0) filters.dayRange = dayRange;
    if (highPriority === true) filters.highPriorityOnly = true;
    if (query.order === 'asc') filters.sortOrder = 'asc';

    const search =
      typeof query.search === 'string' ? query.search.trim() : undefined;
    if (search) filters.search = search;

    if (query.where !== undefined) {
      if (typeof query.where !== 'string') {
        return response.status(400).send({
          error: 'where must be a single base64url string'
        });
      }
      try {
        filters.where = parseWorldsQuery(decodeWorldsQueryParam(query.where));
      } catch (error) {
        if (error instanceof WorldsQueryError) {
          return response.status(400).send({ error: error.message });
        }
        throw error;
      }
    }
    if (isSortField(query.sortField)) {
      filters.sortField = query.sortField;
    }

    const { rows, total } = await getWorldRepository().getAllPaginated(
      limit,
      offset,
      Object.keys(filters).length > 0 ? filters : undefined
    );

    response.send({
      total,
      limit,
      offset,
      worlds: rows.map((row) =>
        sanitizeRecord(row, {
          includeHighPriority: canManage,
          includeQuality: canManage
        })
      )
    });
  }
);

// POST /api/worlds/query — validated boolean query over world records
router.post(
  '/api/worlds/query',
  requirePermission('worlds:query'),
  async (request: TokenRequest, response) => {
    const startedAt = process.hrtime.bigint();

    const { allowed, retryAfterSeconds } = checkRateLimit(
      `token:${request.token!.id}`
    );
    if (!allowed) {
      response.set('Retry-After', String(retryAfterSeconds));
      return response.status(429).send({ error: 'Too many requests' });
    }

    const body = request.body as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return response.status(400).send({ error: 'Body must be an object' });
    }
    const payload = body as Record<string, unknown>;

    if (
      typeof payload.query !== 'object' ||
      payload.query === null ||
      Array.isArray(payload.query)
    ) {
      return response.status(400).send({ error: 'query must be an object' });
    }

    let where: WorldsQuery;
    try {
      where = parseWorldsQuery(payload.query);
    } catch (error) {
      if (error instanceof WorldsQueryError) {
        return response.status(400).send({ error: error.message });
      }
      throw error;
    }

    let limit: number;
    let offset: number;
    try {
      limit = Math.min(
        parseIntegerParam(payload.limit, { name: 'limit', min: 1 }) ?? 50,
        500
      );
      offset =
        parseIntegerParam(payload.offset, { name: 'offset', min: 0 }) ?? 0;
    } catch (error) {
      return response.status(400).send({
        error:
          error instanceof Error
            ? error.message
            : 'Invalid pagination parameters'
      });
    }

    let sortField: SortField | undefined;
    if (payload.sortField !== undefined) {
      if (!isSortField(payload.sortField)) {
        return response.status(400).send({
          error: `Unknown sortField "${String(payload.sortField)}"`
        });
      }
      sortField = payload.sortField;
    }

    let sortDir: 'asc' | 'desc' = 'desc';
    if (payload.sortDir !== undefined) {
      if (payload.sortDir !== 'asc' && payload.sortDir !== 'desc') {
        return response
          .status(400)
          .send({ error: 'sortDir must be "asc" or "desc"' });
      }
      sortDir = payload.sortDir;
    }

    const canManage =
      request.token?.role.permissions.includes('worlds:write') ?? false;

    const { rows, total } = await getWorldRepository().getAllPaginated(
      limit,
      offset,
      {
        where,
        sortField,
        sortOrder: sortDir === 'asc' ? 'asc' : 'desc'
      }
    );

    logger.info(
      {
        event: 'worlds_query',
        role: request.token?.role.name,
        groups: where.groups.length,
        conditions: where.groups.reduce(
          (total, group) => total + group.conditions.length,
          0
        ),
        duration_ms: Number(process.hrtime.bigint() - startedAt) / 1e6,
        total
      },
      'worlds query executed'
    );

    response.send({
      total,
      limit,
      offset,
      worlds: rows.map((row) =>
        sanitizeRecord(row, {
          includeHighPriority: canManage,
          includeQuality: canManage
        })
      )
    });
  }
);

// GET /api/worlds/search?name=... — live VRChat world search by name
router.get(
  '/api/worlds/search',
  requirePermission('worlds:read'),
  async (request, response) => {
    const name =
      typeof request.query.name === 'string' ? request.query.name.trim() : '';
    if (!name) {
      return response
        .status(400)
        .send({ error: 'name query parameter is required' });
    }

    try {
      const worlds = await searchWorldsByName(name);
      response.send({ worlds });
    } catch {
      response.status(502).send({ error: 'Failed to search worlds on VRChat' });
    }
  }
);

// GET /api/worlds/ids — distinct world IDs for the bot's crawl cache
router.get(
  '/api/worlds/ids',
  requirePermission('worlds:read'),
  async (_request, response) => {
    const ids = await getWorldRepository().getAllWorldIds();
    response.send({ ids });
  }
);

// GET /api/worlds/:worldId
router.get(
  '/api/worlds/:worldId',
  requirePermission('worlds:read'),
  async (request: TokenRequest, response) => {
    const { worldId } = request.params as { worldId: string };
    const world = await getWorldRepository().getByWorldId(worldId);

    if (!world) {
      return response.status(404).send({ error: 'World not found' });
    }

    const canManage =
      request.token?.role.permissions.includes('worlds:write') ?? false;

    response.send(
      sanitizeRecord(world, {
        includeHighPriority: canManage,
        includeQuality: canManage
      })
    );
  }
);

export default router;
