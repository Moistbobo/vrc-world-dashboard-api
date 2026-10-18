import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hashToken, TokenRepository } from '../../db/tokenRepository';
import logger from '../../logger';
import { hashIp } from '../utils/ipHash';
import { IS_PUBLIC_KEY } from './public.decorator';
import type { TokenRequest } from './token-request';

const TOUCH_INTERVAL_SECONDS = 60;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const request = context.switchToHttp().getRequest<TokenRequest>();

    if (isPublic) {
      logger.debug(`Auth: public endpoint, no token required`);
      return true;
    }

    const auth = request.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      logger.warn(
        `Auth: missing or malformed Authorization header from ${hashIp(request.ip)}`
      );
      throw new UnauthorizedException('Unauthorized');
    }

    const token = auth.slice(7).trim();
    const record = await this.tokens.findByHash(hashToken(token));
    if (!record || record.revokedAt !== null) {
      logger.warn(
        `Auth: rejected token (${record ? 'revoked' : 'unknown'}) for ${request.method} ${request.originalUrl} from ${hashIp(request.ip)}`
      );
      throw new UnauthorizedException('Unauthorized');
    }

    request.token = record;
    logger.info(
      `Auth: authenticated token "${record.name}" (role ${record.role.name}) for ${request.method} ${request.originalUrl}`
    );

    const now = Math.floor(Date.now() / 1000);
    if (
      record.lastUsedAt === null ||
      now - record.lastUsedAt > TOUCH_INTERVAL_SECONDS
    ) {
      void this.tokens.touchLastUsed(record.id, now);
      record.lastUsedAt = now;
    }

    return true;
  }
}
