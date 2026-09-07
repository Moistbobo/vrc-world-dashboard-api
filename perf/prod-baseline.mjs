#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, '../../sos-world-dashboard/.env.local');
const env = await readFile(envPath, 'utf8');
const token = env.match(/^VITE_API_BEARER_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token)
  throw new Error('VITE_API_BEARER_TOKEN not found in dashboard .env.local');

const base = 'https://api.testnet.googoogaagaa.club';
const headers = { Authorization: `Bearer ${token}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timedGet(url) {
  const started = performance.now();
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(90_000)
  });
  const body = await res.json();
  const elapsed = performance.now() - started;
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status} for ${url}: ${JSON.stringify(body).slice(0, 200)}`
    );
  return { elapsed, total: body.total };
}

const tagsJson = await (await fetch(`${base}/api/tags`, { headers })).json();
const popularTags = tagsJson.tags
  .sort((a, b) => b.count - a.count)
  .slice(0, 20)
  .map((t) => encodeURIComponent(t.tag));

const flagsJson = await (await fetch(`${base}/api/flags`, { headers })).json();
const allFlags = flagsJson.flags.map((f) => encodeURIComponent(f.flag));

const rampCounts = [0, 2, 4, 8, 12, 16, 20];
const reps = 2;
const configs = [];
for (const n of rampCounts) {
  configs.push({
    name: `tags=${n}`,
    qs: popularTags
      .slice(0, n)
      .map((t) => `tag=${t}`)
      .join('&')
  });
}
configs.push({
  name: 'combined 20 tags + 5 flags + platform + dayRange',
  qs:
    popularTags.map((t) => `tag=${t}`).join('&') +
    '&' +
    allFlags.map((f) => `exclude=${f}`).join('&') +
    '&platform=vrchat&dayRange=30'
});
configs.push({ name: 'search="a"', qs: 'search=a' });
configs.push({
  name: '20 tags + search="a"',
  qs: popularTags.map((t) => `tag=${t}`).join('&') + '&search=a'
});

const results = [];
for (const config of configs) {
  for (let rep = 0; rep < reps; rep++) {
    const capacity = 'minCapacity=1&maxCapacity=80';
    const qs = [config.qs, capacity].filter(Boolean).join('&');
    const url = `${base}/api/worlds?limit=50&offset=0${qs ? '&' + qs : ''}`;
    try {
      const { elapsed, total } = await timedGet(url);
      results.push({
        config: config.name,
        rep,
        elapsed_ms: elapsed,
        total,
        url
      });
      console.log(
        `${config.name} rep${rep}: ${elapsed.toFixed(0)}ms (total=${total})`
      );
    } catch (err) {
      results.push({
        config: config.name,
        rep,
        error: String(err.message ?? err),
        url
      });
      console.log(`${config.name} rep${rep}: ERROR ${err.message ?? err}`);
    }
    await sleep(300);
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ];
}
const summary = {};
for (const config of configs) {
  const rows = results.filter(
    (r) => r.config === config.name && typeof r.elapsed_ms === 'number'
  );
  const sorted = rows.map((r) => r.elapsed_ms).sort((a, b) => a - b);
  summary[config.name] = {
    reps: rows.length,
    p50: percentile(sorted, 50),
    max: sorted[sorted.length - 1] ?? null,
    totals: rows.map((r) => r.total)
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  base,
  note: 'GET-only probe against prod API, mirrors dashboard request shape',
  summary,
  results
};
const outPath = path.join(here, 'prod-baseline.json');
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log('\nsummary:');
for (const [name, s] of Object.entries(summary)) {
  console.log(
    `${name}: p50=${s.p50?.toFixed(0) ?? '-'}ms max=${s.max?.toFixed(0) ?? '-'}ms totals=${s.totals.join(',')}`
  );
}
console.log(`\nartifact -> ${outPath}`);
