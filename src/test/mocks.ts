import { vi } from 'vitest';
import type { Permission } from '../auth/permissions';
import type { ApiTokenRecord } from '../db/tokenRepository';

export const AUTH = { authorization: 'Bearer test-token' };

export function createWorldRepositoryMock() {
  return {
    count: vi.fn(),
    getUniqueTags: vi.fn(),
    getMetadataCounts: vi.fn(),
    getAllPaginated: vi.fn(),
    getAllWorldIds: vi.fn(),
    getByWorldId: vi.fn(),
    deleteByWorldId: vi.fn(),
    updateQuality: vi.fn(),
    updateTags: vi.fn(),
    updateTagsOnly: vi.fn()
  };
}

export function createTagRepositoryMock() {
  return { getAll: vi.fn() };
}

export function createFlagRepositoryMock() {
  return {
    getAll: vi.fn(),
    countByFlag: vi.fn(),
    replaceWorldFlags: vi.fn()
  };
}

export function createHighPriorityRepositoryMock() {
  return { add: vi.fn(), remove: vi.fn() };
}

export function createTokenRepositoryMock() {
  return { findByHash: vi.fn(), touchLastUsed: vi.fn() };
}

export type WorldRepositoryMock = ReturnType<typeof createWorldRepositoryMock>;
export type TagRepositoryMock = ReturnType<typeof createTagRepositoryMock>;
export type FlagRepositoryMock = ReturnType<typeof createFlagRepositoryMock>;
export type HighPriorityRepositoryMock = ReturnType<
  typeof createHighPriorityRepositoryMock
>;
export type TokenRepositoryMock = ReturnType<typeof createTokenRepositoryMock>;

export interface TokenRecordOptions {
  id?: number;
  name?: string;
  roleName?: string;
  permissions?: Permission[];
  lastUsedAt?: number | null;
  revokedAt?: number | null;
}

export function createTokenRecord(
  options: TokenRecordOptions = {}
): ApiTokenRecord {
  return {
    id: options.id ?? 1,
    tokenHash: 'test-token',
    name: options.name ?? 'test-token',
    roleId: 1,
    role: {
      id: 1,
      name: options.roleName ?? 'admin',
      permissions: options.permissions ?? [
        'worlds:read',
        'tags:read',
        'meta:read',
        'worlds:write'
      ],
      createdAt: 0
    },
    createdAt: 0,
    lastUsedAt: options.lastUsedAt ?? null,
    revokedAt: options.revokedAt ?? null
  };
}
