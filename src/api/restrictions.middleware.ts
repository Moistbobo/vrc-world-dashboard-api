import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import Config from '../config';

export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

export function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcard = escaped.replace(/\*/g, '[^/]*');
  return new RegExp(`^${withWildcard}$`, 'i');
}

export function matchesAllowedOrigin(origin: string, allowed: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedAllowed = normalizeOrigin(allowed);

  if (normalizedAllowed.includes('*')) {
    return wildcardToRegex(normalizedAllowed).test(normalizedOrigin);
  }

  return normalizedOrigin === normalizedAllowed;
}

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (Config.API_ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  return Config.API_ALLOWED_ORIGINS.some((allowed) =>
    matchesAllowedOrigin(origin, allowed)
  );
}

export function areApiRestrictionsDisabled(): boolean {
  return Config.DISABLE_API_RESTRICTIONS === true;
}

export function isAllowedIp(ip: string | undefined): boolean {
  if (Config.API_ALLOWED_IPS.length === 0) return true;
  if (!ip) return false;
  return Config.API_ALLOWED_IPS.includes(ip);
}

// Origin + IP validation (skip health endpoint so monitoring can still ping it).
@Injectable()
export class RestrictionsMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    if (request.path === '/api/health') return next();

    const restrictionsDisabled = areApiRestrictionsDisabled();
    const hasOriginRules =
      !restrictionsDisabled && Config.API_ALLOWED_ORIGINS.length > 0;
    const hasIpRules =
      !restrictionsDisabled && Config.API_ALLOWED_IPS.length > 0;

    // Nothing configured; let auth handle access control.
    if (!hasOriginRules && !hasIpRules) return next();

    const originOk = hasOriginRules && isAllowedOrigin(request.headers.origin);
    const ipOk = hasIpRules && isAllowedIp(request.ip);

    // Request must satisfy at least one configured restriction.
    if (!originOk && !ipOk) {
      response.status(403).send({ error: 'Forbidden' });
      return;
    }
    next();
  }
}
