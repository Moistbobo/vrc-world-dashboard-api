import { Pool } from 'pg';
import { createQueryable } from '../src/db/client';
import { runMigrations } from '../src/db/schema';

const url = process.env.BENCH_DATABASE_URL;
if (!url) throw new Error('BENCH_DATABASE_URL is required');

const pool = new Pool({ connectionString: url });
const db = createQueryable(pool);

await runMigrations(db);

await db.query(
  `INSERT INTO world_flags (world_id, flag, added_at)
   SELECT w.world_id, f.flag, (extract(epoch from now()) * 1000)::bigint FROM (VALUES
     ('AI slop'), ('booth slop'), ('furry'), ('poor performance'), ('poor performance'),
     ('low quality'), ('low quality'), ('AI slop'), ('booth slop'), ('furry')
   ) AS f(flag)
   JOIN (SELECT world_id FROM world_records ORDER BY random() LIMIT 10) w ON true
   ON CONFLICT (world_id, flag) DO NOTHING`
);

await db.query(
  `INSERT INTO high_priority_worlds (world_id, added_at)
   SELECT world_id, (extract(epoch from now()) * 1000)::bigint FROM (SELECT world_id FROM world_records ORDER BY random() LIMIT 40) s
   ON CONFLICT (world_id) DO NOTHING`
);

await db.query('ANALYZE');

const counts = await db.query(
  `SELECT (SELECT count(*) FROM world_records) AS worlds,
          (SELECT count(*) FROM world_tags) AS junction_rows,
          (SELECT count(*) FROM world_flags) AS flags,
          (SELECT count(*) FROM high_priority_worlds) AS high_priority,
          (SELECT count(*) FROM _migrations) AS migrations`
);
console.log(counts.rows[0]);

await pool.end();
