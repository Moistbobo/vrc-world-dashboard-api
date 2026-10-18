const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    WORLDS_QUERY_RATE_LIMIT: 2,
    WORLDS_QUERY_RATE_WINDOW_MS: 1000
  } as Record<string, unknown>
}));

vi.mock('../../config', () => ({
  __esModule: true,
  default: mockConfig
}));

import { checkRateLimit, resetRateLimits } from './rateLimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    resetRateLimits();
    mockConfig.WORLDS_QUERY_RATE_LIMIT = 2;
    mockConfig.WORLDS_QUERY_RATE_WINDOW_MS = 1000;
  });

  it('allows up to the limit then denies with retryAfterSeconds', () => {
    expect(checkRateLimit('token:1', 0)).toEqual({
      allowed: true,
      retryAfterSeconds: 0
    });
    expect(checkRateLimit('token:1', 0)).toEqual({
      allowed: true,
      retryAfterSeconds: 0
    });
    expect(checkRateLimit('token:1', 0)).toEqual({
      allowed: false,
      retryAfterSeconds: 1
    });
  });

  it('resets the window once resetAt passes', () => {
    checkRateLimit('token:1', 0);
    checkRateLimit('token:1', 0);
    expect(checkRateLimit('token:1', 0).allowed).toBe(false);

    expect(checkRateLimit('token:1', 1001)).toEqual({
      allowed: true,
      retryAfterSeconds: 0
    });
  });

  it('computes Retry-After as seconds until the window resets', () => {
    mockConfig.WORLDS_QUERY_RATE_LIMIT = 1;
    mockConfig.WORLDS_QUERY_RATE_WINDOW_MS = 5000;

    expect(checkRateLimit('token:2', 1000).allowed).toBe(true);
    expect(checkRateLimit('token:2', 1000)).toEqual({
      allowed: false,
      retryAfterSeconds: 5
    });
    expect(checkRateLimit('token:2', 3000)).toEqual({
      allowed: false,
      retryAfterSeconds: 3
    });
  });

  it('keeps keys independent', () => {
    mockConfig.WORLDS_QUERY_RATE_LIMIT = 1;
    expect(checkRateLimit('token:1', 0).allowed).toBe(true);
    expect(checkRateLimit('token:1', 0).allowed).toBe(false);
    expect(checkRateLimit('token:2', 0).allowed).toBe(true);
  });

  it('disables when the limit is zero or negative', () => {
    for (const limit of [0, -5]) {
      resetRateLimits();
      mockConfig.WORLDS_QUERY_RATE_LIMIT = limit;
      for (let i = 0; i < 10; i += 1) {
        expect(checkRateLimit('token:1', 0)).toEqual({
          allowed: true,
          retryAfterSeconds: 0
        });
      }
    }
  });
});
