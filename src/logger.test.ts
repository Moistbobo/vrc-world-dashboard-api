import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const { axiomMock, ingestMock } = vi.hoisted(() => {
  const ingest = vi.fn();
  const flush = vi.fn().mockResolvedValue(undefined);
  const Axiom = vi.fn(function (this: unknown) {
    return { ingest, flush };
  });
  return { axiomMock: Axiom, ingestMock: ingest };
});

vi.mock('@axiomhq/js', () => ({ Axiom: axiomMock }));

let logPath: string;

beforeEach(() => {
  vi.resetModules();
  logPath = join(mkdtempSync(join(tmpdir(), 'logger-test-')), 'tslog-test.log');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  axiomMock.mockClear();
  ingestMock.mockClear();
  rmSync(join(logPath, '..'), { recursive: true, force: true });
});

it('writes no log file while running under vitest', async () => {
  vi.stubEnv('LOG_FILE', logPath);
  const { logger } = await import('./logger.js');

  logger.info('this must not reach disk');
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(existsSync(logPath)).toBe(false);
});

it('writes to LOG_FILE outside the test environment', async () => {
  vi.stubEnv('VITEST', '');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('LOG_FILE', logPath);
  const { logger } = await import('./logger.js');

  logger.info('this reaches disk');
  await vi.waitFor(() => expect(existsSync(logPath)).toBe(true));
});

it('does not construct Axiom without a token and dataset', async () => {
  vi.stubEnv('AXIOM_TOKEN', '');
  vi.stubEnv('AXIOM_DATASET', '');
  const { logger } = await import('./logger.js');

  logger.info('local only');

  expect(axiomMock).not.toHaveBeenCalled();
});

it('ships logs to Axiom when a token and dataset are set', async () => {
  vi.stubEnv('AXIOM_TOKEN', 'test-token');
  vi.stubEnv('AXIOM_DATASET', 'test-dataset');
  const { logger } = await import('./logger.js');

  logger.info('ship me');

  expect(axiomMock).toHaveBeenCalledTimes(1);
  expect(axiomMock).toHaveBeenCalledWith(
    expect.objectContaining({ token: 'test-token' })
  );
  expect(ingestMock).toHaveBeenCalledWith(
    'test-dataset',
    expect.objectContaining({ _time: expect.any(String) }),
    { timestampField: '_time' }
  );
});
