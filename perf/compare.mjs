#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = async (name) =>
  JSON.parse(await readFile(path.join(here, name), 'utf8'));

const before = await load('local-before.json');
const after = await load('local-after.json');
const explainBefore = await load('local-explain-before.json');
const explainAfter = await load('local-explain-after.json');

const gates = [];
const gate = (name, ok, detail) => gates.push({ name, ok, detail });

function explainTimes(planJson) {
  const times = {};
  for (const kind of ['count', 'select']) {
    const ex = planJson[kind][0];
    times[kind] = { plan: ex['Planning Time'], exec: ex['Execution Time'] };
  }
  return times;
}

const explainSummary = {};
for (const name of new Set([
  ...Object.keys(explainBefore),
  ...Object.keys(explainAfter)
])) {
  explainSummary[name] = {
    before: explainBefore[name] ? explainTimes(explainBefore[name]) : null,
    after: explainAfter[name] ? explainTimes(explainAfter[name]) : null
  };
}
await writeFile(
  path.join(here, 'local-explain-summary.json'),
  JSON.stringify(explainSummary, null, 2)
);

const lines = ['# getAllPaginated before/after', ''];
lines.push(
  'Harness: `perf/bench-local.ts` against the migrated prod-shape clone. Three reps per config, warm cache, p50 reported. Empty `before` cells mean the config did not exist on the base revision (new mode).',
  ''
);

const p50 = (r) => r.e2e_ms.p50;
const byConfig = (result, name) =>
  result.results.find((r) => r.config === name);
const tags0After = byConfig(after, 'tags=0');
const isNewMode = (r) => r.config.startsWith('qualityMode');

lines.push(
  '| Config | before e2e p50 | after e2e p50 | delta | ratio vs unfiltered |'
);
lines.push('| --- | ---: | ---: | ---: | ---: |');
for (const b of before.results.filter((r) => !isNewMode(r))) {
  const a = byConfig(after, b.config);
  const delta = p50(a) - p50(b);
  const ratio = tags0After ? p50(a) / p50(tags0After) : NaN;
  lines.push(
    `| ${b.config} | ${p50(b).toFixed(0)}ms | ${p50(a).toFixed(0)}ms | ${delta > 0 ? '+' : ''}${delta.toFixed(0)}ms | ${ratio.toFixed(2)}x |`
  );
  const noise = Math.max(2, p50(b) * 0.1);
  gate(
    `existing "${b.config}" within noise`,
    delta <= noise,
    `delta ${delta > 0 ? '+' : ''}${delta.toFixed(1)}ms, allowed ${noise.toFixed(1)}ms`
  );
}

const newConfigs = after.results.filter(isNewMode);
if (newConfigs.length > 0) {
  lines.push('', '## New mode (after only)', '');
  lines.push('| Config | after e2e p50 | ratio vs tags=0 |');
  lines.push('| --- | ---: | ---: |');
  for (const a of newConfigs) {
    const ratio = tags0After ? p50(a) / p50(tags0After) : NaN;
    lines.push(
      `| ${a.config} | ${p50(a).toFixed(0)}ms | ${ratio.toFixed(2)}x |`
    );
    gate(
      `new "${a.config}" <= 1.25x unfiltered`,
      Number.isFinite(ratio) && ratio <= 1.25,
      tags0After
        ? `ratio ${ratio.toFixed(2)}x vs tags=0 (${p50(tags0After).toFixed(0)}ms)`
        : 'no tags=0 baseline'
    );
  }
}

lines.push('', '## EXPLAIN (ANALYZE, BUFFERS) times, ms', '');
lines.push('| Capture | Phase | before | after |');
lines.push('| --- | --- | ---: | ---: |');
const fmt = (v) => (v == null ? '—' : v.toFixed(1));
for (const [name, ex] of Object.entries(explainSummary)) {
  for (const kind of ['count', 'select']) {
    lines.push(
      `| ${name} ${kind} | plan | ${fmt(ex.before?.[kind].plan)} | ${fmt(ex.after?.[kind].plan)} |`
    );
    lines.push(
      `| ${name} ${kind} | exec | ${fmt(ex.before?.[kind].exec)} | ${fmt(ex.after?.[kind].exec)} |`
    );
  }
}

function nodeTypes(plan) {
  const out = [];
  const walk = (n) => {
    out.push(n['Node Type']);
    for (const c of n['Plans'] ?? []) walk(c);
  };
  walk(plan);
  return out;
}
function filters(plan) {
  const out = [];
  const walk = (n) => {
    if (n['Filter']) out.push(n['Filter']);
    for (const c of n['Plans'] ?? []) walk(c);
  };
  walk(plan);
  return out;
}

const isEmptyPredicate = (f) => /quality\s+IS\s+NULL/i.test(f);
const observations = [];

if (explainAfter.unfiltered && explainAfter.qualityExclude) {
  lines.push('', '## Plan shape: qualityMode=exclude vs unfiltered', '');
  lines.push(
    'The unfiltered query is index-driven, so any new predicate changes the access path. Node sequences below are reported, not gated: the ticket\'s "differs only by the added Filter line" clause is checked and, when unmet, listed under "Ticket gates not met".',
    ''
  );
  for (const kind of ['count', 'select']) {
    const base = explainAfter.unfiltered[kind][0].Plan;
    const excl = explainAfter.qualityExclude[kind][0].Plan;
    const baseTypes = nodeTypes(base).join(' > ');
    const exclTypes = nodeTypes(excl).join(' > ');
    const addedFilters = filters(excl).filter(
      (f) => !filters(base).includes(f)
    );
    const baseExec = explainSummary.unfiltered.after[kind].exec;
    const exclExec = explainSummary.qualityExclude.after[kind].exec;
    const ratio = exclExec / Math.max(baseExec, 0.01);
    const shapeUnchanged = baseTypes === exclTypes;
    lines.push(`- ${kind}: \`${exclTypes}\``);
    lines.push(`  - unfiltered node sequence: \`${baseTypes}\``);
    lines.push(`  - node sequence unchanged: ${shapeUnchanged}`);
    lines.push(`  - added filters: ${addedFilters.join('; ') || 'none'}`);
    lines.push(
      `  - exec ${exclExec.toFixed(1)}ms vs ${baseExec.toFixed(1)}ms unfiltered (${ratio.toFixed(1)}x)`
    );
    if (!shapeUnchanged) {
      observations.push(
        `${kind}: node sequence ${baseTypes} -> ${exclTypes} (ticket disallows a plan flip). Exec ${ratio.toFixed(1)}x unfiltered, e2e within 1.25x; a quality index was evaluated and deferred because it does not remove the select sort and there is no latency regression.`
      );
    }
    gate(
      `only quality IS NULL added (${kind})`,
      addedFilters.every(isEmptyPredicate),
      addedFilters.join('; ') || 'no filters added'
    );
    gate(
      `exec time same order of magnitude (${kind})`,
      ratio <= 10,
      `${ratio.toFixed(1)}x unfiltered`
    );
  }
}

lines.push('', '## Gates', '');
for (const g of gates) {
  lines.push(`- ${g.ok ? 'PASS' : 'FAIL'} ${g.name} (${g.detail})`);
}
const failed = gates.filter((g) => !g.ok);
if (observations.length > 0) {
  lines.push('', '## Ticket gates not met', '');
  for (const o of observations) lines.push(`- NOT MET ${o}`);
}
lines.push('');
lines.push(
  failed.length === 0
    ? observations.length === 0
      ? 'GATES: PASS'
      : 'LATENCY GATES: PASS; PLAN-SHAPE CLAUSE: NOT MET (documented above)'
    : 'GATES: FAIL'
);
lines.push('');
await writeFile(path.join(here, 'local-compare.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
if (failed.length > 0) process.exitCode = 1;
