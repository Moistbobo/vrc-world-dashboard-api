import type { NextFunction, Request, Response } from 'express';
import logger from '../../logger';
import { hashIp } from '../utils/ipHash';

export function accessLogMiddleware(
  request: Request,
  response: Response,
  next: NextFunction
): void {
  const startedAt = process.hrtime.bigint();
  const ip = hashIp(request.ip);

  const log = (status: number) => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    logger.info(
      {
        method: request.method,
        url: request.originalUrl,
        status,
        duration_ms: durationMs,
        ip
      },
      `HTTP ${request.method} ${request.originalUrl} ${status} ${durationMs.toFixed(2)}ms`
    );
  };

  response.on('finish', () => {
    log(response.statusCode);
  });

  response.on('close', () => {
    if (!response.writableEnded) {
      log(0);
    }
  });

  next();
}
