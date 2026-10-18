import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
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
  createFlagRepositoryMock,
  createTagRepositoryMock,
  createTokenRecord,
  createTokenRepositoryMock,
  createWorldRepositoryMock
} from '../../test/mocks';
import { TAG_SEED } from '../../db/tagSeed';
import { searchWorldsByName } from '../../vrchat/client';
import logger from '../../logger';

function mockFn(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>;
}

function worldRow() {
  return {
    worldId: 'wrld_abc123',
    guildId: 'guild-1',
    name: 'Spooky Mansion',
    authorName: 'GhostDev',
    capacity: 16,
    platforms: ['standalonewindows', 'android'],
    tags: ['horror', 'game'],
    imageUrl: 'https://example.com/img.png',
    sourceContent: null,
    vrchatData: null,
    packageSizes: [104.5, 78.2],
    quality: 'good',
    createdAt: 1717257600,
    updatedAt: 1717257600
  };
}

describe('API Server', () => {
  let app: INestApplication;
  const worlds = createWorldRepositoryMock();
  const tokens = createTokenRepositoryMock();
  const tags = createTagRepositoryMock();
  const flags = createFlagRepositoryMock();

  function stubWorldRepository() {
    worlds.count.mockResolvedValue(1428);
    worlds.getAllPaginated.mockResolvedValue({
      total: 1,
      rows: [worldRow()]
    });
    worlds.getByWorldId.mockResolvedValue(worldRow());
    worlds.getAllWorldIds.mockResolvedValue(['wrld_abc123', 'wrld_def456']);
    worlds.getUniqueTags.mockResolvedValue([
      { tag: 'horror', count: 312 },
      { tag: 'game', count: 145 }
    ]);
    worlds.getMetadataCounts.mockResolvedValue({
      qualityGood: 123,
      qualityBad: 12,
      platformDesktop: 80,
      platformAndroid: 45,
      platformiOS: 6
    });
  }

  function stubEmptyPage() {
    worlds.getAllPaginated.mockResolvedValue({ total: 0, rows: [] });
  }

  beforeAll(async () => {
    ({ app } = await createTestApp({ worlds, tags, flags, tokens }));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    tokens.findByHash.mockReturnValue(createTokenRecord());
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/health', () => {
    it('returns health status without auth', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer()).get('/api/health');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        status: 'ok',
        worldCount: 1428,
        dbVersion: 1
      });
    });
  });

  describe('Auth', () => {
    it('returns 401 when auth header is missing', async () => {
      const response = await request(app.getHttpServer()).get('/api/worlds');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when token is invalid', async () => {
      tokens.findByHash.mockReturnValue(undefined);

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer wrong-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when token is revoked', async () => {
      tokens.findByHash.mockReturnValue(createTokenRecord({ revokedAt: 123 }));

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer revoked-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when the token lacks the required permission', async () => {
      tokens.findByHash.mockReturnValue(
        createTokenRecord({ permissions: ['tags:read'] })
      );

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('touches last_used_at for a valid token', async () => {
      stubWorldRepository();

      await request(app.getHttpServer()).get('/api/worlds').set(AUTH);

      expect(tokens.touchLastUsed).toHaveBeenCalled();
    });

    it('allows access with a valid token', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/worlds', () => {
    it('returns paginated world list with sanitized fields', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.total).toBe(1);
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
      expect(body.worlds).toHaveLength(1);

      const world = body.worlds[0];
      expect(world.worldId).toBe('wrld_abc123');
      expect(world.name).toBe('Spooky Mansion');
      expect(world.vrchatUrl).toBe('https://vrchat.com/home/world/wrld_abc123');
      expect(world.quality).toBe('good');
      expect(world.guildId).toBe('guild-1');
      expect(world.packageSizes).toEqual([104.5, 78.2]);
      expect(world.createdAt).toBe('2024-06-01T16:00:00.000Z');

      // Server-identifying fields must be stripped
      expect(world.messageId).toBeUndefined();
      expect(world.sourceContent).toBeUndefined();
      expect(world.vrchatData).toBeUndefined();
    });

    it('passes tag filters to repository', async () => {
      stubEmptyPage();

      await request(app.getHttpServer())
        .get('/api/worlds?tag=horror&tag=game')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ tags: ['horror', 'game'] })
      );
    });

    it('returns 400 when limit exceeds the maximum', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=9999')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'limit must be at most 999' });
    });

    it('returns 400 for a non-integer limit', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=abc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'limit must be an integer' });
    });

    it('returns 400 for a negative limit', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=-5')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'limit must be at least 1' });
    });

    it('returns 400 for a limit of zero', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=0')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'limit must be at least 1' });
    });

    it('returns 400 for a limit of 1000', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=1000')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'limit must be at most 999' });
    });

    it('returns 400 for a non-integer offset', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?offset=abc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'offset must be an integer' });
    });

    it('returns 400 for a negative offset', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?offset=-1')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'offset must be at least 0' });
    });

    it('passes a valid limit and offset to the repository', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?limit=999&offset=0')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(999, 0, undefined);
    });

    it('passes a large offset to the repository', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?offset=100000')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        100000,
        undefined
      );
    });

    it('returns 400 when minCapacity is greater than maxCapacity', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?minCapacity=50&maxCapacity=20')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'minCapacity must be less than or equal to maxCapacity'
      });
    });

    it('returns 400 for non-integer capacity values', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds?minCapacity=abc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'minCapacity must be an integer'
      });
    });

    it('passes dayRange filter to repository', async () => {
      stubEmptyPage();

      await request(app.getHttpServer())
        .get('/api/worlds?dayRange=7')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ dayRange: 7 })
      );
    });

    it('passes exclude flags to repository and is allowed for viewer tokens', async () => {
      stubEmptyPage();
      tokens.findByHash.mockReturnValue(
        createTokenRecord({
          permissions: ['worlds:read', 'tags:read', 'meta:read']
        })
      );

      const response = await request(app.getHttpServer())
        .get('/api/worlds?exclude=furry')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ excludeFlags: ['furry'] })
      );
    });

    it('parses repeated and comma-separated exclude values', async () => {
      stubEmptyPage();

      await request(app.getHttpServer())
        .get('/api/worlds?exclude=furry&exclude=AI%20slop')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ excludeFlags: ['furry', 'AI slop'] })
      );
    });

    it('defaults to exclude mode when flagMode is absent', async () => {
      stubEmptyPage();

      await request(app.getHttpServer())
        .get('/api/worlds?exclude=furry')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.not.objectContaining({ flagMode: 'include' })
      );
    });

    it('passes flagMode=include to repository and is allowed for viewer tokens', async () => {
      stubEmptyPage();
      tokens.findByHash.mockReturnValue(
        createTokenRecord({ permissions: ['worlds:read'] })
      );

      const response = await request(app.getHttpServer())
        .get('/api/worlds?exclude=furry&flagMode=include')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({
          excludeFlags: ['furry'],
          flagMode: 'include'
        })
      );
    });

    it('treats unrecognized flagMode values as exclude mode', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?exclude=furry&flagMode=bogus')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.not.objectContaining({ flagMode: 'include' })
      );
    });

    it('passes qualityMode=exclude to repository and is allowed for viewer tokens', async () => {
      stubEmptyPage();
      tokens.findByHash.mockReturnValue(
        createTokenRecord({ permissions: ['worlds:read'] })
      );

      const response = await request(app.getHttpServer())
        .get('/api/worlds?qualityMode=exclude')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ qualityMode: 'exclude' })
      );
    });

    it('omits qualityMode when absent', async () => {
      stubEmptyPage();

      await request(app.getHttpServer()).get('/api/worlds').set(AUTH);

      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.not.objectContaining({ qualityMode: 'exclude' })
      );
    });

    it('treats unrecognized qualityMode values as absent', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?qualityMode=bogus')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.not.objectContaining({ qualityMode: 'exclude' })
      );
    });

    it('honors exclude within repeated and comma-separated qualityMode values', async () => {
      stubEmptyPage();

      await request(app.getHttpServer())
        .get('/api/worlds?qualityMode=exclude&qualityMode=exclude')
        .set('authorization', 'Bearer test-token');
      expect(worlds.getAllPaginated).toHaveBeenLastCalledWith(
        50,
        0,
        expect.objectContaining({ qualityMode: 'exclude' })
      );

      await request(app.getHttpServer())
        .get('/api/worlds?qualityMode=include,exclude')
        .set('authorization', 'Bearer test-token');
      expect(worlds.getAllPaginated).toHaveBeenLastCalledWith(
        50,
        0,
        expect.objectContaining({ qualityMode: 'exclude' })
      );
    });

    it('composes qualityMode=exclude with other filters', async () => {
      stubEmptyPage();
      tokens.findByHash.mockReturnValue(
        createTokenRecord({ permissions: ['worlds:read', 'worlds:write'] })
      );

      const response = await request(app.getHttpServer())
        .get('/api/worlds?qualityMode=exclude&tag=chill&highPriority=true')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({
          qualityMode: 'exclude',
          tags: ['chill'],
          highPriorityOnly: true
        })
      );
    });

    it('passes order=asc to the repository', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?order=asc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ sortOrder: 'asc' })
      );
    });

    it('omits sortOrder for order=desc', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?order=desc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(50, 0, undefined);
    });

    it('omits sortOrder when order is absent', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(50, 0, undefined);
    });

    it('falls back to newest-first for bogus order values', async () => {
      stubEmptyPage();

      const response = await request(app.getHttpServer())
        .get('/api/worlds?order=bogus')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(worlds.getAllPaginated).toHaveBeenCalledWith(50, 0, undefined);
    });

    it('returns flags on list and detail responses for viewer tokens', async () => {
      stubWorldRepository();
      tokens.findByHash.mockReturnValue(
        createTokenRecord({
          permissions: ['worlds:read', 'tags:read', 'meta:read']
        })
      );

      const list = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');
      expect(list.status).toBe(200);
      expect(list.body.worlds[0].flags).toEqual([]);

      const detail = await request(app.getHttpServer())
        .get('/api/worlds/wrld_abc123')
        .set('authorization', 'Bearer test-token');
      expect(detail.status).toBe(200);
      expect(detail.body.flags).toEqual([]);
    });
  });

  describe('GET /api/worlds/:worldId', () => {
    it('returns a single world with vrchatUrl and quality', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer())
        .get('/api/worlds/wrld_abc123')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.worldId).toBe('wrld_abc123');
      expect(body.vrchatUrl).toBe('https://vrchat.com/home/world/wrld_abc123');
      expect(body.quality).toBe('good');
      expect(body.guildId).toBe('guild-1');

      // Stripped fields
      expect(body.sourceContent).toBeUndefined();
    });

    it('returns 404 when world does not exist', async () => {
      stubWorldRepository();
      worlds.getByWorldId.mockResolvedValue(undefined);

      const response = await request(app.getHttpServer())
        .get('/api/worlds/wrld_missing')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'World not found'
      });
    });
  });

  describe('GET /api/worlds/ids', () => {
    it('returns distinct world ids', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer())
        .get('/api/worlds/ids')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ids: ['wrld_abc123', 'wrld_def456']
      });
    });
  });

  describe('GET /api/worlds/search', () => {
    it('returns worlds matching the name query', async () => {
      mockFn(searchWorldsByName).mockResolvedValue([
        {
          id: 'wrld_abc123',
          name: 'Midnight Bar',
          authorName: 'VRChat',
          capacity: 40,
          imageUrl: 'https://example.com/img.png',
          unityPackages: []
        }
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/worlds/search?name=Midnight%20Bar')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(searchWorldsByName).toHaveBeenCalledWith('Midnight Bar');
      expect(response.body.worlds).toEqual([
        {
          id: 'wrld_abc123',
          name: 'Midnight Bar',
          authorName: 'VRChat',
          capacity: 40,
          imageUrl: 'https://example.com/img.png',
          unityPackages: []
        }
      ]);
    });

    it('returns 400 when name is missing', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/worlds/search')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'name query parameter is required'
      });
    });

    it('returns 502 when the VRChat search fails', async () => {
      mockFn(searchWorldsByName).mockRejectedValue(new Error('vrc down'));

      const response = await request(app.getHttpServer())
        .get('/api/worlds/search?name=Midnight')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        error: 'Failed to search worlds on VRChat'
      });
    });
  });

  describe('GET /api/tags', () => {
    it('returns used tags with counts, metadata, and unused canonical tags as zero', async () => {
      stubWorldRepository();
      tags.getAll.mockResolvedValue(TAG_SEED);

      const response = await request(app.getHttpServer())
        .get('/api/tags')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      const body = response.body;

      const byTag = new Map<string, { tag: string; count: number }>();
      for (const t of body.tags as { tag: string; count: number }[]) {
        byTag.set(t.tag, t);
      }
      expect(byTag.get('horror')?.count).toBe(312);
      expect(byTag.get('game')?.count).toBe(145);

      // Every canonical tag is returned, including unused ones at 0.
      for (const tag of ['kino', 'chill', 'comfy']) {
        expect(byTag.get(tag)?.count).toBe(0);
      }
      expect(body.tags).toHaveLength(TAG_SEED.length);

      // Every entry carries the metadata sourced from the tags catalog.
      for (const t of body.tags) {
        expect(typeof t.emoji).toBe('string');
        expect(typeof t.hexColor).toBe('string');
      }

      // Sorted by count descending, ties resolved alphabetically.
      const counts = body.tags.map((t: { count: number }) => t.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
      const zeroTags = body.tags
        .filter((t: { count: number }) => t.count === 0)
        .map((t: { tag: string }) => t.tag);
      expect(zeroTags).toEqual([...zeroTags].sort());
    });

    it('applies fallback metadata to in-data tags missing from the catalog', async () => {
      stubWorldRepository();
      worlds.getUniqueTags.mockResolvedValue([
        { tag: 'horror', count: 312 },
        { tag: 'legacy-tag', count: 3 }
      ]);
      tags.getAll.mockResolvedValue(TAG_SEED);

      const response = await request(app.getHttpServer())
        .get('/api/tags')
        .set('authorization', 'Bearer test-token');

      const legacy = response.body.tags.find(
        (t: { tag: string }) => t.tag === 'legacy-tag'
      );
      expect(legacy).toEqual({
        tag: 'legacy-tag',
        count: 3,
        emoji: '❓',
        hexColor: '#94a3b8'
      });
    });
  });

  describe('GET /api/flags', () => {
    it('returns seeded counts and backfills unused catalog flags at zero', async () => {
      flags.getAll.mockResolvedValue(['furry', 'booth slop', 'sleepy']);
      flags.countByFlag.mockResolvedValue([
        { flag: 'furry', count: 12 },
        { flag: 'booth slop', count: 4 }
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/flags')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        flags: [
          { flag: 'furry', count: 12 },
          { flag: 'booth slop', count: 4 },
          { flag: 'sleepy', count: 0 }
        ]
      });
    });

    it('sorts by count descending with alphabetical ties', async () => {
      flags.getAll.mockResolvedValue(['alpha', 'beta', 'gamma', 'delta']);
      flags.countByFlag.mockResolvedValue([
        { flag: 'alpha', count: 3 },
        { flag: 'beta', count: 3 },
        { flag: 'gamma', count: 1 }
      ]);

      const response = await request(app.getHttpServer())
        .get('/api/flags')
        .set('authorization', 'Bearer test-token');

      expect(response.body.flags.map((f: { flag: string }) => f.flag)).toEqual([
        'alpha',
        'beta',
        'gamma',
        'delta'
      ]);
    });

    it('returns 401 without a token', async () => {
      const response = await request(app.getHttpServer()).get('/api/flags');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 for a token lacking tags:read', async () => {
      tokens.findByHash.mockReturnValue(
        createTokenRecord({ permissions: ['worlds:read'] })
      );

      const response = await request(app.getHttpServer())
        .get('/api/flags')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });
  });

  describe('GET /api/meta', () => {
    it('returns quality and platform metadata counts', async () => {
      stubWorldRepository();

      const response = await request(app.getHttpServer())
        .get('/api/meta')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        qualityGood: 123,
        qualityBad: 12,
        platformDesktop: 80,
        platformAndroid: 45,
        platformiOS: 6
      });
    });

    it('includes the high priority count for curator tokens', async () => {
      stubWorldRepository();
      worlds.getMetadataCounts.mockResolvedValue({
        qualityGood: 123,
        qualityBad: 12,
        platformDesktop: 80,
        platformAndroid: 45,
        platformiOS: 6,
        highPriorityCount: 7
      });

      const response = await request(app.getHttpServer())
        .get('/api/meta')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getMetadataCounts).toHaveBeenCalledWith({
        includeHighPriorityCount: true
      });
      expect(response.body.highPriorityCount).toBe(7);
    });

    it('omits the high priority count for viewer tokens', async () => {
      stubWorldRepository();
      worlds.getMetadataCounts.mockResolvedValue({
        qualityGood: 123,
        qualityBad: 12,
        platformDesktop: 80,
        platformAndroid: 45,
        platformiOS: 6
      });
      tokens.findByHash.mockReturnValue(
        createTokenRecord({
          permissions: ['worlds:read', 'tags:read', 'meta:read']
        })
      );

      const response = await request(app.getHttpServer())
        .get('/api/meta')
        .set('authorization', 'Bearer test-token');

      expect(worlds.getMetadataCounts).toHaveBeenCalledWith({
        includeHighPriorityCount: false
      });
      expect(response.body.highPriorityCount).toBeUndefined();
    });
  });

  describe('Access log', () => {
    it('logs status and duration_ms on each request', async () => {
      stubWorldRepository();
      const info = mockFn(logger.info);

      await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      const accessLog = info.mock.calls.find(
        (args) => typeof args[1] === 'string' && args[1].startsWith('HTTP ')
      );
      expect(accessLog).toBeDefined();

      const fields = accessLog![0] as {
        method: string;
        url: string;
        status: number;
        duration_ms: number;
      };
      expect(fields.method).toBe('GET');
      expect(fields.url).toBe('/api/worlds');
      expect(fields.status).toBe(200);
      expect(typeof fields.duration_ms).toBe('number');
      expect(fields.duration_ms).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Error handling', () => {
    it('returns clean JSON 404 for unmatched routes', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/not-a-route')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not Found' });
    });

    it('sanitizes 500 errors from route handlers', async () => {
      worlds.getAllPaginated.mockImplementation(() => {
        throw new Error('database exploded');
      });

      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body).not.toHaveProperty('stack');
    });
  });
});
