import { Router } from 'express';
import { getWorldRepository } from '../../db/worldRepository';
import { searchWorldsByName } from '../../vrchat/client';
import { parseIntegerParam, parseStringListQuery } from '../utils/queryParams';
import { sanitizeRecord } from '../utils/sanitize';
import { requirePermission, type TokenRequest } from '../middleware/auth';

const router = Router();

router.get(
  '/api/worlds',
  requirePermission('worlds:read'),
  async (request: TokenRequest, response) => {
    const query = request.query as Record<string, unknown>;

    const limit = Math.min(Number(query.limit ?? 50), 500);
    const offset = Number(query.offset ?? 0);

    const dayRange =
      typeof query.dayRange === 'string'
        ? Math.max(0, Math.min(parseInt(query.dayRange, 10) || 0, 365))
        : 0;

    const tags = parseStringListQuery(query.tag);
    const platforms = parseStringListQuery(query.platform);
    const worldIds = parseStringListQuery(query.worldId);

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

    const filters: {
      platforms?: string[];
      tags?: string[];
      quality?: ('good' | 'bad')[];
      search?: string;
      minCapacity?: number;
      maxCapacity?: number;
      worldIds?: string[];
      dayRange?: number;
      highPriorityOnly?: boolean;
    } = {};
    if (tags) filters.tags = tags;
    if (platforms) filters.platforms = platforms;
    if (worldIds) filters.worldIds = worldIds;
    if (quality) filters.quality = quality;
    if (minCapacity !== undefined) filters.minCapacity = minCapacity;
    if (maxCapacity !== undefined) filters.maxCapacity = maxCapacity;
    if (dayRange > 0) filters.dayRange = dayRange;
    if (highPriority === true) filters.highPriorityOnly = true;

    const search =
      typeof query.search === 'string' ? query.search.trim() : undefined;
    if (search) filters.search = search;

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
