import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * Registers the two global guards in order. AuthGuard authenticates the token
 * (and skips @Public routes); PermissionsGuard enforces @RequirePermission.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard }
  ]
})
export class AuthModule {}
