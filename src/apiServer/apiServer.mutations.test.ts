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

vi.mock('../worlds/service', () => ({
  addWorld: vi.fn(),
  WorldServiceError: class WorldServiceError extends Error {
    readonly kind: string;
    readonly statusCode: number;
    constructor(kind: string, message: string, statusCode: number) {
      super(message);
      this.kind = kind;
      this.statusCode = statusCode;
    }
  }
}));

vi.mock('../extraction/pipeline', () => ({
  extractAllWorldIdsFromMessage: vi.fn()
}));

vi.mock('../tags/extractor', () => ({
  extractTags: vi.fn(),
  validateTags: vi.fn()
}));

vi.mock('../vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: { client: {} }
}));

import { getWorldRepository } from '../db/worldRepository';
import { getTokenRepository } from '../db/tokenRepository';
import { addWorld, WorldServiceError } from '../worlds/service';
import { extractAllWorldIdsFromMessage } from '../extraction/pipeline';
import { extractTags, validateTags } from '../tags/extractor';
import { createApiServer } from './index';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as MockedFunction<T>;

const AUTH = { authorization: 'Bearer test-token' };

const VALID_BODY = {
  worldId: 'wrld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  guildId: 'guild-1',
  messageId: '1250000000000000000',
  content:
    'https://vrchat.com/home/world/wrld_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Tags: horror, game'
};

describe('API mutations', () => {
  let app: Express;

  function mockTokenRepo(
    permissions: string[] = [
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:write'
    ]
  ) {
    asMock(getTokenRepository).mockReturnValue({
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
    });
  }

  beforeEach(() => {
    mockTokenRepo();
    app = createApiServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/worlds', () => {
    it('returns 401 without a token', async () => {
      const response = await request(app).post('/api/worlds').send(VALID_BODY);

      expect(response.status).toBe(401);
    });

    it('returns 403 when the token lacks worlds:write', async () => {
      mockTokenRepo(['worlds:read']);

      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send(VALID_BODY);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 on invalid body', async () => {
      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send({ guildId: 'guild-1' });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid body');
    });

    it('returns 400 on malformed worldId', async () => {
      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send({ ...VALID_BODY, worldId: 'not-a-world-id' });

      expect(response.status).toBe(400);
    });

    it('returns 201 with full record (including guildId/messageId/vrchatData) when new', async () => {
      asMock(addWorld).mockResolvedValue({
        status: 'created',
        world: {
          worldId: VALID_BODY.worldId,
          guildId: VALID_BODY.guildId,
          messageId: VALID_BODY.messageId,
          name: 'Midnight Bar',
          authorName: 'VRChat',
          capacity: 40,
          platforms: ['standalonewindows'],
          tags: ['horror', 'game'],
          imageUrl: 'https://example.com/img.png',
          sourceContent: 'original message',
          vrchatData: '{"id":"wrld_x"}',
          packageSizes: [104.5],
          quality: null,
          createdAt: 1717257600,
          updatedAt: 1717257600,
          internalAddDate: 1717257600
        }
      });

      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send(VALID_BODY);

      expect(response.status).toBe(201);
      const body = response.body;
      expect(body.duplicate).toBe(false);
      expect(body.world.worldId).toBe(VALID_BODY.worldId);
      expect(body.world.name).toBe('Midnight Bar');
      expect(body.world.guildId).toBe(VALID_BODY.guildId);
      expect(body.world.messageId).toBe(VALID_BODY.messageId);
      expect(body.world.vrchatData).toBe('{"id":"wrld_x"}');
      expect(body.world.packageSizes).toEqual([104.5]);
      expect(body.world.tags).toEqual(['horror', 'game']);
    });

    it('returns 200 duplicate with existingMessageId when world exists', async () => {
      asMock(addWorld).mockResolvedValue({
        status: 'duplicate',
        existingMessageId: '1240000000000000000',
        world: {
          worldId: VALID_BODY.worldId,
          name: 'Midnight Bar',
          authorName: 'VRChat',
          capacity: 40,
          platforms: ['standalonewindows'],
          tags: ['horror'],
          imageUrl: 'https://example.com/img.png',
          sourceContent: null,
          vrchatData: null,
          packageSizes: [],
          quality: null,
          createdAt: 1717257600,
          updatedAt: 1717257600,
          guildId: VALID_BODY.guildId,
          messageId: '1240000000000000000',
          internalAddDate: null
        }
      });

      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send(VALID_BODY);

      expect(response.status).toBe(200);
      const body = response.body;
      expect(body.duplicate).toBe(true);
      expect(body.existingMessageId).toBe('1240000000000000000');
    });

    it('returns 502 when VRChat fetch fails', async () => {
      asMock(addWorld).mockRejectedValue(
        new WorldServiceError(
          'vrchatFetchFailed',
          'Failed to fetch world data from VRChat',
          502
        )
      );

      const response = await request(app)
        .post('/api/worlds')
        .set(AUTH)
        .send(VALID_BODY);

      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        error: 'Failed to fetch world data from VRChat'
      });
    });
  });

  describe('POST /api/worlds/extract', () => {
    it('returns 401 without a token', async () => {
      const response = await request(app)
        .post('/api/worlds/extract')
        .send({ content: 'hello' });

      expect(response.status).toBe(401);
    });

    it('returns 400 on invalid body', async () => {
      const response = await request(app)
        .post('/api/worlds/extract')
        .set(AUTH)
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid body');
    });

    it('returns extracted worlds from content', async () => {
      asMock(extractAllWorldIdsFromMessage).mockResolvedValue([
        { worldId: 'wrld_abc', sourceContent: 'content' }
      ]);

      const response = await request(app)
        .post('/api/worlds/extract')
        .set(AUTH)
        .send({ content: 'https://vrchat.com/home/world/wrld_abc' });

      expect(response.status).toBe(200);
      expect(extractAllWorldIdsFromMessage).toHaveBeenCalledWith(
        'https://vrchat.com/home/world/wrld_abc'
      );
      expect(response.body).toEqual({
        worlds: [{ worldId: 'wrld_abc', sourceContent: 'content' }]
      });
    });

    it('returns 502 when extraction fails', async () => {
      asMock(extractAllWorldIdsFromMessage).mockRejectedValue(
        new Error('vxtwitter down')
      );

      const response = await request(app)
        .post('/api/worlds/extract')
        .set(AUTH)
        .send({ content: 'https://x.com/user/status/1' });

      expect(response.status).toBe(502);
      expect(response.body).toEqual({
        error: 'Failed to extract worlds from content'
      });
    });
  });

  describe('DELETE /api/worlds/:worldId', () => {
    it('deletes the record and returns 204', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ deleteByWorldAndGuild: vi.fn(() => true) })
      );

      const response = await request(app)
        .delete(`/api/worlds/${VALID_BODY.worldId}`)
        .set(AUTH)
        .send({ guildId: 'guild-1' });

      expect(response.status).toBe(204);
    });

    it('returns 404 when record does not exist', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ deleteByWorldAndGuild: vi.fn(() => false) })
      );

      const response = await request(app)
        .delete(`/api/worlds/${VALID_BODY.worldId}`)
        .set(AUTH)
        .send({ guildId: 'guild-1' });

      expect(response.status).toBe(404);
    });

    it('returns 400 when guildId is missing', async () => {
      const response = await request(app)
        .delete(`/api/worlds/${VALID_BODY.worldId}`)
        .set(AUTH)
        .send({});

      expect(response.status).toBe(400);
    });
  });

  describe('PUT /api/worlds/:worldId/quality', () => {
    it('updates quality and returns 200 with updated: true', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateQuality: vi.fn(() => true)
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ guildId: 'guild-1', quality: 'good' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: true });
    });

    it('returns 200 with updated: false when quality is unchanged', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateQuality: vi.fn(() => false)
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ guildId: 'guild-1', quality: 'bad' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: false });
    });

    it('returns 400 on invalid quality value', async () => {
      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ guildId: 'guild-1', quality: 'amazing' });

      expect(response.status).toBe(400);
    });

    it('clears quality with null and returns 200 with updated: true', async () => {
      const updateQuality = vi.fn(() => true);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateQuality
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ guildId: 'guild-1', quality: null });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: true });
      expect(updateQuality).toHaveBeenCalledWith(
        VALID_BODY.worldId,
        'guild-1',
        null
      );
    });

    it('returns 400 when guildId is missing', async () => {
      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ quality: 'good' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when world does not exist', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getByWorldAndGuild: vi.fn(() => undefined) })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/quality`)
        .set(AUTH)
        .send({ guildId: 'guild-1', quality: 'bad' });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/worlds/:worldId/tags', () => {
    it('computes tags server-side and returns 200 with updated: true', async () => {
      asMock(extractTags).mockReturnValue(['horror', 'game']);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTags: vi.fn(() => true)
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags`)
        .set(AUTH)
        .send({
          guildId: 'guild-1',
          sourceContent: 'Tags: horror, game'
        });

      expect(response.status).toBe(200);
      expect(extractTags).toHaveBeenCalledWith('Tags: horror, game');
      expect(response.body).toEqual({
        updated: true,
        tags: ['horror', 'game']
      });
    });

    it('computes tags from tagSource but stores sourceContent', async () => {
      asMock(extractTags).mockReturnValue(['horror', 'game']);
      const updateTags = vi.fn(() => true);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTags
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags`)
        .set(AUTH)
        .send({
          guildId: 'guild-1',
          sourceContent: 'per-world raw source',
          tagSource: 'combined cleaned tag source'
        });

      expect(response.status).toBe(200);
      expect(extractTags).toHaveBeenCalledWith('combined cleaned tag source');
      expect(updateTags).toHaveBeenCalledWith(
        VALID_BODY.worldId,
        'guild-1',
        ['horror', 'game'],
        'per-world raw source',
        1
      );
      expect(response.body).toEqual({
        updated: true,
        tags: ['horror', 'game']
      });
    });

    it('returns 200 with updated: false when nothing changed', async () => {
      asMock(extractTags).mockReturnValue(['horror']);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTags: vi.fn(() => false)
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags`)
        .set(AUTH)
        .send({ guildId: 'guild-1', sourceContent: 'Tags: horror' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: false, tags: ['horror'] });
    });

    it('returns 400 when sourceContent is missing', async () => {
      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags`)
        .set(AUTH)
        .send({ guildId: 'guild-1' });

      expect(response.status).toBe(400);
    });

    it('returns 404 when world does not exist', async () => {
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getByWorldAndGuild: vi.fn(() => undefined) })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags`)
        .set(AUTH)
        .send({ guildId: 'guild-1', sourceContent: 'Tags: horror' });

      expect(response.status).toBe(404);
    });
  });

  describe('PUT /api/worlds/:worldId/tags/edit', () => {
    const tagsWritePermissions = [
      'worlds:read',
      'tags:read',
      'meta:read',
      'worlds:write',
      'tags:write'
    ];

    it('returns 401 without a token', async () => {
      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .send({ guildId: 'guild-1', tags: ['horror'] });

      expect(response.status).toBe(401);
    });

    it('returns 403 when the token lacks tags:write', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read', 'worlds:write']);

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['horror'] });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('returns 400 when guildId is missing', async () => {
      mockTokenRepo(tagsWritePermissions);

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ tags: ['horror'] });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid body');
    });

    it('returns 400 when tags is not an array', async () => {
      mockTokenRepo(tagsWritePermissions);

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: 'horror' });

      expect(response.status).toBe(400);
    });

    it('accepts more than 20 tags', async () => {
      mockTokenRepo(tagsWritePermissions);
      const manyTags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
      asMock(validateTags).mockReturnValue({
        valid: manyTags,
        invalid: []
      });
      const updateTagsOnly = vi.fn(() => true);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTagsOnly
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: manyTags });

      expect(response.status).toBe(200);
      expect(updateTagsOnly).toHaveBeenCalledWith(
        VALID_BODY.worldId,
        'guild-1',
        manyTags,
        1
      );
    });

    it('returns 400 when tags contains a non-string entry', async () => {
      mockTokenRepo(tagsWritePermissions);

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['horror', 5] });

      expect(response.status).toBe(400);
    });

    it('returns 404 when world does not exist', async () => {
      mockTokenRepo(tagsWritePermissions);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getByWorldAndGuild: vi.fn(() => undefined) })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['horror'] });

      expect(response.status).toBe(404);
    });

    it('returns 400 listing invalid tags', async () => {
      mockTokenRepo(tagsWritePermissions);
      asMock(validateTags).mockReturnValue({ valid: [], invalid: ['nope'] });
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({ getByWorldAndGuild: vi.fn(() => ({})) })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['nope'] });

      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Invalid tags: nope' });
    });

    it('returns 200 with updated: true and passes canonical tags to the repo', async () => {
      mockTokenRepo(tagsWritePermissions);
      asMock(validateTags).mockReturnValue({
        valid: ['horror', 'game'],
        invalid: []
      });
      const updateTagsOnly = vi.fn(() => true);
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTagsOnly
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['Horror', ' vrmv '] });

      expect(response.status).toBe(200);
      expect(updateTagsOnly).toHaveBeenCalledWith(
        VALID_BODY.worldId,
        'guild-1',
        ['horror', 'game'],
        1
      );
      expect(response.body).toEqual({
        updated: true,
        tags: ['horror', 'game']
      });
    });

    it('returns 200 with updated: false when tags are unchanged', async () => {
      mockTokenRepo(tagsWritePermissions);
      asMock(validateTags).mockReturnValue({ valid: ['horror'], invalid: [] });
      asMock(getWorldRepository).mockReturnValue(
        createMockRepo({
          getByWorldAndGuild: vi.fn(() => ({})),
          updateTagsOnly: vi.fn(() => false)
        })
      );

      const response = await request(app)
        .put(`/api/worlds/${VALID_BODY.worldId}/tags/edit`)
        .set(AUTH)
        .send({ guildId: 'guild-1', tags: ['horror'] });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ updated: false, tags: ['horror'] });
    });
  });

  function createMockRepo(overrides: Record<string, unknown> = {}) {
    return {
      count: vi.fn(() => 1428),
      getAllPaginated: vi.fn(() => ({ total: 0, rows: [] })),
      getByWorldId: vi.fn(() => []),
      getUniqueTags: vi.fn(() => []),
      getMetadataCounts: vi.fn(() => ({
        qualityGood: 0,
        qualityBad: 0,
        platformDesktop: 0,
        platformAndroid: 0,
        platformiOS: 0
      })),
      getAllWorldGuildPairs: vi.fn(() => new Set()),
      ...overrides
    };
  }
});
