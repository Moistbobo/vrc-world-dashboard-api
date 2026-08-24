import type { NextFunction, Request, Response } from 'express';
import logger from '../../logger';
import { hashIp } from '../utils/ipHash';

export function accessLogMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction
): void {
  logger.info(
    `HTTP ${request.method} ${request.originalUrl} from ${hashIp(request.ip)}`
  );
  next();
}
