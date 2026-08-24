/**
 * Build stamp resolution, shared by `vite.config.ts` and `vitest.config.ts`.
 *
 * `src/version/version.ts` reads three compile-time constants that Vite
 * substitutes via `define`. They live here rather than inline in the config so
 * the unit tests see exactly the values the bundle does — a define that exists
 * in one config and not the other is a ReferenceError waiting in a test run.
 *
 * Every lookup degrades: a build from a source tarball has no `.git`, and a
 * `git` that is missing, slow, or refuses the directory must not fail the
 * build. The fallbacks are deliberate, not incidental.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run a git command, returning `null` on any failure (no repo, no git, error). */
function git(...args) {
  try {
    const out = execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    });
    const trimmed = out.trim();
    return trimmed.length ? trimmed : null;
  } catch {
    return null;
  }
}

/** The `version` field of package.json — the single source of the app version. */
export function packageVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

/**
 * Short commit sha for the build, or `'dev'` when there is nothing to read.
 * `GITHUB_SHA` wins so CI stamps the real commit even in a shallow checkout
 * where `git rev-parse` would otherwise be fine but the env value is canonical.
 */
export function buildCommit() {
  const env = process.env.GITHUB_SHA;
  if (env && env.trim()) return env.trim().slice(0, 7);
  return git('rev-parse', '--short=7', 'HEAD') ?? 'dev';
}

/**
 * ISO 8601 date (YYYY-MM-DD) for the build. Prefers the commit date so a
 * rebuild of an old tag stamps when the code was written rather than when the
 * packager happened to run; falls back to today outside a repository.
 */
export function buildDate() {
  const env = process.env.BUILD_DATE;
  if (env && /^\d{4}-\d{2}-\d{2}$/.test(env.trim())) return env.trim();
  return git('log', '-1', '--format=%cd', '--date=short') ?? new Date().toISOString().slice(0, 10);
}

/** The `define` map for both configs. Values are JSON-stringified literals. */
export function buildDefines() {
  return {
    __APP_VERSION__: JSON.stringify(packageVersion()),
    __BUILD_COMMIT__: JSON.stringify(buildCommit()),
    __BUILD_DATE__: JSON.stringify(buildDate()),
  };
}
