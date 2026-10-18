import type { LoggerService, LogLevel } from '@nestjs/common';
import logger from '../logger';

/**
 * Routes Nest's own framework logs into the project tslog instance so Axiom
 * ingest and gzip file rotation are preserved (decision d008).
 */
export class TslogNestLogger implements LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): void {
    logger.info(message, ...optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    logger.error(message, ...optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    logger.warn(message, ...optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    logger.debug(message, ...optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    logger.trace(message, ...optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    logger.fatal(message, ...optionalParams);
  }

  setLogLevels(_levels: LogLevel[]): void {
    // Levels are owned by tslog via Config.LOG_LEVEL.
  }
}
