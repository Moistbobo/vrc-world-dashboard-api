import { World } from 'vrchat';
import { getQueryable } from '../db/pool';
import { getPackageSizesInMb } from '../worlds/packageSizes';
import logger from '../logger';

interface Row {
  id: number;
  vrchat_data: string | null;
}

const DEFAULT_DELAY_MS = 150;
const BATCH_SIZE = 50;

function parseWorldData(vrchatData: string | null): World | null {
  if (!vrchatData) return null;
  try {
    return JSON.parse(vrchatData) as World;
  } catch {
    return null;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const delayMs = Number(process.env.BACKFILL_DELAY_MS) || DEFAULT_DELAY_MS;
  const db = getQueryable();

  const totalResult = await db.query<{ total: number }>(
    `SELECT COUNT(*)::int AS total FROM world_records
     WHERE vrchat_data IS NOT NULL AND vrchat_data != ''`
  );
  const total = totalResult.rows[0]?.total ?? 0;
  logger.info(`Backfilling package sizes for ${total} world records`);

  let offset = 0;
  let processed = 0;
  let updated = 0;
  let failed = 0;

  while (true) {
    const rowsResult = await db.query<Row>(
      `SELECT id, vrchat_data FROM world_records
       WHERE vrchat_data IS NOT NULL AND vrchat_data != ''
         AND cardinality(package_sizes) = 0
       ORDER BY id LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );
    const rows = rowsResult.rows;

    if (rows.length === 0) break;

    for (const row of rows) {
      const worldData = parseWorldData(row.vrchat_data);
      if (!worldData) {
        failed++;
        continue;
      }

      const sizes = await getPackageSizesInMb(worldData);
      if (sizes.length > 0) {
        await db.query(
          `UPDATE world_records SET package_sizes = $1 WHERE id = $2`,
          [sizes, row.id]
        );
        updated++;
      } else {
        failed++;
      }
      processed++;
      await sleep(delayMs);
    }

    logger.info(
      `Backfill progress: ${processed}/${total} processed, ${updated} updated, ${failed} failed`
    );
    offset += rows.length;
  }

  logger.info(
    `Backfill complete: ${processed} processed, ${updated} updated, ${failed} failed`
  );
}

main().catch((error) => {
  logger.error('Backfill failed:', error);
  process.exit(1);
});
