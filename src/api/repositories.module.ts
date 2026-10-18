import { Global, Module } from '@nestjs/common';
import type { Queryable } from '../db/client';
import { WorldRepository } from '../db/worldRepository';
import { TagRepository } from '../db/tagRepository';
import { FlagRepository } from '../db/flagRepository';
import { HighPriorityRepository } from '../db/highPriorityRepository';
import { TokenRepository } from '../db/tokenRepository';
import { DatabaseModule, QUERYABLE } from './database.module';

/**
 * Repository classes as Nest providers built from the shared QUERYABLE.
 * The module-level singleton getters (`getWorldRepository()` etc.) remain for
 * the CLI and scripts; both paths read the same connection pool (decision d009).
 */
@Global()
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: WorldRepository,
      useFactory: (db: Queryable) => new WorldRepository(db),
      inject: [QUERYABLE]
    },
    {
      provide: TagRepository,
      useFactory: (db: Queryable) => new TagRepository(db),
      inject: [QUERYABLE]
    },
    {
      provide: FlagRepository,
      useFactory: (db: Queryable) => new FlagRepository(db),
      inject: [QUERYABLE]
    },
    {
      provide: HighPriorityRepository,
      useFactory: (db: Queryable) => new HighPriorityRepository(db),
      inject: [QUERYABLE]
    },
    {
      provide: TokenRepository,
      useFactory: (db: Queryable) => new TokenRepository(db),
      inject: [QUERYABLE]
    }
  ],
  exports: [
    WorldRepository,
    TagRepository,
    FlagRepository,
    HighPriorityRepository,
    TokenRepository
  ]
})
export class RepositoriesModule {}
