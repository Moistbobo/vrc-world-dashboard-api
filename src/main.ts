import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import Config from './config';
import logger, { flushLogs } from './logger';
import { TslogNestLogger } from './logging/tslog-nest-logger';
import { configureApp } from './api/configure-app';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: new TslogNestLogger()
  });
  configureApp(app);

  try {
    await app.listen(Config.API_PORT, Config.API_HOST);
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
