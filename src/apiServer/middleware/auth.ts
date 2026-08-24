import type { NextFunction, Request, Response } from 'express';
import {
  getTokenRepository,
  hashToken,
  type ApiTokenRecord
} from '../../db/tokenRepository';
import type { Permission } from '../../auth/permissions';
import logger from '../../logger';
import { hashIp } from '../utils/ipHash';

export interface TokenRequest extends Request {
  token?: ApiTokenRecord;
}

const TOUCH_INTERVAL_SECONDS = 60;

export function authMiddleware(
  request: TokenRequest,
  response: Response,
  next: NextFunction
): void {
  if (request.path === '/api/health') {
    logger.debug(`Auth: public endpoint, no token required`);
    return next();
  }

  const auth = request.headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
    logger.warn(
      `Auth: missing or malformed Authorization header from ${hashIp(request.ip)}`
    );
    response.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const token = auth.slice(7).trim();
  const record = getTokenRepository().findByHash(hashToken(token));
  if (!record || record.revokedAt !== null) {
    logger.warn(
      `Auth: rejected token (${record ? 'revoked' : 'unknown'}) for ${request.method} ${request.originalUrl} from ${hashIp(request.ip)}`
    );
    response.status(401).send({ error: 'Unauthorized' });
    return;
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
    getTokenRepository().touchLastUsed(record.id, now);
    record.lastUsedAt = now;
  }

  next();
}

export function requirePermission(permission: Permission) {
  return (
    request: TokenRequest,
    response: Response,
    next: NextFunction
  ): void => {
    const token = request.token;
    if (!token || !token.role.permissions.includes(permission)) {
      logger.warn(
        `Auth: denied permission "${permission}" for token "${token?.name ?? 'none'}" (role ${token?.role.name ?? 'none'}) on ${request.method} ${request.originalUrl} from ${hashIp(request.ip)}`
      );
      response.status(403).send({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
