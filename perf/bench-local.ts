import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createQueryable } from '../src/db/client';
import { WorldRepository } from '../src/db/worldRepository';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.BENCH_DATABASE_URL;
if (!url) throw new Error('BENCH_DATABASE_URL is required');

const pool = new Pool({ connectionString: url });
const repo = new WorldRepository(createQueryable(pool));

const tags = await pool.query<{ tag: string }>(
  `SELECT wt.tag FROM world_tags wt GROUP BY wt.tag ORDER BY count(*) DESC LIMIT 20`
);
const popularTags = tags.rows.map((r) => r.tag);
const flags = await pool.query<{ flag: string }>(
  `SELECT DISTINCT flag FROM world_flags`
);
const flagNames = flags.rows.map((r) => r.flag);
console.log('popular tags:', popularTags.join(', '));
console.log('flags:', flagNames.join(', '));

const configs: {
  name: string;
  filters?: Parameters<WorldRepository['getAllPaginated']>[2];
}[] = [];
for (const n of [0, 2, 4, 8, 12, 16, 20]) {
  configs.push({
    name: `tags=${n}`,
    filters: { tags: popularTags.slice(0, n) }
  });
}
configs.push({
  name: 'combined 20 tags + flags + platform + dayRange',
  filters: {
    tags: popularTags,
    excludeFlags: flagNames,
    platforms: ['vrchat'],
    dayRange: 30
  }
});
configs.push({ name: 'search="a"', filters: { search: 'a' } });
configs.push({
  name: '20 tags + search="a"',
  filters: { tags: popularTags, search: 'a' }
});

async function timed(fn: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

const anyRepo = repo as unknown as {
  buildWhereClause: (f?: object) => { whereClause: string; params: unknown[] };
  attachTags: (rows: unknown[]) => Promise<unknown>;
  attachFlags: (rows: unknown[]) => Promise<unknown>;
};

async function pieceTiming(filters?: object) {
  const { whereClause, params } = anyRepo.buildWhereClause(filters);
  const countMs = await timed(() =>
    pool.query(
      `SELECT COUNT(*)::int as total FROM world_records wr ${whereClause}`,
      params as never[]
    )
  );
  const selectSql = `
    SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority
    FROM world_records wr
    LEFT JOIN high_priority_worlds hp ON hp.world_id = wr.world_id
    ${whereClause}
    ORDER BY wr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const started = performance.now();
  const selectResult = await pool.query(selectSql, [
    ...(params as never[]),
    50,
    0
  ]);
  const selectMs = performance.now() - started;
  const attachStart = performance.now();
  await anyRepo.attachFlags(await anyRepo.attachTags(selectResult.rows));
  const attachMs = performance.now() - attachStart;
  const total = (selectResult.rows[0] as { total?: number } | undefined)?.total;
  return {
    countMs,
    selectMs,
    attachMs,
    matched: total ?? selectResult.rows.length
  };
}

for (const config of configs) {
  await timed(() => repo.getAllPaginated(50, 0, config.filters));
}

const results = [];
for (const config of configs) {
  const reps = 3;
  const e2e: number[] = [];
  let pieces = { countMs: 0, selectMs: 0, attachMs: 0, matched: 0 };
  for (let i = 0; i < reps; i++) {
    e2e.push(await timed(() => repo.getAllPaginated(50, 0, config.filters)));
  }
  const p = await pieceTiming(config.filters);
  pieces = p;
  results.push({
    config: config.name,
    e2e_ms: {
      p50: e2e.slice().sort((a, b) => a - b)[1],
      min: Math.min(...e2e),
      max: Math.max(...e2e)
    },
    count_ms: pieces.countMs,
    select_ms: pieces.selectMs,
    attach_ms: pieces.attachMs,
    matched: pieces.matched
  });
  console.log(
    `${config.name}: e2e p50=${results[results.length - 1].e2e_ms.p50.toFixed(0)}ms count=${pieces.countMs.toFixed(0)}ms select=${pieces.selectMs.toFixed(0)}ms attach=${pieces.attachMs.toFixed(0)}ms matched=${pieces.matched}`
  );
}

async function explain(name: string, filters?: object) {
  const { whereClause, params } = anyRepo.buildWhereClause(filters);
  const countSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::int as total FROM world_records wr ${whereClause}`;
  const selectSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT wr.*, (hp.world_id IS NOT NULL) AS high_priority FROM world_records wr LEFT JOIN high_priority_worlds hp ON hp.world_id = wr.world_id ${whereClause} ORDER BY wr.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countPlan = await pool.query(countSql, params as never[]);
  const selectPlan = await pool.query(selectSql, [
    ...(params as never[]),
    50,
    0
  ]);
  return {
    name,
    count: countPlan.rows[0]['QUERY PLAN'],
    select: selectPlan.rows[0]['QUERY PLAN']
  };
}

const explains = {
  tags20: await explain('tags=20', { tags: popularTags }),
  search: await explain('search=a', { search: 'a' }),
  combined: await explain('combined', {
    tags: popularTags,
    excludeFlags: flagNames,
    platforms: ['vrchat'],
    dayRange: 30
  })
};

await writeFile(
  path.join(here, 'local-baseline.json'),
  JSON.stringify(
    { generatedAt: new Date().toISOString(), url, results },
    null,
    2
  )
);
await writeFile(
  path.join(here, 'local-explain.json'),
  JSON.stringify(explains, null, 2)
);
console.log('\nartifacts -> perf/local-baseline.json, perf/local-explain.json');
await pool.end();
