import type { MockedFunction } from 'vitest';
import { Express } from 'express';
import request from 'supertest';

vi.mock('../config', () => ({
  __esModule: true,
  default: {
    API_PORT: 3000,
    API_HOST: '0.0.0.0',
    API_ALLOWED_ORIGINS: [],
    API_ALLOWED_IPS: [],
    DISABLE_API_RESTRICTIONS: false
  }
}));

vi.mock('../db/worldRepository', () => ({
  getWorldRepository: vi.fn()
}));

vi.mock('../db/tagRepository', () => ({
  getTagRepository: vi.fn()
}));

vi.mock('../db/tokenRepository', () => ({
  __esModule: true,
  getTokenRepository: vi.fn(),
  hashToken: vi.fn((token: string) => token)
}));

vi.mock('../logger', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  searchWorldsByName: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: { client: {} }
}));

import { getWorldRepository } from '../db/worldRepository';
import { getTokenRepository } from '../db/tokenRepository';
import { getTagRepository } from '../db/tagRepository';
import { TAG_SEED } from '../db/tagSeed';
import { searchWorldsByName } from '../vrchat/client';
import { createApiServer } from './index';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as MockedFunction<T>;

function createMockRepo(overrides: Record<string, unknown> = {}) {
  return {
    count: vi.fn(() => 1428),
    getAllPaginated: vi.fn(() => ({
      total: 1,
      rows: [
        {
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
        }
      ]
    })),
    getByWorldId: vi.fn(() => [
      {
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
      }
    ]),
    getUniqueTags: vi.fn(() => [
      { tag: 'horror', count: 312 },
      { tag: 'game', count: 145 }
    ]),
    getMetadataCounts: vi.fn(() => ({
      qualityGood: 123,
      qualityBad: 12,
      platformDesktop: 80,
      platformAndroid: 45,
      platformiOS: 6
    })),
    ...overrides
  };
}

function createMockTokenRepo(
  permissions: string[] = [
    'worlds:read',
    'tags:read',
    'meta:read',
    'worlds:write'
  ]
) {
  return {
    findByHash: vi.fn(() => ({
      id: 1,
      tokenHash: 'test-token',
      name: 'test-token',
      roleId: 1,
      role: { id: 1, name: 'admin', permissions, createdAt: 0 },
      createdAt: 0,
      lastUsedAt: null,
      revokedAt: null
    })),
    touchLastUsed: vi.fn()
  };
}

describe('API Server', () => {
  let app: Express;

  beforeEach(() => {
    asMock(getTokenRepository).mockReturnValue(createMockTokenRepo());
    app = createApiServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    it('returns health status without auth', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());

      const response = await request(app).get('/api/health');

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
      const response = await request(app).get('/api/worlds');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when token is invalid', async () => {
      asMock(getTokenRepository).mockReturnValue({
        findByHash: vi.fn(() => undefined),
        touchLastUsed: vi.fn()
      });

      const response = await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer wrong-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 401 when token is revoked', async () => {
      asMock(getTokenRepository).mockReturnValue({
        findByHash: vi.fn(() => ({
          id: 1,
          tokenHash: 'revoked-token',
          name: 'revoked',
          roleId: 1,
          role: {
            id: 1,
            name: 'admin',
            permissions: ['worlds:read'],
            createdAt: 0
          },
          createdAt: 0,
          lastUsedAt: null,
          revokedAt: 123
        })),
        touchLastUsed: vi.fn()
      });

      const response = await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer revoked-token');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when the token lacks the required permission', async () => {
      asMock(getTokenRepository).mockReturnValue(
        createMockTokenRepo(['tags:read'])
      );

      const response = await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('touches last_used_at for a valid token', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());
      const repo = createMockTokenRepo();
      asMock(getTokenRepository).mockReturnValue(repo);

      await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(repo.touchLastUsed).toHaveBeenCalled();
    });

    it('allows access with a valid token', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());

      const response = await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/worlds', () => {
    it('returns paginated world list with sanitized fields', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());

      const response = await request(app)
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
      const getAllPaginated = vi.fn(() => ({ total: 0, rows: [] }));
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getAllPaginated })
      );

      await request(app)
        .get('/api/worlds?tag=horror&tag=game')
        .set('authorization', 'Bearer test-token');

      expect(getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ tags: ['horror', 'game'] })
      );
    });

    it('caps limit at 500', async () => {
      const getAllPaginated = vi.fn(() => ({ total: 0, rows: [] }));
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getAllPaginated })
      );

      await request(app)
        .get('/api/worlds?limit=9999')
        .set('authorization', 'Bearer test-token');

      expect(getAllPaginated).toHaveBeenCalledWith(500, 0, undefined);
    });

    it('returns 400 when minCapacity is greater than maxCapacity', async () => {
      const response = await request(app)
        .get('/api/worlds?minCapacity=50&maxCapacity=20')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'minCapacity must be less than or equal to maxCapacity'
      });
    });

    it('returns 400 for non-integer capacity values', async () => {
      const response = await request(app)
        .get('/api/worlds?minCapacity=abc')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'minCapacity must be an integer'
      });
    });

    it('passes dayRange filter to repository', async () => {
      const getAllPaginated = vi.fn(() => ({ total: 0, rows: [] }));
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getAllPaginated })
      );

      await request(app)
        .get('/api/worlds?dayRange=7')
        .set('authorization', 'Bearer test-token');

      expect(getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ dayRange: 7 })
      );
    });
  });

  describe('GET /api/worlds/:worldId', () => {
    it('returns a single world with vrchatUrl and quality', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());

      const response = await request(app)
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
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getByWorldId: vi.fn(() => []) })
      );

      const response = await request(app)
        .get('/api/worlds/wrld_missing')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        error: 'World not found'
      });
    });
  });

  describe('GET /api/worlds/search', () => {
    it('returns worlds matching the name query', async () => {
      asMock(searchWorldsByName).mockResolvedValue([
        {
          id: 'wrld_abc123',
          name: 'Midnight Bar',
          authorName: 'VRChat',
          capacity: 40,
          imageUrl: 'https://example.com/img.png',
          unityPackages: []
        }
      ]);

      const response = await request(app)
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
      const response = await request(app)
        .get('/api/worlds/search')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: 'name query parameter is required'
      });
    });

    it('returns 502 when the VRChat search fails', async () => {
      asMock(searchWorldsByName).mockRejectedValue(new Error('vrc down'));

      const response = await request(app)
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
      asMock(getWorldRepository).mockReturnValue(createMockRepo());
      asMock(getTagRepository).mockReturnValue({
        getAll: vi.fn(async () => TAG_SEED)
      });

      const response = await request(app)
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
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getUniqueTags: vi.fn(() => [
            { tag: 'horror', count: 312 },
            { tag: 'legacy-tag', count: 3 }
          ])
        })
      );
      asMock(getTagRepository).mockReturnValue({
        getAll: vi.fn(async () => TAG_SEED)
      });

      const response = await request(app)
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

  describe('GET /api/meta', () => {
    it('returns quality and platform metadata counts', async () => {
      asMock(getWorldRepository).mockReturnValue(createMockRepo());

      const response = await request(app)
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
      const getMetadataCounts = vi.fn(() => ({
        qualityGood: 123,
        qualityBad: 12,
        platformDesktop: 80,
        platformAndroid: 45,
        platformiOS: 6,
        highPriorityCount: 7
      }));
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getMetadataCounts })
      );

      const response = await request(app)
        .get('/api/meta')
        .set('authorization', 'Bearer test-token');

      expect(getMetadataCounts).toHaveBeenCalledWith({
        includeHighPriorityCount: true
      });
      expect(response.body.highPriorityCount).toBe(7);
    });

    it('omits the high priority count for viewer tokens', async () => {
      const getMetadataCounts = vi.fn(() => ({
        qualityGood: 123,
        qualityBad: 12,
        platformDesktop: 80,
        platformAndroid: 45,
        platformiOS: 6
      }));
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getMetadataCounts })
      );
      asMock(getTokenRepository).mockReturnValue(
        createMockTokenRepo(['worlds:read', 'tags:read', 'meta:read'])
      );

      const response = await request(app)
        .get('/api/meta')
        .set('authorization', 'Bearer test-token');

      expect(getMetadataCounts).toHaveBeenCalledWith({
        includeHighPriorityCount: false
      });
      expect(response.body.highPriorityCount).toBeUndefined();
    });
  });

  describe('Error handling', () => {
    it('returns clean JSON 404 for unmatched routes', async () => {
      const response = await request(app)
        .get('/api/not-a-route')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Not Found' });
    });

    it('sanitizes 500 errors from route handlers', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getAllPaginated: vi.fn(() => {
            throw new Error('database exploded');
          })
        })
      );

      const response = await request(app)
        .get('/api/worlds')
        .set('authorization', 'Bearer test-token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body).not.toHaveProperty('stack');
    });
  });
});
