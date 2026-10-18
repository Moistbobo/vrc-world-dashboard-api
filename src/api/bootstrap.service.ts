import {
  Inject,
  Injectable,
  type OnApplicationBootstrap
} from '@nestjs/common';
import { runMigrations } from '../db/schema';
import { TagRepository } from '../db/tagRepository';
import { FlagRepository } from '../db/flagRepository';
import { setTaxonomy } from '../tags/extractor';
import { setFlagTaxonomy } from '../flags/taxonomy';
import { ensureAuthenticated } from '../vrchat/client';
import logger from '../logger';
import { QUERYABLE } from './database.module';
import type { Queryable } from '../db/client';

/**
 * Non-HTTP startup work, moved from the old `src/index.ts` main(). A failure in
 * any step exits the process: a half-initialised server must not listen.
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  constructor(
    @Inject(QUERYABLE) private readonly db: Queryable,
    private readonly tags: TagRepository,
    private readonly flags: FlagRepository
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await runMigrations(this.db);
    } catch (error) {
      logger.error('Failed to run database migrations:', error);
      process.exit(1);
    }

    try {
      const canonicalTags = await this.tags.getAll();
      if (canonicalTags.length === 0) {
        throw new Error('tags table is empty after migrations');
      }
      setTaxonomy(canonicalTags.map((t) => t.tag));
      logger.info(
        `Loaded ${canonicalTags.length} canonical tags from the tags table`
      );
    } catch (error) {
      logger.error('Failed to load canonical tags:', error);
      process.exit(1);
    }

    try {
      const catalogFlags = await this.flags.getAll();
      setFlagTaxonomy(catalogFlags);
      logger.info(`Loaded ${catalogFlags.length} flags from the flags table`);
    } catch (error) {
      logger.error('Failed to load flags:', error);
      process.exit(1);
    }

    try {
      const currentUser = await ensureAuthenticated();
      logger.info(`Authenticated with VRChat as ${currentUser.displayName}`);
    } catch (error) {
      logger.error('Failed to authenticate with VRChat:', error);
      process.exit(1);
    }
  }
}
