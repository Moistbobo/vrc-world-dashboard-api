import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Query,
  Res
} from '@nestjs/common';
import type { Response } from 'express';
import { WorldRepository, type WorldFilters } from '../../db/worldRepository';
import type { ApiTokenRecord } from '../../db/tokenRepository';
import { searchWorldsByName } from '../../vrchat/client';
import { parseIntegerParam, parseStringListQuery } from '../utils/queryParams';
import { sanitizeRecord } from '../utils/sanitize';
import { checkRateLimit } from '../utils/rateLimit';
import logger from '../../logger';
import {
  decodeWorldsQueryParam,
  isSortField,
  parseWorldsQuery,
  WorldsQueryError,
  type SortField,
  type WorldsQuery
} from '../../worlds/query';
import { CurrentToken } from '../auth/current-token.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';

@Controller('worlds')
export class WorldsController {
  constructor(private readonly worlds: WorldRepository) {}

  @Get()
  @RequirePermission('worlds:read')
  async list(
    @Query() query: Record<string, unknown>,
    @CurrentToken() token: ApiTokenRecord
  ) {
    let limit: number;
    let offset: number;
    try {
      limit =
        parseIntegerParam(query.limit, { name: 'limit', min: 1, max: 999 }) ??
        50;
      offset = parseIntegerParam(query.offset, { name: 'offset', min: 0 }) ?? 0;
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pagination parameters'
      );
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

    const canManage = token?.role.permissions.includes('worlds:write') ?? false;

    if (highPriority === true && !canManage) {
      throw new ForbiddenException('Forbidden');
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
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid capacity filter'
      );
    }

    if (
      minCapacity !== undefined &&
      maxCapacity !== undefined &&
      minCapacity > maxCapacity
    ) {
      throw new BadRequestException(
        'minCapacity must be less than or equal to maxCapacity'
      );
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
        throw new BadRequestException(
          'where must be a single base64url string'
        );
      }
      try {
        filters.where = parseWorldsQuery(decodeWorldsQueryParam(query.where));
      } catch (error) {
        if (error instanceof WorldsQueryError) {
          throw new BadRequestException(error.message);
        }
        throw error;
      }
    }
    if (isSortField(query.sortField)) {
      filters.sortField = query.sortField;
    }

    const { rows, total } = await this.worlds.getAllPaginated(
      limit,
      offset,
      Object.keys(filters).length > 0 ? filters : undefined
    );

    return {
      total,
      limit,
      offset,
      worlds: rows.map((row) =>
        sanitizeRecord(row, {
          includeHighPriority: canManage,
          includeQuality: canManage
        })
      )
    };
  }

  @Post('query')
  @HttpCode(200)
  @RequirePermission('worlds:query')
  async query(
    @Body() body: unknown,
    @CurrentToken() token: ApiTokenRecord,
    @Res({ passthrough: true }) response: Response
  ) {
    const startedAt = process.hrtime.bigint();

    const { allowed, retryAfterSeconds } = checkRateLimit(`token:${token.id}`);
    if (!allowed) {
      response.set('Retry-After', String(retryAfterSeconds));
      throw new HttpException('Too many requests', 429);
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new BadRequestException('Body must be an object');
    }
    const payload = body as Record<string, unknown>;

    if (
      typeof payload.query !== 'object' ||
      payload.query === null ||
      Array.isArray(payload.query)
    ) {
      throw new BadRequestException('query must be an object');
    }

    let where: WorldsQuery;
    try {
      where = parseWorldsQuery(payload.query);
    } catch (error) {
      if (error instanceof WorldsQueryError) {
        throw new BadRequestException(error.message);
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
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid pagination parameters'
      );
    }

    let sortField: SortField | undefined;
    if (payload.sortField !== undefined) {
      if (!isSortField(payload.sortField)) {
        throw new BadRequestException(
          `Unknown sortField "${String(payload.sortField)}"`
        );
      }
      sortField = payload.sortField;
    }

    let sortDir: 'asc' | 'desc' = 'desc';
    if (payload.sortDir !== undefined) {
      if (payload.sortDir !== 'asc' && payload.sortDir !== 'desc') {
        throw new BadRequestException('sortDir must be "asc" or "desc"');
      }
      sortDir = payload.sortDir;
    }

    const canManage = token?.role.permissions.includes('worlds:write') ?? false;

    const { rows, total } = await this.worlds.getAllPaginated(limit, offset, {
      where,
      sortField,
      sortOrder: sortDir === 'asc' ? 'asc' : 'desc'
    });

    logger.info(
      {
        event: 'worlds_query',
        role: token?.role.name,
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

    return {
      total,
      limit,
      offset,
      worlds: rows.map((row) =>
        sanitizeRecord(row, {
          includeHighPriority: canManage,
          includeQuality: canManage
        })
      )
    };
  }

  @Get('search')
  @RequirePermission('worlds:read')
  async search(@Query('name') name?: string) {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed) {
      throw new BadRequestException('name query parameter is required');
    }

    try {
      const worlds = await searchWorldsByName(trimmed);
      return { worlds };
    } catch {
      throw new HttpException('Failed to search worlds on VRChat', 502);
    }
  }

  @Get('ids')
  @RequirePermission('worlds:read')
  async ids(): Promise<{ ids: string[] }> {
    const ids = await this.worlds.getAllWorldIds();
    return { ids };
  }

  @Get(':worldId')
  @RequirePermission('worlds:read')
  async getOne(
    @Param('worldId') worldId: string,
    @CurrentToken() token: ApiTokenRecord
  ) {
    const world = await this.worlds.getByWorldId(worldId);

    if (!world) {
      throw new NotFoundException('World not found');
    }

    const canManage = token?.role.permissions.includes('worlds:write') ?? false;

    return sanitizeRecord(world, {
      includeHighPriority: canManage,
      includeQuality: canManage
    });
  }
}
