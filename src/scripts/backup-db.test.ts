import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile, type ChildProcess } from 'node:child_process';
import { createBackup } from './backup-db';

jest.mock('node:child_process', () => ({
  execFile: jest.fn()
}));

const mockExecFile = jest.mocked(execFile);

const DATABASE_URL = 'postgres://user:pass@localhost:5432/worlds';

describe('createBackup', () => {
  const now = new Date(2026, 7, 15, 12, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    mockExecFile.mockReset();
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(null, '', '');
      return {} as ChildProcess;
    });
  });

  test('invokes pg_dump with a custom-format archive under the backup dir', async () => {
    const backupDir = path.join(tmpDir, 'backups-1');

    const result = await createBackup({
      databaseUrl: DATABASE_URL,
      backupDir,
      retentionDays: 14,
      now
    });

    const expectedFile = path.join(backupDir, 'worlds-2026-08-15-120000.dump');
    expect(result).toEqual({ file: expectedFile, kept: 0, pruned: 0 });
    expect(mockExecFile).toHaveBeenCalledWith(
      'pg_dump',
      [`--file=${expectedFile}`, '--format=custom', DATABASE_URL],
      expect.objectContaining({ maxBuffer: expect.any(Number) }),
      expect.any(Function)
    );
  });

  test('prunes expired .dump backups and keeps fresh ones', async () => {
    const backupDir = path.join(tmpDir, 'backups-2');
    fs.mkdirSync(backupDir, { recursive: true });

    const oldFile = path.join(backupDir, 'worlds-2026-07-01-000000.dump');
    const freshFile = path.join(backupDir, 'worlds-2026-08-10-000000.dump');
    const strayFile = path.join(backupDir, 'notes.txt');
    fs.writeFileSync(oldFile, 'stale');
    fs.writeFileSync(freshFile, 'recent');
    fs.writeFileSync(strayFile, 'not a backup');
    const oldMtime = new Date(now.getTime() - 15 * dayMs);
    fs.utimesSync(oldFile, oldMtime, oldMtime);
    const freshMtime = new Date(now.getTime() - dayMs);
    fs.utimesSync(freshFile, freshMtime, freshMtime);

    const result = await createBackup({
      databaseUrl: DATABASE_URL,
      backupDir,
      retentionDays: 14,
      now
    });

    expect(result.file).toBe(
      path.join(backupDir, 'worlds-2026-08-15-120000.dump')
    );
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
    expect(fs.existsSync(strayFile)).toBe(true);
    expect(result.pruned).toBe(1);
    expect(result.kept).toBe(1);
  });

  test('surfaces pg_dump stderr when the dump fails', async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, cb) => {
      cb(
        new Error('exit code 1'),
        '',
        'pg_dump: error: connection to server at "localhost" failed'
      );
      return {} as ChildProcess;
    });

    await expect(
      createBackup({
        databaseUrl: DATABASE_URL,
        backupDir: path.join(tmpDir, 'backups-3'),
        retentionDays: 14,
        now
      })
    ).rejects.toThrow(/pg_dump failed: pg_dump: error:/);
  });
});
