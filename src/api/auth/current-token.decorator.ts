import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { ApiTokenRecord } from '../../db/tokenRepository';
import type { TokenRequest } from './token-request';

/** Injects the token record the AuthGuard attached to the request. */
export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiTokenRecord => {
    const request = ctx.switchToHttp().getRequest<TokenRequest>();
    return request.token as ApiTokenRecord;
  }
);
