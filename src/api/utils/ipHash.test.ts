import { createIpHasher, hashIp } from './ipHash';

describe('hashIp', () => {
  const fixedHasher = createIpHasher('test-secret');

  it('returns a stable 16-char hex hash for a fixed secret', () => {
    expect(fixedHasher('203.0.113.7')).toBe(fixedHasher('203.0.113.7'));
    expect(fixedHasher('203.0.113.7')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces different hashes for different IPs', () => {
    expect(fixedHasher('203.0.113.7')).not.toBe(fixedHasher('198.51.100.9'));
  });

  it('never leaks the raw IP', () => {
    expect(fixedHasher('192.168.1.1')).not.toContain('192.168.1.1');
  });

  it('returns "unknown" when no IP is present', () => {
    expect(fixedHasher(undefined)).toBe('unknown');
  });

  it('uses a fresh random secret when none is configured', () => {
    expect(createIpHasher()('10.0.0.5')).not.toBe(createIpHasher()('10.0.0.5'));
  });

  it('hashing the same IP twice is stable for the default export', () => {
    expect(hashIp('198.51.100.9')).toBe(hashIp('198.51.100.9'));
    expect(hashIp('198.51.100.9')).not.toContain('198.51.100.9');
  });
});
