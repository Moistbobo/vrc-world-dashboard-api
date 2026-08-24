import type { Queryable } from './client';
import { getQueryable } from './pool';
import { toNumber } from './mappers';
import { parsePermissions, type Permission } from '../auth/permissions';
import logger from '../logger';

export interface RoleRecord {
  id: number;
  name: string;
  permissions: Permission[];
  createdAt: number;
}

interface RoleRow extends Record<string, unknown> {
  id: bigint | number;
  name: string;
  permissions: string[];
  created_at: bigint | number;
}

function rowToRole(row: RoleRow): RoleRecord {
  return {
    id: toNumber(row.id),
    name: row.name,
    permissions: parsePermissions(row.permissions),
    createdAt: toNumber(row.created_at)
  };
}

export class RoleRepository {
  private db: Queryable;

  constructor(db?: Queryable) {
    this.db = db ?? getQueryable();
  }

  async create(name: string, permissions: Permission[]): Promise<RoleRecord> {
    const exists = await this.findByName(name);
    if (exists) {
      throw new Error(`Role "${name}" already exists`);
    }

    const validated = parsePermissions(permissions);
    const result = await this.db.query<RoleRow>(
      `INSERT INTO roles (name, permissions) VALUES ($1, $2::text[])
       RETURNING id, name, permissions, created_at`,
      [name, validated]
    );
    const created = rowToRole(result.rows[0]);
    logger.info(
      `Created role "${name}" with permissions [${validated.join(', ')}]`
    );
    return created;
  }

  async updatePermissions(
    name: string,
    add: Permission[],
    remove: Permission[]
  ): Promise<RoleRecord | undefined> {
    const role = await this.findByName(name);
    if (!role) return undefined;

    const validatedAdd = parsePermissions(add);
    const validatedRemove = parsePermissions(remove);
    const existing = new Set(role.permissions);
    for (const permission of validatedAdd) existing.add(permission);
    for (const permission of validatedRemove) existing.delete(permission);
    const permissions = [...existing];

    await this.db.query(
      `UPDATE roles SET permissions = $1::text[] WHERE name = $2`,
      [permissions, name]
    );
    logger.info(
      `Updated role "${name}" permissions to [${permissions.join(', ')}]`
    );
    return { ...role, permissions };
  }

  async findByName(name: string): Promise<RoleRecord | undefined> {
    const result = await this.db.query<RoleRow>(
      `SELECT * FROM roles WHERE name = $1 LIMIT 1`,
      [name]
    );
    return result.rows[0] ? rowToRole(result.rows[0]) : undefined;
  }

  async findById(id: number): Promise<RoleRecord | undefined> {
    const result = await this.db.query<RoleRow>(
      `SELECT * FROM roles WHERE id = $1 LIMIT 1`,
      [id]
    );
    return result.rows[0] ? rowToRole(result.rows[0]) : undefined;
  }

  async list(): Promise<RoleRecord[]> {
    const result = await this.db.query<RoleRow>(
      `SELECT * FROM roles ORDER BY name`
    );
    return result.rows.map(rowToRole);
  }
}

let roleRepoInstance: RoleRepository | null = null;

export function getRoleRepository(): RoleRepository {
  if (!roleRepoInstance) {
    roleRepoInstance = new RoleRepository();
  }
  return roleRepoInstance;
}

export function resetRoleRepository(): void {
  roleRepoInstance = null;
}
