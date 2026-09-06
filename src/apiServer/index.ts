import express, { Express, NextFunction, Request, Response } from 'express';
import Config from '../config';
import healthRoute from './routes/health';
import worldsRoute from './routes/worlds';
import tagsRoute from './routes/tags';
import flagsRoute from './routes/flags';
import metaRoute from './routes/meta';
import worldsMutationsRoute from './routes/worldsMutations';
import meRoute from './routes/me';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authMiddleware } from './middleware/auth';
import { accessLogMiddleware } from './middleware/accessLog';

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

function wildcardToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcard = escaped.replace(/\*/g, '[^/]*');
  return new RegExp(`^${withWildcard}$`, 'i');
}

function matchesAllowedOrigin(origin: string, allowed: string): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const normalizedAllowed = normalizeOrigin(allowed);

  if (normalizedAllowed.includes('*')) {
    return wildcardToRegex(normalizedAllowed).test(normalizedOrigin);
  }

  return normalizedOrigin === normalizedAllowed;
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (Config.API_ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return false;
  return Config.API_ALLOWED_ORIGINS.some((allowed) =>
    matchesAllowedOrigin(origin, allowed)
  );
}

function areApiRestrictionsDisabled(): boolean {
  return Config.DISABLE_API_RESTRICTIONS === true;
}

function isAllowedIp(ip: string | undefined): boolean {
  if (Config.API_ALLOWED_IPS.length === 0) return true;
  if (!ip) return false;
  return Config.API_ALLOWED_IPS.includes(ip);
}

// Origin + IP validation (skip health endpoint so monitoring can still ping it).
function restrictionsMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
) {
  if (request.path === '/api/health') return next();

  const restrictionsDisabled = areApiRestrictionsDisabled();
  const hasOriginRules =
    !restrictionsDisabled && Config.API_ALLOWED_ORIGINS.length > 0;
  const hasIpRules = !restrictionsDisabled && Config.API_ALLOWED_IPS.length > 0;

  // Nothing configured; let auth handle access control.
  if (!hasOriginRules && !hasIpRules) return next();

  const originOk = hasOriginRules && isAllowedOrigin(request.headers.origin);
  const ipOk = hasIpRules && isAllowedIp(request.ip);

  // Request must satisfy at least one configured restriction.
  if (!originOk && !ipOk) {
    return response.status(403).send({ error: 'Forbidden' });
  }
  return next();
}

export function createApiServer(): Express {
  const app = express();
  app.use(express.json());

  // Trust loopback reverse proxies (Caddy/Nginx on the same host) when IP
  // allowlisting is enabled so request.ip reflects the real client IP.
  if (Config.API_ALLOWED_IPS.length > 0) {
    app.set('trust proxy', ['127.0.0.1/32', '::1/128']);
  }

  // CORS: allow configured origins, or fall back to wildcard for backwards compatibility.
  // Patterns may contain '*' as a wildcard for one path/domain segment.
  const restrictionsDisabled = areApiRestrictionsDisabled();
  app.use((request, response, next) => {
    const origin = request.headers.origin;
    if (!origin) return next();

    const allowed = restrictionsDisabled || isAllowedOrigin(origin);
    if (allowed) {
      response.setHeader('Access-Control-Allow-Origin', origin);
    }
    response.setHeader('Vary', 'Origin');
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,DELETE,OPTIONS'
    );
    response.setHeader(
      'Access-Control-Allow-Headers',
      'authorization,content-type'
    );
    if (request.method === 'OPTIONS') {
      return response.status(204).end();
    }
    return next();
  });

  app.use(restrictionsMiddleware);
  app.use(accessLogMiddleware);
  app.use(authMiddleware);

  // Routes
  app.use(healthRoute);
  app.use(worldsRoute);
  app.use(worldsMutationsRoute);
  app.use(meRoute);
  app.use(tagsRoute);
  app.use(flagsRoute);
  app.use(metaRoute);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
