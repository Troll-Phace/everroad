#!/usr/bin/env node
/**
 * Print one version's CHANGELOG.md section as Markdown, for the GitHub Release
 * body. Used by `.github/workflows/release.yml` so the notes are written once,
 * in the changelog, and never hand-copied into a release.
 *
 *   node scripts/release-notes.mjs            the version in package.json
 *   node scripts/release-notes.mjs 0.1.17     an explicit version
 */
import { readFileSync } from 'node:fs';
import { extractReleaseNotes } from './lib/changelog-parse.mjs';

const version = process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version;
const notes = extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version);

if (!notes) {
  console.error(`CHANGELOG.md has no section for [${version}].`);
  process.exit(1);
}

process.stdout.write(`${notes}\n`);
