import type { Queryable } from './client';
import { getQueryable } from './pool';
import { toNumber, toNumberOrNull } from './mappers';
import { randomBytes, createHash } from 'crypto';
import { RoleRepository, type RoleRecord } from './roleRepository';
import logger from '../logger';

export interface ApiTokenRecord {
  id: number;
  tokenHash: string;
  name: string;
  roleId: number;
  role: RoleRecord;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

interface TokenRow extends Record<string, unknown> {
  id: bigint | number;
  token_hash: string;
  name: string;
  role_id: bigint | number;
  created_at: bigint | number;
  last_used_at: bigint | number | null;
  revoked_at: bigint | number | null;
}

function rowToToken(row: TokenRow, role: RoleRecord): ApiTokenRecord {
  return {
    id: toNumber(row.id),
    tokenHash: row.token_hash,
    name: row.name,
    roleId: toNumber(row.role_id),
    role,
    createdAt: toNumber(row.created_at),
    lastUsedAt: toNumberOrNull(row.last_used_at),
    revokedAt: toNumberOrNull(row.revoked_at)
  };
}

export class TokenRepository {
  private db: Queryable;
  private roles: RoleRepository;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
    this.roles = new RoleRepository(this.db);
  }

  async create(
    name: string,
    role: RoleRecord
  ): Promise<{ rawToken: string; record: ApiTokenRecord }> {
    const exists = await this.findByName(name);
    if (exists) {
      throw new Error(`Token "${name}" already exists`);
    }

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const result = await this.db.query<TokenRow>(
      `INSERT INTO api_tokens (token_hash, name, role_id)
       VALUES ($1, $2, $3)
       RETURNING id, token_hash, name, role_id, created_at, last_used_at, revoked_at`,
      [tokenHash, name, role.id]
    );
    logger.info(`Created token "${name}" with role "${role.name}"`);
    return {
      rawToken,
      record: rowToToken(result.rows[0], role)
    };
  }

  async findByHash(tokenHash: string): Promise<ApiTokenRecord | undefined> {
    const result = await this.db.query<TokenRow>(
      `SELECT * FROM api_tokens WHERE token_hash = $1 LIMIT 1`,
      [tokenHash]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const role = await this.roles.findById(toNumber(row.role_id));
    if (!role) return undefined;
    return rowToToken(row, role);
  }

  async findByName(name: string): Promise<ApiTokenRecord | undefined> {
    const result = await this.db.query<TokenRow>(
      `SELECT * FROM api_tokens WHERE name = $1 LIMIT 1`,
      [name]
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const role = await this.roles.findById(toNumber(row.role_id));
    if (!role) return undefined;
    return rowToToken(row, role);
  }

  async touchLastUsed(id: number, now: number): Promise<void> {
    await this.db.query(
      `UPDATE api_tokens SET last_used_at = $1 WHERE id = $2`,
      [now, id]
    );
  }

  async revoke(name: string): Promise<boolean> {
    const token = await this.findByName(name);
    if (!token || token.revokedAt !== null) return false;
    await this.db.query(`UPDATE api_tokens SET revoked_at = $1 WHERE id = $2`, [
      Math.floor(Date.now() / 1000),
      token.id
    ]);
    logger.info(`Revoked token "${name}"`);
    return true;
  }

  async list(): Promise<ApiTokenRecord[]> {
    const result = await this.db.query<TokenRow>(
      `SELECT * FROM api_tokens ORDER BY created_at`
    );
    const tokens: ApiTokenRecord[] = [];
    for (const row of result.rows) {
      const role = await this.roles.findById(toNumber(row.role_id));
      if (role) {
        tokens.push(rowToToken(row, role));
      }
    }
    return tokens;
  }
}

let tokenRepoInstance: TokenRepository | null = null;

export function getTokenRepository(): TokenRepository {
  if (!tokenRepoInstance) {
    tokenRepoInstance = new TokenRepository();
  }
  return tokenRepoInstance;
}

export function resetTokenRepository(): void {
  tokenRepoInstance = null;
}
