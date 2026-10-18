import type { INestApplication } from '@nestjs/common';
import Config from '../config';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { ApiValidationPipe } from './http/validation.pipe';

/**
 * Applies the global, transport-level configuration shared by the real server
 * (`src/main.ts`) and the test bootstrap (`test/create-test-app.ts`) so tests
 * exercise the same pipeline as production.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');

  // Trust loopback reverse proxies (Caddy/Nginx on the same host) when IP
  // allowlisting is enabled so request.ip reflects the real client IP.
  if (Config.API_ALLOWED_IPS.length > 0) {
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', ['127.0.0.1/32', '::1/128']);
  }

  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalPipes(new ApiValidationPipe());
}
