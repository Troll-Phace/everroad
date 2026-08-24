#!/usr/bin/env node
/**
 * Bundle budget guard. Reads dist/ after a build, reports raw + gzip sizes,
 * and exits non-zero when a budget is exceeded. Budgets are deliberately set
 * a little above current size — tighten them when the bundle shrinks.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BUDGETS = {
  '.js': { raw: 1_000_000, gzip: 300_000 },
  '.css': { raw: 60_000, gzip: 15_000 },
};

const DIST = 'dist';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

let files;
try {
  files = walk(DIST);
} catch {
  console.error(`No ${DIST}/ directory — run \`npm run build\` first.`);
  process.exit(1);
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
const rows = [];
const totals = {};
let failed = false;

for (const file of files) {
  const ext = file.slice(file.lastIndexOf('.'));
  if (!(ext in BUDGETS)) continue;
  const buf = readFileSync(file);
  const raw = statSync(file).size;
  const gzip = gzipSync(buf, { level: 9 }).length;
  totals[ext] ??= { raw: 0, gzip: 0 };
  totals[ext].raw += raw;
  totals[ext].gzip += gzip;
  rows.push({ file, raw, gzip });
}

for (const [ext, total] of Object.entries(totals)) {
  const budget = BUDGETS[ext];
  for (const kind of ['raw', 'gzip']) {
    if (total[kind] > budget[kind]) {
      failed = true;
      console.error(`OVER BUDGET: total ${ext} ${kind} ${kb(total[kind])} > ${kb(budget[kind])}`);
    }
  }
}

const lines = [
  '| file | raw | gzip |',
  '| --- | ---: | ---: |',
  ...rows.map((r) => `| \`${r.file}\` | ${kb(r.raw)} | ${kb(r.gzip)} |`),
  ...Object.entries(totals).map(
    ([ext, t]) =>
      `| **total ${ext}** (budget ${kb(BUDGETS[ext].raw)} / ${kb(BUDGETS[ext].gzip)}) | **${kb(t.raw)}** | **${kb(t.gzip)}** |`,
  ),
];

console.log(lines.join('\n'));

if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size\n\n${lines.join('\n')}\n`);
}

process.exit(failed ? 1 : 0);
