import { runMigrations } from './schema';
import { createTestDb, type TestDb } from './testUtils';
import { RoleRepository } from './roleRepository';
import { TokenRepository, hashToken } from './tokenRepository';

describe('roles', () => {
  let queryable: TestDb['queryable'];

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
  });

  test('seeds viewer, curator, admin roles', async () => {
    const repo = new RoleRepository(queryable);
    const roles = await repo.list();
    const names = roles.map((r) => r.name).sort();
    expect(names).toEqual(['admin', 'curator', 'viewer']);
    expect(roles.find((r) => r.name === 'viewer')?.permissions).toEqual([
      'worlds:read',
      'tags:read',
      'meta:read'
    ]);
    expect(roles.find((r) => r.name === 'curator')?.permissions).toContain(
      'worlds:write'
    );
    expect(roles.find((r) => r.name === 'admin')?.permissions).toContain(
      'worlds:write'
    );
  });

  test('create adds a role with the given permissions', async () => {
    const repo = new RoleRepository(queryable);
    const role = await repo.create('curator-v2', [
      'worlds:read',
      'worlds:write'
    ]);
    expect(role.permissions).toEqual(['worlds:read', 'worlds:write']);
    expect(await repo.findByName('curator-v2')).toMatchObject({
      name: 'curator-v2'
    });
  });

  test('create rejects a duplicate name', async () => {
    const repo = new RoleRepository(queryable);
    await expect(repo.create('viewer', ['worlds:read'])).rejects.toThrow(
      'already exists'
    );
  });

  test('create rejects unknown permissions', async () => {
    const repo = new RoleRepository(queryable);
    await expect(
      repo.create('bogus', ['worlds:read', 'does:not-exist'] as never)
    ).rejects.toThrow('Unknown permission');
  });

  test('updatePermissions adds and removes, ignoring no-ops', async () => {
    const repo = new RoleRepository(queryable);
    const updated = await repo.updatePermissions(
      'viewer',
      ['worlds:write'],
      ['meta:read', 'meta:read']
    );
    expect(updated?.permissions).toEqual([
      'worlds:read',
      'tags:read',
      'worlds:write'
    ]);
    expect((await repo.findByName('viewer'))?.permissions).toEqual(
      updated?.permissions
    );
  });

  test('updatePermissions returns undefined for a missing role', async () => {
    const repo = new RoleRepository(queryable);
    expect(await repo.updatePermissions('nope', [], [])).toBeUndefined();
  });
});

describe('api tokens', () => {
  let queryable: TestDb['queryable'];
  let roles: RoleRepository;

  beforeEach(async () => {
    ({ queryable } = createTestDb());
    await runMigrations(queryable);
    roles = new RoleRepository(queryable);
  });

  test('create returns a raw token whose hash can look it up', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { rawToken, record } = await repo.create('bot', viewer);

    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(record.name).toBe('bot');
    expect(record.roleId).toBe(viewer.id);
    expect(record.revokedAt).toBeNull();

    const found = await repo.findByHash(hashToken(rawToken));
    expect(found).toMatchObject({ name: 'bot' });
    expect(found?.role.permissions).toEqual(viewer.permissions);
  });

  test('create rejects a duplicate name', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    await repo.create('bot', viewer);
    await expect(repo.create('bot', viewer)).rejects.toThrow('already exists');
  });

  test('generateRawToken produces unique tokens', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const a = (await repo.create('a', viewer)).rawToken;
    const b = (await repo.create('b', viewer)).rawToken;
    expect(a).not.toBe(b);
  });

  test('findByHash returns undefined for an unknown hash', async () => {
    const repo = new TokenRepository(queryable);
    expect(await repo.findByHash('0'.repeat(64))).toBeUndefined();
  });

  test('revoke is idempotent and marks the token', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { record } = await repo.create('bot', viewer);
    expect(await repo.revoke('bot')).toBe(true);
    expect(await repo.revoke('bot')).toBe(false);
    expect((await repo.findByName('bot'))?.revokedAt).not.toBeNull();
    expect(record.revokedAt).toBeNull();
  });

  test('touchLastUsed updates the timestamp', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    const { record } = await repo.create('bot', viewer);
    expect(record.lastUsedAt).toBeNull();
    await repo.touchLastUsed(record.id, 1234567890);
    expect((await repo.findByName('bot'))?.lastUsedAt).toBe(1234567890);
  });

  test('list returns tokens with their roles', async () => {
    const repo = new TokenRepository(queryable);
    const viewer = (await roles.findByName('viewer'))!;
    await repo.create('bot', viewer);
    await repo.create('dash', viewer);
    const tokens = await repo.list();
    expect(tokens.map((t) => t.name).sort()).toEqual(['bot', 'dash']);
    expect((await repo.list())[0].role.name).toBe('viewer');
  });
});
