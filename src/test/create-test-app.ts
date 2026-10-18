import type { INestApplication } from '@nestjs/common';
import {
  Test,
  type TestingModule,
  type TestingModuleBuilder
} from '@nestjs/testing';
import { AppModule } from '../app.module';
import { configureApp } from '../api/configure-app';
import { BootstrapService } from '../api/bootstrap.service';
import { WorldRepository } from '../db/worldRepository';
import { TagRepository } from '../db/tagRepository';
import { FlagRepository } from '../db/flagRepository';
import { HighPriorityRepository } from '../db/highPriorityRepository';
import { TokenRepository } from '../db/tokenRepository';
import { QUERYABLE } from '../api/database.module';
import type { Queryable } from '../db/client';

/**
 * Provider overrides for `createTestApp`. Any repository left out keeps the
 * real implementation (used by the Postgres smoke test).
 */
export interface TestAppOverrides {
  worlds?: unknown;
  tags?: unknown;
  flags?: unknown;
  highPriority?: unknown;
  tokens?: unknown;
}

export interface TestApp {
  app: INestApplication;
  moduleRef: TestingModule;
}

function createStubQueryable(): Queryable {
  const queryable: Queryable = {
    query: async () => ({
      rows: [],
      rowCount: 0,
      command: '',
      oid: 0,
      fields: []
    }),
    withTransaction: async (fn) => fn(queryable)
  };
  return queryable;
}

/**
 * Boots the real AppModule (guards, middleware, exception filter, validation
 * pipe) for supertest. BootstrapService is neutralised: tests own their own
 * database/taxonomy setup.
 */
export async function createTestApp(
  overrides: TestAppOverrides = {}
): Promise<TestApp> {
  let builder: TestingModuleBuilder = Test.createTestingModule({
    imports: [AppModule]
  })
    .overrideProvider(BootstrapService)
    .useValue({ onApplicationBootstrap: async () => undefined });

  const hasOverrides = Object.values(overrides).some(Boolean);
  if (hasOverrides) {
    builder = builder
      .overrideProvider(QUERYABLE)
      .useValue(createStubQueryable());
  }

  if (overrides.worlds) {
    builder = builder
      .overrideProvider(WorldRepository)
      .useValue(overrides.worlds);
  }
  if (overrides.tags) {
    builder = builder.overrideProvider(TagRepository).useValue(overrides.tags);
  }
  if (overrides.flags) {
    builder = builder
      .overrideProvider(FlagRepository)
      .useValue(overrides.flags);
  }
  if (overrides.highPriority) {
    builder = builder
      .overrideProvider(HighPriorityRepository)
      .useValue(overrides.highPriority);
  }
  if (overrides.tokens) {
    builder = builder
      .overrideProvider(TokenRepository)
      .useValue(overrides.tokens);
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  // Listen once on an ephemeral port for the file's lifetime. If the server is
  // not listening, supertest opens and closes it around every request, which
  // intermittently collides on reused ports when files run in parallel.
  await app.listen(0);
  return { app, moduleRef };
}
