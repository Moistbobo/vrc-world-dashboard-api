import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'api:isPublic';

/** Marks a route as reachable without a bearer token (e.g. /api/health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
