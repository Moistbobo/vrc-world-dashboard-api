import { createHmac, randomBytes } from 'crypto';

export type IpHasher = (ip: string | undefined) => string;

export function createIpHasher(secret?: string): IpHasher {
  const key = secret ? Buffer.from(secret, 'utf8') : randomBytes(32);
  return (ip: string | undefined): string => {
    if (!ip) return 'unknown';
    return createHmac('sha256', key).update(ip).digest('hex').slice(0, 16);
  };
}

export const hashIp: IpHasher = createIpHasher(process.env.LOG_IP_HASH_SECRET);
