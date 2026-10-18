import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException
} from '@nestjs/common';
import type { Request, Response } from 'express';
import logger from '../../logger';

const FRAMEWORK_ROUTE_MISS =
  /^Cannot (GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD) /;

function resolveStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  const status = (exception as { statusCode?: unknown })?.statusCode;
  return typeof status === 'number' ? status : 500;
}

function resolveMessage(exception: unknown, statusCode: number): string {
  if (exception instanceof HttpException) {
    const message = exception.message;
    if (FRAMEWORK_ROUTE_MISS.test(message)) return 'Not Found';
    return message || 'Unknown error';
  }

  if (statusCode >= 500) return 'Internal Server Error';

  if (exception instanceof Error) {
    return exception.message || 'Unknown error';
  }
  return 'Unknown error';
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const statusCode = resolveStatusCode(exception);

    // Unhandled failures are logged; deliberate HttpExceptions (the old routes
    // answered these directly) were never logged by errorHandler.
    if (statusCode >= 500 && !(exception instanceof HttpException)) {
      logger.error(
        `API error [${statusCode}] ${request.method} ${request.originalUrl}:`
      );
      logger.error(exception);
    }

    response.status(statusCode).send({
      error: resolveMessage(exception, statusCode)
    });
  }
}
