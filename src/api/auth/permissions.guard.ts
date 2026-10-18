import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '../../auth/permissions';
import logger from '../../logger';
import { hashIp } from '../utils/ipHash';
import { PERMISSION_KEY } from './require-permission.decorator';
import type { TokenRequest } from './token-request';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()]
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<TokenRequest>();
    const token = request.token;
    if (!token || !token.role.permissions.includes(required)) {
      logger.warn(
        `Auth: denied permission "${required}" for token "${token?.name ?? 'none'}" (role ${token?.role.name ?? 'none'}) on ${request.method} ${request.originalUrl} from ${hashIp(request.ip)}`
      );
      throw new ForbiddenException('Forbidden');
    }
    return true;
  }
}
