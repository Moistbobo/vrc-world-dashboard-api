import Config from './config';
import logger, { flushLogs } from './logger';
import { createApiServer } from './apiServer';
import { runMigrations } from './db/schema';
import { getQueryable } from './db/pool';
import { getTagRepository } from './db/tagRepository';
import { setTaxonomy } from './tags/extractor';
import { ensureAuthenticated } from './vrchat/client';

async function main() {
  try {
    await runMigrations(getQueryable());
  } catch (error) {
    logger.error('Failed to run database migrations:', error);
    process.exit(1);
  }

  try {
    const canonicalTags = await getTagRepository().getAll();
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
    const currentUser = await ensureAuthenticated();
    logger.info(`Authenticated with VRChat as ${currentUser.displayName}`);
  } catch (error) {
    logger.error('Failed to authenticate with VRChat:', error);
    process.exit(1);
  }

  const app = createApiServer();
  try {
    await new Promise<void>((resolve, reject) => {
      const server = app.listen(Config.API_PORT, Config.API_HOST);
      server.once('listening', resolve);
      server.once('error', reject);
    });
    logger.info(
      `API server listening on http://${Config.API_HOST}:${Config.API_PORT}`
    );
  } catch (error) {
    logger.error('Failed to start API server:', error);
    process.exit(1);
  }
}

void main();

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, flushing logs and shutting down`);
  await flushLogs();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
