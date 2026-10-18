import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  areApiRestrictionsDisabled,
  isAllowedOrigin
} from './restrictions.middleware';

// CORS: allow configured origins, or fall back to wildcard for backwards
// compatibility. Patterns may contain '*' as a wildcard for one path/domain
// segment; `enableCors()` cannot express that, hence a custom middleware.
@Injectable()
export class CorsMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const origin = request.headers.origin;
    if (!origin) return next();

    const allowed = areApiRestrictionsDisabled() || isAllowedOrigin(origin);
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
      response.status(204).end();
      return;
    }
    next();
  }
}
