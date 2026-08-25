import fs from 'fs';
import path from 'path';
import { execFile } from 'node:child_process';
import Config from '../config';
import logger from '../logger';

interface BackupOptions {
  databaseUrl: string;
  backupDir: string;
  retentionDays: number;
  now?: Date;
}

const BACKUP_FILE = /^worlds-.*\.dump$/;

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

function formatTimestamp(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

// --file asks pg_dump to write the archive directly instead of piping stdout.
function runPgDump(filePath: string, databaseUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      'pg_dump',
      [`--file=${filePath}`, '--format=custom', databaseUrl],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`pg_dump failed: ${stderr || error.message}`));
          return;
        }
        resolve();
      }
    );
  });
}

export async function createBackup(
  options: BackupOptions
): Promise<{ file: string; kept: number; pruned: number }> {
  const { databaseUrl, backupDir, retentionDays } = options;
  const now = options.now ?? new Date();

  fs.mkdirSync(backupDir, { recursive: true });

  const filePath = path.join(backupDir, `worlds-${formatTimestamp(now)}.dump`);
  await runPgDump(filePath, databaseUrl);

  let kept = 0;
  let pruned = 0;
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(backupDir)) {
    if (!BACKUP_FILE.test(name)) continue;
    const candidatePath = path.join(backupDir, name);
    if (fs.statSync(candidatePath).mtime.getTime() < cutoffMs) {
      fs.unlinkSync(candidatePath);
      pruned++;
    } else {
      kept++;
    }
  }

  return { file: filePath, kept, pruned };
}

async function main() {
  const databaseUrl = Config.DATABASE_URL || process.argv[2];
  if (!databaseUrl) {
    logger.error(
      'Backup failed: DATABASE_URL is not set; set it or pass a connection string as an argument'
    );
    process.exitCode = 1;
    return;
  }
  const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : path.join(process.cwd(), 'backups');
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS) || 14;

  try {
    const result = await createBackup({
      databaseUrl,
      backupDir,
      retentionDays
    });
    logger.info(
      `Backup complete: ${path.basename(result.file)} (kept ${result.kept}, pruned ${result.pruned})`
    );
  } catch (error) {
    logger.error('Backup failed:', error);
    process.exitCode = 1;
  }
}

// jiti rewrites argv[1] to the entry path, so this distinguishes direct
// runs from test imports (require.main is not set by jiti).
if (path.resolve(process.argv[1] || '') === __filename) {
  main();
}
