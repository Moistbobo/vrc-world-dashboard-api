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

import { createTestApp } from '../../test/create-test-app';
import { TokenRepository } from '../../db/tokenRepository';
import type { Permission } from '../../auth/permissions';

const AUTH = { authorization: 'Bearer test-token' };

function tokenRecord(roleName: string, permissions: Permission[]) {
  return {
    id: 1,
    tokenHash: 'test-token',
    name: 'test-token',
    roleId: 1,
    role: { id: 1, name: roleName, permissions, createdAt: 0 },
    createdAt: 0,
    lastUsedAt: null,
    revokedAt: null
  };
}

describe('GET /api/me', () => {
  let app: INestApplication;
  let findByHash: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    findByHash = vi.fn(() =>
      tokenRecord('admin', [
        'worlds:read',
        'tags:read',
        'meta:read',
        'worlds:write'
      ])
    );
    const tokens = {
      findByHash,
      touchLastUsed: vi.fn()
    } as unknown as TokenRepository;
    ({ app } = await createTestApp({ tokens }));
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it('returns 401 without a token', async () => {
    const response = await request(app.getHttpServer()).get('/api/me');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns the token name, role, and permissions', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/me')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: 'test-token',
      role: 'admin',
      permissions: ['worlds:read', 'tags:read', 'meta:read', 'worlds:write']
    });
  });

  it('does not gate on permissions: viewer tokens succeed', async () => {
    findByHash.mockReturnValue(
      tokenRecord('viewer', ['worlds:read', 'tags:read', 'meta:read'])
    );

    const response = await request(app.getHttpServer())
      .get('/api/me')
      .set(AUTH);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      name: 'test-token',
      role: 'viewer',
      permissions: ['worlds:read', 'tags:read', 'meta:read']
    });
  });
});
