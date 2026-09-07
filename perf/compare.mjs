#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const before = JSON.parse(
  await readFile(path.join(here, 'local-before.json'), 'utf8')
);
const after = JSON.parse(
  await readFile(path.join(here, 'local-after.json'), 'utf8')
);
const explainBefore = JSON.parse(
  await readFile(path.join(here, 'local-explain-before.json'), 'utf8')
);
const explainAfter = JSON.parse(
  await readFile(path.join(here, 'local-explain-after.json'), 'utf8')
);

function explainTimes(planJson) {
  const times = {};
  for (const kind of ['count', 'select']) {
    const ex = planJson[kind][0];
    times[kind] = { plan: ex['Planning Time'], exec: ex['Execution Time'] };
  }
  return times;
}

const explainSummary = {};
for (const name of Object.keys(explainBefore)) {
  explainSummary[name] = {
    before: explainTimes(explainBefore[name]),
    after: explainTimes(explainAfter[name])
  };
}
await writeFile(
  path.join(here, 'local-explain-summary.json'),
  JSON.stringify(explainSummary, null, 2)
);

const lines = [
  '# getAllPaginated before/after (local pg 16.14, 6960 worlds, 14034 junction rows)',
  '',
  'Harness: `perf/bench-local.ts` against the migrated prod-shape clone. Three reps per config, warm cache, p50 reported. COUNT and page SELECT timed separately in the before harness (sequential); after harness they run concurrently via Promise.all.',
  '',
  '| Config | before e2e p50 | after e2e p50 | delta |',
  '| --- | ---: | ---: | ---: |'
];
for (const b of before.results) {
  const a = after.results.find((r) => r.config === b.config);
  const delta = a.e2e_ms.p50 - b.e2e_ms.p50;
  lines.push(
    `| ${b.config} | ${b.e2e_ms.p50.toFixed(0)}ms | ${a.e2e_ms.p50.toFixed(0)}ms | ${delta > 0 ? '+' : ''}${delta.toFixed(0)}ms |`
  );
}
lines.push(
  '',
  '## EXPLAIN (ANALYZE, BUFFERS) times, ms',
  '',
  '| Capture | Phase | before | after |',
  '| --- | --- | ---: | ---: |'
);
for (const [name, ex] of Object.entries(explainSummary)) {
  for (const kind of ['count', 'select']) {
    lines.push(
      `| ${name} ${kind} | plan | ${ex.before[kind].plan.toFixed(1)} | ${ex.after[kind].plan.toFixed(1)} |`
    );
    lines.push(
      `| ${name} ${kind} | exec | ${ex.before[kind].exec.toFixed(1)} | ${ex.after[kind].exec.toFixed(1)} |`
    );
  }
}
lines.push('');
await writeFile(path.join(here, 'local-compare.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
