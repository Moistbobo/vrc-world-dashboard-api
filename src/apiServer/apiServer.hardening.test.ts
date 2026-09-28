import type { MockedFunction } from 'vitest';
import { Express } from 'express';
import request from 'supertest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    API_PORT: 3000,
    API_HOST: '0.0.0.0',
    API_ALLOWED_ORIGINS: [],
    API_ALLOWED_IPS: [],
    DISABLE_API_RESTRICTIONS: false,
    WORLDS_QUERY_RATE_LIMIT: 2,
    WORLDS_QUERY_RATE_WINDOW_MS: 60000
  } as Record<string, unknown>
}));

vi.mock('../config', () => ({
  __esModule: true,
  default: mockConfig
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

vi.mock('../vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  searchWorldsByName: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: { client: {} }
}));

import { getWorldRepository } from '../db/worldRepository';
import { getTokenRepository } from '../db/tokenRepository';
import logger from '../logger';
import { createApiServer } from './index';
import { resetRateLimits } from './utils/rateLimit';
import type { WorldsQuery } from '../worlds/query';

const asMock = <T extends (...args: any[]) => any>(fn: any) =>
  fn as MockedFunction<T>;

const AUTH = { authorization: 'Bearer test-token' };

const WORLD_ROW = {
  worldId: 'wrld_abc123',
  guildId: 'guild-1',
  name: 'Spooky Mansion',
  authorName: 'GhostDev',
  capacity: 16,
  platforms: ['standalonewindows'],
  tags: ['horror'],
  flags: [],
  imageUrl: 'https://example.com/img.png',
  sourceContent: 'secret raw tweet text',
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
      conditions: [
        { field: 'tag', op: 'has', value: 'kino' },
        { field: 'tag', op: 'has', value: 'horror' }
      ]
    },
    {
      connector: 'or',
      conditions: [{ field: 'name', op: 'contains', value: 'mansion' }]
    }
  ]
};

describe('worlds query hardening', () => {
  let app: Express;
  let getAllPaginated: ReturnType<typeof vi.fn>;
  let updateQuality: ReturnType<typeof vi.fn>;

  function mockTokenRepo(permissions: string[], roleName = 'bot') {
    asMock(getTokenRepository).mockReturnValue({
      findByHash: vi.fn(() => ({
        id: 1,
        tokenHash: 'test-token',
        name: 'test-token',
        roleId: 1,
        role: { id: 1, name: roleName, permissions, createdAt: 0 },
        createdAt: 0,
        lastUsedAt: null,
        revokedAt: null
      })),
      touchLastUsed: vi.fn()
    });
  }

  beforeEach(() => {
    resetRateLimits();
    mockConfig.WORLDS_QUERY_RATE_LIMIT = 2;
    mockConfig.WORLDS_QUERY_RATE_WINDOW_MS = 60000;
    getAllPaginated = vi.fn(() => ({ total: 1, rows: [WORLD_ROW] }));
    updateQuality = vi.fn(() => ({ updated: true }));
    asMock(getWorldRepository).mockReturnValue({
      getAllPaginated,
      updateQuality
    });
    mockTokenRepo(['worlds:read', 'worlds:write', 'worlds:query']);
    app = createApiServer();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('AC-1 rate limits per token and never queries on the denied request', async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await request(app)
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });
      expect(response.status).toBe(200);
    }

    const denied = await request(app)
      .post('/api/worlds/query')
      .set(AUTH)
      .send({ query: TREE });

    expect(denied.status).toBe(429);
    expect(denied.body).toEqual({ error: 'Too many requests' });
    expect(denied.headers['retry-after']).toBeDefined();
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(getAllPaginated).toHaveBeenCalledTimes(2);
  });

  it('AC-2 logs one structured audit entry without world text', async () => {
    const response = await request(app)
      .post('/api/worlds/query')
      .set(AUTH)
      .send({ query: TREE });

    expect(response.status).toBe(200);

    const audit = asMock(logger.info).mock.calls.find(
      (call) => (call[0] as { event?: string })?.event === 'worlds_query'
    );
    expect(audit).toBeDefined();
    const payload = audit![0] as Record<string, unknown>;
    expect(payload.role).toBe('bot');
    expect(payload.groups).toBe(2);
    expect(payload.conditions).toBe(3);
    expect(typeof payload.duration_ms).toBe('number');
    expect(payload.total).toBe(1);

    const serialized = JSON.stringify(asMock(logger.info).mock.calls);
    expect(serialized).not.toContain('Spooky Mansion');
    expect(serialized).not.toContain('secret raw tweet text');
  });

  it('AC-4 leaves GET and mutation routes unlimited', async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await request(app).get('/api/worlds').set(AUTH);
      expect(response.status).toBe(200);
    }

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app)
        .put('/api/worlds/wrld_abc123/quality')
        .set(AUTH)
        .send({ quality: 'good' });
      expect(response.status).toBe(200);
    }
  });
});
