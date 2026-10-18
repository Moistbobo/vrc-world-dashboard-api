import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { CorsMiddleware } from './cors.middleware';
import { RestrictionsMiddleware } from './restrictions.middleware';
import { AccessLogMiddleware } from './access-log.middleware';

/**
 * Global HTTP middleware, applied in the same order as the pre-migration
 * Express stack: CORS -> restrictions -> access log, before auth guards.
 * Kept as Express middleware (not interceptors) so abort/finish hooks and
 * response headers behave exactly as before (decision 3.4/3.5).
 */
@Module({})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorsMiddleware, RestrictionsMiddleware, AccessLogMiddleware)
      .forRoutes('{*splat}');
  }
}
