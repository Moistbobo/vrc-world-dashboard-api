import { Controller, Get } from '@nestjs/common';
import type { Permission } from '../../auth/permissions';
import type { ApiTokenRecord } from '../../db/tokenRepository';
import { CurrentToken } from '../auth/current-token.decorator';

@Controller('me')
export class MeController {
  @Get()
  getMe(@CurrentToken() token: ApiTokenRecord): {
    name: string;
    role: string;
    permissions: Permission[];
  } {
    return {
      name: token.name,
      role: token.role.name,
      permissions: token.role.permissions
    };
  }
}
