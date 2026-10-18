import { SetMetadata } from '@nestjs/common';
import type { Permission } from '../../auth/permissions';

export const PERMISSION_KEY = 'api:requiredPermission';

/** Requires the authenticated token's role to include `permission`. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);
