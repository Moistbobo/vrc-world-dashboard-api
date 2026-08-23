export const PERMISSIONS = [
  'worlds:read',
  'worlds:write',
  'tags:read',
  'tags:write',
  'meta:read'
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export function parsePermissions(values: string[]): Permission[] {
  const seen = new Set<Permission>();
  const unique: Permission[] = [];
  for (const value of values) {
    if (!isPermission(value)) {
      throw new Error(
        `Unknown permission "${value}". Valid permissions: ${PERMISSIONS.join(', ')}`
      );
    }
    if (!seen.has(value)) {
      seen.add(value);
      unique.push(value);
    }
  }
  return unique;
}
