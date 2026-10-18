import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

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

vi.mock('../../config', () => ({
  __esModule: true,
  default: mockConfig
}));

vi.mock('../../logger', () => ({
  __esModule: true,
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('../../vrchat/client', () => ({
  fetchWorldData: vi.fn(),
  searchWorldsByName: vi.fn(),
  isCurrentUser: vi.fn(),
  ensureAuthenticated: vi.fn(),
  vrchat: { client: {} }
}));

import logger from '../../logger';
import { createTestApp } from '../../test/create-test-app';
import {
  AUTH,
  createTokenRecord,
  createTokenRepositoryMock,
  createWorldRepositoryMock
} from '../../test/mocks';
import { resetRateLimits } from '../utils/rateLimit';
import type { WorldsQuery } from '../../worlds/query';

const asMock = (fn: unknown) => fn as unknown as ReturnType<typeof vi.fn>;

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
  let app: INestApplication;
  const worlds = createWorldRepositoryMock();
  const tokens = createTokenRepositoryMock();

  beforeEach(async () => {
    resetRateLimits();
    mockConfig.WORLDS_QUERY_RATE_LIMIT = 2;
    mockConfig.WORLDS_QUERY_RATE_WINDOW_MS = 60000;
    worlds.getAllPaginated.mockResolvedValue({ total: 1, rows: [WORLD_ROW] });
    worlds.updateQuality.mockResolvedValue({ updated: true });
    tokens.findByHash.mockReturnValue(
      createTokenRecord({
        roleName: 'bot',
        permissions: ['worlds:read', 'worlds:write', 'worlds:query']
      })
    );
    ({ app } = await createTestApp({ worlds, tokens }));
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('AC-1 rate limits per token and never queries on the denied request', async () => {
    for (let i = 0; i < 2; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/worlds/query')
        .set(AUTH)
        .send({ query: TREE });
      expect(response.status).toBe(200);
    }

    const denied = await request(app.getHttpServer())
      .post('/api/worlds/query')
      .set(AUTH)
      .send({ query: TREE });

    expect(denied.status).toBe(429);
    expect(denied.body).toEqual({ error: 'Too many requests' });
    expect(denied.headers['retry-after']).toBeDefined();
    expect(Number(denied.headers['retry-after'])).toBeGreaterThan(0);
    expect(worlds.getAllPaginated).toHaveBeenCalledTimes(2);
  });

  it('AC-2 logs one structured audit entry without world text', async () => {
    const response = await request(app.getHttpServer())
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
      const response = await request(app.getHttpServer())
        .get('/api/worlds')
        .set(AUTH);
      expect(response.status).toBe(200);
    }

    for (let i = 0; i < 5; i += 1) {
      const response = await request(app.getHttpServer())
        .put('/api/worlds/wrld_abc123/quality')
        .set(AUTH)
        .send({ quality: 'good' });
      expect(response.status).toBe(200);
    }
  });
});
