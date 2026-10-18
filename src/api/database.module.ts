import { Global, Module } from '@nestjs/common';
import { getQueryable } from '../db/pool';
import type { Queryable } from '../db/client';

/**
 * The single database surface exposed to Nest. Non-HTTP callers (CLI,
 * maintenance scripts) keep using `getQueryable()` directly (decision d009).
 */
export const QUERYABLE = Symbol('QUERYABLE');

@Global()
@Module({
  providers: [
    {
      provide: QUERYABLE,
      useFactory: (): Queryable => getQueryable()
    }
  ],
  exports: [QUERYABLE]
})
export class DatabaseModule {}
