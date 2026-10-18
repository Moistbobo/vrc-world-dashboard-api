import { Module } from '@nestjs/common';
import { WorldsController } from './worlds.controller';
import { WorldsMutationsController } from './worlds-mutations.controller';

@Module({
  controllers: [WorldsController, WorldsMutationsController]
})
export class WorldsModule {}
