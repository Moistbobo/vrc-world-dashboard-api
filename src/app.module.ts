import { Module } from '@nestjs/common';
import { DatabaseModule } from './api/database.module';
import { RepositoriesModule } from './api/repositories.module';
import { ObservabilityModule } from './api/observability.module';
import { AuthModule } from './api/auth/auth.module';
import { HealthModule } from './api/health/health.module';
import { MeModule } from './api/me/me.module';
import { WorldsModule } from './api/worlds/worlds.module';
import { TagsModule } from './api/tags/tags.module';
import { FlagsModule } from './api/flags/flags.module';
import { MetaModule } from './api/meta/meta.module';
import { BootstrapService } from './api/bootstrap.service';

@Module({
  imports: [
    DatabaseModule,
    RepositoriesModule,
    ObservabilityModule,
    AuthModule,
    HealthModule,
    MeModule,
    WorldsModule,
    TagsModule,
    FlagsModule,
    MetaModule
  ],
  providers: [BootstrapService]
})
export class AppModule {}
