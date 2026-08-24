/**
 * Write `release-meta.json` — the one thing a release says about itself that
 * the update feed cannot.
 *
 * `electron-builder` already publishes `latest*.yml`, and that is enough for a
 * running build to learn a newer version exists. It is not enough to answer the
 * question the player actually cares about before pressing Download: *will this
 * still be able to read my journey?* `SAVE_VERSION` is a compile-time constant
 * baked into each bundle (src/types.ts), so an old build has no way to see the
 * new one's value — and EverRoad is pre-1.0, where a patch bump is explicitly
 * allowed to move the save format (CHANGELOG.md). The version number carries no
 * signal on its own.
 *
 * So each release publishes its own. `electron/updater.cjs` fetches this file
 * from the offered release and hands `saveVersion` to the renderer, which
 * compares it against its own `SAVE_VERSION` and warns when it is higher.
 *
 * Releases cut before this existed simply have no such asset; the updater reads
 * that as "unknown" and says so, rather than assuming the update is safe.
 *
 * Usage:  node scripts/build-release-meta.mjs [outfile]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Read `SAVE_VERSION` out of src/types.ts.
 *
 * Parsed from the source rather than imported, because this script is plain
 * Node and types.ts is TypeScript — standing up a compiler to read one integer
 * would be the larger moving part. The regex is anchored to the exact
 * declaration and the script throws when it does not match, so a rename fails
 * the release loudly instead of publishing a file that quietly says the wrong
 * thing.
 */
function readSaveVersion() {
  const source = readFileSync(resolve(root, 'src/types.ts'), 'utf8');
  const match = /^export const SAVE_VERSION = (\d+);$/m.exec(source);
  if (!match) {
    throw new Error(
      'Could not find `export const SAVE_VERSION = <n>;` in src/types.ts. ' +
        'If the declaration moved or changed shape, update ' +
        'scripts/build-release-meta.mjs to match — a release must not ship ' +
        'without an accurate save version.',
    );
  }
  return Number(match[1]);
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

const meta = {
  version: pkg.version,
  saveVersion: readSaveVersion(),
  /**
   * The oldest save format this release can still load. `hydrate()` in
   * src/save/save.ts deep-merges any older save over fresh defaults, so today
   * that is 1 for every release. It is published anyway: the day a migration is
   * dropped, this is where a build finds out that the update is one-way before
   * it downloads it.
   */
  minSaveVersion: 1,
};

const out = process.argv[2] ?? resolve(root, 'release-meta.json');
writeFileSync(out, `${JSON.stringify(meta, null, 2)}\n`);
console.log(`release-meta.json -> ${out}`);
console.log(JSON.stringify(meta));
