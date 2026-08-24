#!/usr/bin/env node
/**
 * Model codegen: `assets/models/*.evr.json` -> `src/world/models/generated.ts`.
 *
 *   node scripts/build-models.mjs           rewrite the generated module
 *   node scripts/build-models.mjs --check   fail if it is out of date
 *
 * Handcrafted models are opt-in per asset: whatever intermediates exist here
 * get compiled in, and every other asset stays procedural. An empty directory
 * is the normal, valid state.
 *
 * The generated module is committed so the browser never fetches anything and
 * CI never needs Blender. `--check` runs in CI to keep it honest.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { BUDGETS, encodeModel, modelBytes, validateModel } from './lib/model-codec.mjs';

const MODELS_DIR = 'assets/models';
const OUT = 'src/world/models/generated.ts';

const check = process.argv.includes('--check');

function sources() {
  if (!existsSync(MODELS_DIR)) return [];
  return readdirSync(MODELS_DIR)
    .filter((f) => f.endsWith('.evr.json'))
    .sort();
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

const models = [];
const warnings = [];
let totalBytes = 0;
let totalTris = 0;

for (const file of sources()) {
  const path = join(MODELS_DIR, file);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`${path}: not valid JSON — ${err.message}`);
    process.exit(1);
  }

  let report;
  try {
    report = validateModel(doc, path);
  } catch (err) {
    console.error(`${path}: ${err.message}`);
    process.exit(1);
  }

  const encoded = encodeModel(doc);
  const bytes = modelBytes(encoded);
  if (bytes > BUDGETS.maxBytes) {
    console.error(
      `${doc.name}: ${kb(bytes)} exceeds the per-model budget of ${kb(BUDGETS.maxBytes)}`,
    );
    process.exit(1);
  }
  if (bytes > BUDGETS.warnBytes) warnings.push(`${doc.name}: ${kb(bytes)} of geometry data`);
  for (const w of report.warnings) warnings.push(`${doc.name}: ${w}`);

  const clash = models.find((m) => m.doc.name === doc.name);
  if (clash) {
    console.error(
      `${path}: model name "${doc.name}" is already claimed by ${clash.path}. ` +
        'Two intermediates cannot compile to the same key.',
    );
    process.exit(1);
  }

  totalBytes += bytes;
  totalTris += report.tris;
  models.push({ doc, encoded, bytes, tris: report.tris, path });
}

if (totalBytes > BUDGETS.maxTotalBytes) {
  console.error(
    `Handcrafted models total ${kb(totalBytes)}, over the ${kb(BUDGETS.maxTotalBytes)} bundle allowance.`,
  );
  process.exit(1);
}

models.sort((a, b) => a.doc.name.localeCompare(b.doc.name));

const header = models.length
  ? models.map(
      (m) => ` *   ${m.doc.name.padEnd(22)} ${String(m.tris).padStart(5)} tris  ${kb(m.bytes)}`,
    )
  : [' *   (none — every asset is procedural)'];

const body = models.length
  ? models.map((m) => `  ${JSON.stringify(m.doc.name)}: ${JSON.stringify(m.encoded)},`).join('\n')
  : '';

const source = `/**
 * GENERATED FILE — do not edit.
 *
 * Written by \`npm run models\` from the \`.evr.json\` intermediates in
 * \`assets/models/\`, which the Blender recipes in \`assets/models/src/\`
 * produce. See docs/MODELS.md.
 *
 * Handcrafted models listed here override their procedural builder; every
 * asset without an entry stays procedural, which is the default.
 *
${header.join('\n')}
 *
 * Total: ${kb(totalBytes)} of ${kb(BUDGETS.maxTotalBytes)} allowed.
 */

import type { EncodedModel } from './codec';

export const MODELS: Readonly<Record<string, EncodedModel>> = {
${body}
};
`;

const config = await prettier.resolveConfig(OUT);
const formatted = await prettier.format(source, { ...config, parser: 'typescript' });

const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;

if (check) {
  if (current !== formatted) {
    console.error(
      `${OUT} is out of date with ${MODELS_DIR}/. Run \`npm run models\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`${OUT} is up to date (${models.length} model(s), ${kb(totalBytes)}).`);
} else {
  if (current !== formatted) writeFileSync(OUT, formatted);
  console.log(`${OUT} written: ${models.length} model(s), ${totalTris} tris, ${kb(totalBytes)}.`);
}

for (const w of warnings) console.warn(`warning: ${w}`);

if (models.length) {
  const lines = [
    '| model | parts | tris | data |',
    '| --- | ---: | ---: | ---: |',
    ...models.map(
      (m) => `| \`${m.doc.name}\` | ${m.encoded.parts.length} | ${m.tris} | ${kb(m.bytes)} |`,
    ),
    `| **total** (budget ${kb(BUDGETS.maxTotalBytes)}) | | **${totalTris}** | **${kb(totalBytes)}** |`,
  ];
  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Handcrafted models\n\n${lines.join('\n')}\n`,
    );
  }
}
