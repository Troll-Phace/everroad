#!/usr/bin/env node
/**
 * Changelog codegen: `CHANGELOG.md` -> `src/version/changelog.generated.ts`.
 *
 *   node scripts/build-changelog.mjs           rewrite the generated module
 *   node scripts/build-changelog.mjs --check   fail if it is out of date
 *
 * CHANGELOG.md is the source of truth for in-game patch notes; the What's New
 * panel renders the generated module. The module is committed — same policy as
 * the model codegen — so the browser fetches nothing and CI does not have to
 * regenerate before it can build.
 *
 * `--check` proves two of the three legs of the version agreement: that
 * CHANGELOG.md's newest entry matches package.json's `version`, and that the
 * generated module matches CHANGELOG.md. It never sees a git tag. The third
 * leg — tag == `v$(package.json version)` — is checked by the `guard` job in
 * .github/workflows/release.yml, in its "Resolve and verify the version" step,
 * before anything is drafted or published. `--check` itself runs in
 * `npm run verify`, in CI, and again in `guard`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { extractReleaseNotes, parseChangelog, validateReleases } from './lib/changelog-parse.mjs';

// Resolved from this file rather than from cwd, so the script gives the same
// answer wherever it is run from — matching scripts/lib/build-info.mjs.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Repo-relative names, used in messages; the paths below are absolute. */
const SOURCE = 'CHANGELOG.md';
const OUT = 'src/version/changelog.generated.ts';
const SOURCE_PATH = join(ROOT, SOURCE);
const OUT_PATH = join(ROOT, OUT);

const check = process.argv.includes('--check');

if (!existsSync(SOURCE_PATH)) {
  console.error(`${SOURCE} is missing — it is the source of truth for in-game patch notes.`);
  process.exit(1);
}

const markdown = readFileSync(SOURCE_PATH, 'utf8');
const packageVersion = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

let releases;
try {
  ({ releases } = parseChangelog(markdown));
  validateReleases(releases, packageVersion);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Sanity check the notes extractor against the same file, so a release cannot
// discover at tag time that its GitHub body would come out empty.
for (const r of releases) {
  if (!extractReleaseNotes(markdown, r.version)) {
    console.error(`${SOURCE}: could not extract release notes for [${r.version}].`);
    process.exit(1);
  }
}

const entries = releases
  .map((r) => {
    const sections = r.sections
      .map(
        (s) =>
          `      {\n        heading: ${JSON.stringify(s.heading)},\n        items: [\n` +
          s.items.map((i) => `          ${JSON.stringify(i)},`).join('\n') +
          `\n        ],\n      },`,
      )
      .join('\n');
    return (
      `  {\n    version: ${JSON.stringify(r.version)},\n` +
      `    date: ${JSON.stringify(r.date)},\n` +
      `    sections: [\n${sections}\n    ],\n  },`
    );
  })
  .join('\n');

const items = releases.reduce((n, r) => n + r.sections.reduce((m, s) => m + s.items.length, 0), 0);

const source = `/**
 * GENERATED FILE — do not edit.
 *
 * Written by \`npm run changelog\` from CHANGELOG.md, which is the source of
 * truth for patch notes. Edit that file and regenerate; \`npm run verify\` and
 * CI both fail when the two drift apart.
 *
 * ${releases.length} release(s), ${items} note(s), newest ${releases[0].version} (${releases[0].date}).
 */

/** One \`### \` block of a release: "Added", "Changed", "Fixed", and friends. */
export interface ChangelogSection {
  heading: string;
  /** Bullet text with Markdown \`**bold**\` left intact for the renderer. */
  items: string[];
}

/** One published version, with its ISO 8601 release date. */
export interface ChangelogRelease {
  version: string;
  date: string;
  sections: ChangelogSection[];
}

/** Newest first. Excludes the [Unreleased] section. */
export const CHANGELOG: readonly ChangelogRelease[] = [
${entries}
];
`;

const config = await prettier.resolveConfig(OUT_PATH);
const formatted = await prettier.format(source, { ...config, parser: 'typescript' });

const current = existsSync(OUT_PATH) ? readFileSync(OUT_PATH, 'utf8') : null;

if (check) {
  if (current !== formatted) {
    console.error(
      `${OUT} is out of date with ${SOURCE}. Run \`npm run changelog\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(
    `${OUT} is up to date (${releases.length} release(s), newest ${releases[0].version} — ` +
      `matches package.json).`,
  );
} else {
  if (current !== formatted) writeFileSync(OUT_PATH, formatted);
  console.log(`${OUT} written: ${releases.length} release(s), ${items} note(s).`);
}
