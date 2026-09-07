#!/usr/bin/env node
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const outDir = repoRoot;

function parseQuery(url) {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return { params: [] };
  const params = [];
  for (const pair of url.slice(qIdx + 1).split('&')) {
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1));
    params.push([key, value]);
  }
  return { params };
}

function classify(url) {
  const { params } = parseQuery(url);
  const nTags = params.filter(([k]) => k === 'tag').length;
  const nExcludes = params.filter(([k]) => k === 'exclude').length;
  const hasSearch = params.some(([k, v]) => k === 'search' && v.trim() !== '');
  const hasQuality = params.some(([k]) => k === 'quality');
  const hasPlatform = params.some(([k]) => k === 'platform');
  const hasCapacity = params.some(
    ([k]) => k === 'minCapacity' || k === 'maxCapacity'
  );
  const hasDayRange = params.some(([k]) => k === 'dayRange');
  const nFilters =
    nTags +
    nExcludes +
    (hasSearch ? 1 : 0) +
    (hasQuality ? 1 : 0) +
    (hasPlatform ? 1 : 0) +
    (hasDayRange ? 1 : 0);
  return {
    nTags,
    nExcludes,
    hasSearch,
    hasQuality,
    hasPlatform,
    hasCapacity,
    hasDayRange,
    nFilters
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1
  );
  return sorted[idx];
}

function summarize(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const count = sorted.length;
  const total = sorted.reduce((s, d) => s + d, 0);
  const over = sorted.filter((d) => d > 500).length;
  return {
    count,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: count ? total / count : null,
    max: sorted[count - 1] ?? null,
    over500ms: over,
    over500msPct: count ? (over / count) * 100 : 0
  };
}

const files = (await readdir(repoRoot)).filter(
  (f) => f === 'tslog.log' || f.endsWith('-tslog.log.gz')
);
const rows = [];
const unreadable = [];

for (const file of files) {
  const isGz = file.endsWith('.gz');
  const stream = createReadStream(path.join(repoRoot, file));
  const source = isGz ? stream.pipe(createGunzip()) : stream;
  const rl = readline.createInterface({ input: source, crlfDelay: Infinity });
  if (isGz) {
    const onError = () => {
      if (!unreadable.includes(file)) unreadable.push(file);
      source.destroy();
      rl.close();
    };
    source.on('error', onError);
    rl.on('error', onError);
  }
  for await (const line of rl) {
    if (!line.includes('accessLog')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = obj['0'];
    const filePath = obj?._meta?.path?.filePath;
    if (
      !entry ||
      typeof entry !== 'object' ||
      filePath !== 'src/apiServer/middleware/accessLog.ts'
    )
      continue;
    if (typeof entry.url !== 'string' || !entry.url.startsWith('/api/worlds'))
      continue;
    const ts = obj?._meta?.date ?? null;
    rows.push({
      ts,
      file,
      duration_ms: entry.duration_ms,
      status: entry.status,
      ...classify(entry.url)
    });
  }
}

const byFilters = new Map();
const byFiltersNoSearch = new Map();
for (const row of rows) {
  const bucket = byFilters.get(row.nFilters) ?? [];
  bucket.push(row.duration_ms);
  byFilters.set(row.nFilters, bucket);
  if (!row.hasSearch) {
    const bucket2 = byFiltersNoSearch.get(row.nFilters) ?? [];
    bucket2.push(row.duration_ms);
    byFiltersNoSearch.set(row.nFilters, bucket2);
  }
}

function mapToObj(map) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([k, v]) => [k, summarize(v)])
  );
}

const summary = {
  generatedAt: new Date().toISOString(),
  files,
  unreadable,
  totalRequests: rows.length,
  overall: summarize(rows.map((r) => r.duration_ms)),
  byFilterCount: mapToObj(byFilters),
  byFilterCountExcludingSearch: mapToObj(byFiltersNoSearch),
  searchRequests: summarize(
    rows.filter((r) => r.hasSearch).map((r) => r.duration_ms)
  ),
  noSearchRequests: summarize(
    rows.filter((r) => !r.hasSearch).map((r) => r.duration_ms)
  ),
  statusCounts: rows.reduce(
    (acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc),
    {}
  )
};

const rowsPath = path.join(outDir, 'baseline-rows.json');
const summaryPath = path.join(outDir, 'baseline-summary.json');
await import('node:fs/promises').then((fs) =>
  fs.writeFile(rowsPath, JSON.stringify(rows))
);
await import('node:fs/promises').then((fs) =>
  fs.writeFile(summaryPath, JSON.stringify(summary, null, 2))
);

console.log(JSON.stringify(summary, null, 2));
console.log(`rows -> ${rowsPath}`);
console.log(`summary -> ${summaryPath}`);
