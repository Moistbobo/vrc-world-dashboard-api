import type { Request } from 'express';
import type { ApiTokenRecord } from '../../db/tokenRepository';

export interface TokenRequest extends Request {
  token?: ApiTokenRecord;
}
