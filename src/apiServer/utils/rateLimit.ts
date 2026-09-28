import Config from '../../config';

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

export function checkRateLimit(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSeconds: number } {
  const limit = Config.WORLDS_QUERY_RATE_LIMIT ?? 120;
  const windowMs = Config.WORLDS_QUERY_RATE_WINDOW_MS ?? 60000;

  if (limit <= 0) return { allowed: true, retryAfterSeconds: 0 };

  const entry = windows.get(key);
  if (!entry || now >= entry.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (entry.count < limit) {
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
  };
}

export function resetRateLimits(): void {
  windows.clear();
}
