import { Controller, Get } from '@nestjs/common';
import { WorldRepository } from '../../db/worldRepository';
import type { ApiTokenRecord } from '../../db/tokenRepository';
import { CurrentToken } from '../auth/current-token.decorator';
import { RequirePermission } from '../auth/require-permission.decorator';

@Controller('meta')
export class MetaController {
  constructor(private readonly worlds: WorldRepository) {}

  @Get()
  @RequirePermission('meta:read')
  async getMeta(@CurrentToken() token: ApiTokenRecord) {
    const canManage = token?.role.permissions.includes('worlds:write') ?? false;
    return this.worlds.getMetadataCounts({
      includeHighPriorityCount: canManage
    });
  }
}
