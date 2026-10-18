import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

vi.mock('../../config', () => ({
  __esModule: true,
  default: {
    API_PORT: 3000,
    API_HOST: '0.0.0.0',
    API_ALLOWED_ORIGINS: [],
    API_ALLOWED_IPS: [],
    DISABLE_API_RESTRICTIONS: false,
    WORLDS_QUERY_RATE_LIMIT: 120,
    WORLDS_QUERY_RATE_WINDOW_MS: 60000
  }
}));

vi.mock('../../logger', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn()
  },
  flushLogs: vi.fn()
}));

vi.mock('../../vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  searchWorldsByName: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: { client: {} }
}));

import { createTestApp } from '../../test/create-test-app';
import {
  AUTH,
  createTokenRecord,
  createTokenRepositoryMock,
  createWorldRepositoryMock
} from '../../test/mocks';
import type { Permission } from '../../auth/permissions';
import { encodeWorldsQueryParam, type WorldsQuery } from '../../worlds/query';
import { resetRateLimits } from '../utils/rateLimit';

const WORLD_ROW = {
  worldId: 'wrld_abc123',
  guildId: 'guild-1',
  name: 'Spooky Mansion',
  authorName: 'GhostDev',
  capacity: 16,
  platforms: ['standalonewindows', 'android'],
  tags: ['horror', 'game'],
  flags: [],
  imageUrl: 'https://example.com/img.png',
  sourceContent: null,
  vrchatData: null,
  packageSizes: [104.5],
  quality: 'good',
  highPriority: true,
  createdAt: 1717257600,
  updatedAt: 1717257600
};

const TREE: WorldsQuery = {
  groups: [
    {
      connector: 'or',
      conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
    },
    {
      connector: 'or',
      conditions: [{ field: 'tag', op: 'has', value: 'horror' }]
    }
  ]
};

describe('worlds query API', () => {
  const worlds = createWorldRepositoryMock();
  const tokens = createTokenRepositoryMock();
  let app: INestApplication;

  function mockTokenRepo(
    permissions: Permission[] = [
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:query'
    ],
    roleName = 'bot'
  ) {
    tokens.findByHash.mockReturnValue(
      createTokenRecord({ roleName, permissions })
    );
  }

  beforeEach(async () => {
    resetRateLimits();
    worlds.getAllPaginated.mockResolvedValue({ total: 1, rows: [WORLD_ROW] });
    mockTokenRepo();
    ({ app } = await createTestApp({ worlds, tokens }));
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  describe('POST /api/worlds/query', () => {
    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .send({ query: TREE });
      expect(response.status).toBe(401);
    });

    it('AC-1 returns 403 without worlds:query and never calls the repo', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
      expect(worlds.getAllPaginated).not.toHaveBeenCalled();
    });

    it('returns the paginated response shape with defaults', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(1);
      expect(response.body.limit).toBe(50);
      expect(response.body.offset).toBe(0);
      expect(response.body.worlds[0].worldId).toBe(WORLD_ROW.worldId);
      expect(response.body.worlds[0]).not.toHaveProperty('quality');
      expect(response.body.worlds[0]).not.toHaveProperty('guildId');

      const filters = worlds.getAllPaginated.mock.calls[0][2];
      expect(filters.where).toEqual(TREE);
      expect(filters.sortOrder).toBe('desc');
    });

    it('includes curator fields for worlds:write tokens', async () => {
      mockTokenRepo([
        'worlds:read',
        'tags:read',
        'meta:read',
        'worlds:write',
        'worlds:query'
      ]);

      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });

      expect(response.status).toBe(200);
      expect(response.body.worlds[0].quality).toBe('good');
      expect(response.body.worlds[0].highPriority).toBe(true);
    });

    it('AC-4 returns 400 naming the field and operator without SQL', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: [
              {
                connector: 'and',
                conditions: [{ field: 'bogus', op: 'eq', value: 'x' }]
              }
            ]
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('bogus');
      expect(response.body.error).toContain('eq');
      expect(worlds.getAllPaginated).not.toHaveBeenCalled();
    });

    it('AC-6 returns 400 when a cap is exceeded', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: Array.from({ length: 9 }, () => ({
              connector: 'and',
              conditions: [{ field: 'tag', op: 'has', value: 'kino' }]
            }))
          }
        });

      expect(response.status).toBe(400);
      expect(worlds.getAllPaginated).not.toHaveBeenCalled();
    });

    it('AC-7 returns 400 for an out-of-range capacity', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: [
              {
                connector: 'and',
                conditions: [{ field: 'capacity', op: 'gt', value: 100 }]
              }
            ]
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('capacity');
    });

    it('AC-7 returns 400 for a bad date and a reversed range', async () => {
      const bad = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: [
              {
                connector: 'and',
                conditions: [{ field: 'addedAt', op: 'after', value: 'nope' }]
              }
            ]
          }
        });
      expect(bad.status).toBe(400);

      const reversed = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: [
              {
                connector: 'and',
                conditions: [
                  {
                    field: 'createdAt',
                    op: 'between',
                    value: '2024-06-02',
                    value2: '2024-06-01'
                  }
                ]
              }
            ]
          }
        });
      expect(reversed.status).toBe(400);
    });

    it('AC-9 applies capacity ascending and rejects an unknown sortField', async () => {
      const sorted = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE, sortField: 'capacity', sortDir: 'asc' });

      expect(sorted.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenLastCalledWith(
        50,
        0,
        expect.objectContaining({ sortField: 'capacity', sortOrder: 'asc' })
      );

      const bogus = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE, sortField: 'bogus' });

      expect(bogus.status).toBe(400);
      expect(bogus.body.error).toContain('sortField');
    });

    it('rejects a bad sortDir', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE, sortDir: 'sideways' });
      expect(response.status).toBe(400);
    });

    it('AC-12 clamps limit=1000 to 500', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE, limit: 1000 });

      expect(response.status).toBe(200);
      expect(response.body.limit).toBe(500);
      expect(worlds.getAllPaginated).toHaveBeenLastCalledWith(
        500,
        0,
        expect.anything()
      );
    });

    it('rejects a non-integer or negative limit and a non-integer offset', async () => {
      for (const body of [
        { query: TREE, limit: 1.5 },
        { query: TREE, limit: -1 },
        { query: TREE, offset: 2.5 }
      ]) {
        const response = await request(app.getHttpServer())
          .post('/api/worlds/query')
          .set(AUTH)
          .send(body);
        expect(response.status).toBe(400);
      }
    });

    it('rejects a non-object query', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: 'nope' });
      expect(response.status).toBe(400);
    });

    it('AC-4 returns 400 (not 500) for a prototype-chain field name', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({
          query: {
            groups: [
              {
                connector: 'and',
                conditions: [{ field: 'constructor', op: 'eq', value: 'x' }]
              }
            ]
          }
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('constructor');
      expect(worlds.getAllPaginated).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/worlds where param', () => {
    it('AC-8 parses the where param to the same filters as POST', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read', 'worlds:query']);
      const encoded = encodeWorldsQueryParam(TREE);

      const getResponse = await request(app.getHttpServer())
        .get(`/api/worlds?where=${encoded}`)
        .set(AUTH);
      expect(getResponse.status).toBe(200);

      const postResponse = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });
      expect(postResponse.status).toBe(200);

      const getFilters = worlds.getAllPaginated.mock.calls[0][2];
      const postFilters = worlds.getAllPaginated.mock.calls[1][2];

      expect(postFilters.where).toEqual(getFilters.where);
      expect(postFilters.sortField).toEqual(getFilters.sortField);
      expect(postFilters.sortOrder ?? 'desc').toBe(
        getFilters.sortOrder ?? 'desc'
      );
      expect(
        getResponse.body.worlds.map((w: { worldId: string }) => w.worldId)
      ).toEqual(
        postResponse.body.worlds.map((w: { worldId: string }) => w.worldId)
      );
    });

    it('combines the where tree with flat filters', async () => {
      const encoded = encodeWorldsQueryParam(TREE);
      const response = await request(app.getHttpServer())
        .get(`/api/worlds?where=${encoded}&tag=chill`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ where: TREE, tags: ['chill'] })
      );
    });

    it('returns 400 for an invalid where param', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?where=!!!not-base64!!!')
        .set(AUTH);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid where parameter' });
    });

    it('returns 400 when where is repeated instead of silently ignoring it', async () => {
      const encoded = encodeWorldsQueryParam(TREE);
      const response = await request(app.getHttpServer())
        .get(`/api/worlds?where=${encoded}&where=${encoded}`)
        .set(AUTH);

      expect(response.status).toBe(400);
      expect(worlds.getAllPaginated).not.toHaveBeenCalled();
    });

    it('passes a valid sortField through to the repository', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?sortField=capacity')
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ sortField: 'capacity' })
      );
    });
  });

  describe('GET /api/me bot role', () => {
    it('AC-11 reports worlds:query and not worlds:write', async () => {
      mockTokenRepo(
        ['worlds:read', 'tags:read', 'meta:read', 'worlds:query'],
        'bot'
      );

      const response = await request(app.getHttpServer())
        .get('/api/me')
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.permissions).toContain('worlds:query');
      expect(response.body.permissions).not.toContain('worlds:write');
    });
  });
});
