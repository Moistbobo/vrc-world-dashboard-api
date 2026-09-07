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

vi.mock('../db/highPriorityRepository', () => ({
  getHighPriorityRepository: vi.fn()
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
import { getHighPriorityRepository } from '../db/highPriorityRepository';
import { getTokenRepository } from '../db/tokenRepository';
import { createApiServer } from './index';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as MockedFunction<T>;

const AUTH = { authorization: 'Bearer test-token' };

const WORLD_ID = 'wrld_abc123';
const GUILD_ID = 'guild-1';

const WORLD_ROW = {
  worldId: WORLD_ID,
  guildId: GUILD_ID,
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
  highPriority: true,
  createdAt: 1717257600,
  updatedAt: 1717257600
};

describe('High priority worlds API', () => {
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

  function mockWorldRepo(overrides: Record<string, unknown> = {}) {
    asMock(getWorldRepository).mockReturnValue({
      getAllPaginated: vi.fn(() => ({ total: 1, rows: [WORLD_ROW] })),
      getByWorldId: vi.fn(() => WORLD_ROW),
      ...overrides
    });
  }

  function mockHpRepo(overrides: Record<string, unknown> = {}) {
    asMock(getHighPriorityRepository).mockReturnValue({
      add: vi.fn(() => ({ added: true })),
      remove: vi.fn(() => ({ removed: true })),
      ...overrides
    });
  }

  beforeEach(() => {
    mockTokenRepo();
    mockWorldRepo();
    mockHpRepo();
    app = createApiServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('PUT /api/worlds/:worldId/high-priority', () => {
    it('returns 401 without a token', async () => {
      const response = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when the token lacks worlds:write', async () => {
      mockTokenRepo(['worlds:read']);

      const response = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('accepts an empty body', async () => {
      const response = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ added: true });
    });

    it('returns 404 when the world does not exist', async () => {
      mockWorldRepo({ getByWorldId: vi.fn(() => undefined) });

      const response = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'World not found' });
    });

    it('returns 200 with added: true then added: false on repeat', async () => {
      const add = vi
        .fn()
        .mockReturnValueOnce({ added: true })
        .mockReturnValueOnce({ added: false });
      asMock(getHighPriorityRepository).mockReturnValue({ add });

      const first = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ added: true });

      const second = await request(app)
        .put(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ added: false });

      expect(add).toHaveBeenCalledWith(WORLD_ID, 1);
    });
  });

  describe('DELETE /api/worlds/:worldId/high-priority', () => {
    it('returns 401 without a token', async () => {
      const response = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 403 when the token lacks worlds:write', async () => {
      mockTokenRepo(['worlds:read']);

      const response = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('accepts an empty body', async () => {
      const response = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ removed: true });
    });

    it('returns 404 when the world does not exist', async () => {
      mockWorldRepo({ getByWorldId: vi.fn(() => undefined) });

      const response = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'World not found' });
    });

    it('returns 200 with removed: true then removed: false on repeat', async () => {
      const remove = vi
        .fn()
        .mockReturnValueOnce({ removed: true })
        .mockReturnValueOnce({ removed: false });
      asMock(getHighPriorityRepository).mockReturnValue({ remove });

      const first = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ removed: true });

      const second = await request(app)
        .delete(`/api/worlds/${WORLD_ID}/high-priority`)
        .set(AUTH)
        .send({ guildId: GUILD_ID });
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ removed: false });

      expect(remove).toHaveBeenCalledWith(WORLD_ID);
    });
  });

  describe('GET /api/worlds highPriority field', () => {
    it('includes highPriority for worlds:write tokens', async () => {
      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0].highPriority).toBe(true);
    });

    it('omits highPriority for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0]).not.toHaveProperty('highPriority');
    });

    it('includes highPriority on the detail route for worlds:write tokens', async () => {
      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.highPriority).toBe(true);
    });

    it('omits highPriority on the detail route for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('highPriority');
    });
  });

  describe('GET /api/worlds quality field', () => {
    it('includes quality for worlds:write tokens', async () => {
      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0].quality).toBe('good');
    });

    it('omits quality for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0]).not.toHaveProperty('quality');
    });

    it('includes quality on the detail route for worlds:write tokens', async () => {
      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.quality).toBe('good');
    });

    it('omits quality on the detail route for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('quality');
    });
  });

  describe('GET /api/worlds guildId field', () => {
    it('includes guildId for worlds:write tokens', async () => {
      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0].guildId).toBe(GUILD_ID);
    });

    it('omits guildId for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app).get('/api/worlds').set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.worlds[0]).not.toHaveProperty('guildId');
    });

    it('includes guildId on the detail route for worlds:write tokens', async () => {
      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body.guildId).toBe(GUILD_ID);
    });

    it('omits guildId on the detail route for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app)
        .get(`/api/worlds/${WORLD_ID}`)
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(response.body).not.toHaveProperty('guildId');
    });
  });

  describe('GET /api/worlds?highPriority=true', () => {
    it('returns 403 for viewer tokens', async () => {
      mockTokenRepo(['worlds:read', 'tags:read', 'meta:read']);

      const response = await request(app)
        .get('/api/worlds?highPriority=true')
        .set(AUTH);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: 'Forbidden' });
    });

    it('filters to high priority worlds for worlds:write tokens', async () => {
      const getAllPaginated = vi.fn(() => ({ total: 1, rows: [WORLD_ROW] }));
      asMock(getWorldRepository).mockReturnValue({ getAllPaginated });

      const response = await request(app)
        .get('/api/worlds?highPriority=true')
        .set(AUTH);

      expect(response.status).toBe(200);
      expect(getAllPaginated).toHaveBeenCalledWith(
        50,
        0,
        expect.objectContaining({ highPriorityOnly: true })
      );
      expect(response.body.worlds[0].highPriority).toBe(true);
    });
  });
});
