import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractReleaseNotes, parseChangelog, validateReleases } from './changelog-parse.mjs';

const doc = (body) => `# Changelog\n\nPreamble prose.\n\n${body}\n`;

const ONE = doc(`## [Unreleased]

## [1.2.0] - 2026-08-24

### Added

- A **bold** thing that wraps
  onto a second line.
- A plain thing.

### Fixed

- Something broken.

## [1.1.0] - 2026-01-02

### Changed

- An older note.

[Unreleased]: https://example.invalid/compare/v1.2.0...HEAD`);

describe('parseChangelog', () => {
  it('returns releases newest first and keeps [Unreleased] out of them', () => {
    const { releases, unreleased } = parseChangelog(ONE);
    expect(releases.map((r) => r.version)).toEqual(['1.2.0', '1.1.0']);
    expect(unreleased).not.toBeNull();
    expect(unreleased.sections).toEqual([]);
  });

  it('joins wrapped bullets with single spaces and leaves **bold** intact', () => {
    const [newest] = parseChangelog(ONE).releases;
    expect(newest.sections[0].items[0]).toBe('A **bold** thing that wraps onto a second line.');
  });

  it('groups items under their ### heading', () => {
    const [newest] = parseChangelog(ONE).releases;
    expect(newest.sections.map((s) => s.heading)).toEqual(['Added', 'Fixed']);
    expect(newest.sections[1].items).toEqual(['Something broken.']);
  });

  it('ignores link reference definitions at the foot of the file', () => {
    const [, older] = parseChangelog(ONE).releases;
    expect(older.sections[0].items).toEqual(['An older note.']);
  });

  it('rejects a release heading with no date', () => {
    expect(() => parseChangelog(doc('## [1.0.0]\n\n### Added\n\n- Thing.'))).toThrow(
      /missing its "- YYYY-MM-DD" date/,
    );
  });

  it('rejects a bullet that is not inside a ### section', () => {
    expect(() => parseChangelog(doc('## [1.0.0] - 2026-01-01\n\n- Loose bullet.'))).toThrow(
      /not inside a "### " section/,
    );
  });

  it('rejects nested list items, which the panel cannot render', () => {
    const src = doc('## [1.0.0] - 2026-01-01\n\n### Added\n\n- Parent.\n\n  - Child.');
    expect(() => parseChangelog(src)).toThrow(/nested list items are not supported/);
  });

  it('rejects an unrecognised line inside a release', () => {
    const src = doc('## [1.0.0] - 2026-01-01\n\n### Added\n\n> a blockquote');
    expect(() => parseChangelog(src)).toThrow(/unrecognised line/);
  });
});

describe('validateReleases', () => {
  const releases = () => parseChangelog(ONE).releases;

  it('passes when the newest version matches package.json', () => {
    expect(() => validateReleases(releases(), '1.2.0')).not.toThrow();
  });

  it('fails when package.json has drifted from the newest entry', () => {
    expect(() => validateReleases(releases(), '1.3.0')).toThrow(/Version mismatch/);
  });

  it('fails on an empty changelog', () => {
    expect(() => validateReleases([], '1.0.0')).toThrow(/no released versions/);
  });

  it('fails when versions are not strictly descending', () => {
    const out = releases().reverse();
    expect(() => validateReleases(out, '1.1.0')).toThrow(/strictly descending/);
  });

  it('fails on a duplicated version', () => {
    const [newest] = releases();
    expect(() => validateReleases([newest, { ...newest }], '1.2.0')).toThrow(/strictly descending/);
  });

  it('fails on a non-semver version', () => {
    const out = releases();
    out[0].version = '1.2';
    expect(() => validateReleases(out, '1.2')).toThrow(/not a valid semantic version/);
  });

  it('fails on a non-ISO date', () => {
    const out = releases();
    out[0].date = '24/08/2026';
    expect(() => validateReleases(out, '1.2.0')).toThrow(/expected ISO 8601/);
  });

  it('fails on a date that is well-formed but not real', () => {
    const out = releases();
    out[0].date = '2026-02-30';
    expect(() => validateReleases(out, '1.2.0')).toThrow(/not a real date/);
  });

  it('fails on a release with no sections', () => {
    const out = releases();
    out[0].sections = [];
    expect(() => validateReleases(out, '1.2.0')).toThrow(/no "### " sections/);
  });

  it('fails on a section with no items', () => {
    const out = releases();
    out[0].sections = [{ heading: 'Added', items: [] }];
    expect(() => validateReleases(out, '1.2.0')).toThrow(/has no items/);
  });
});

describe('extractReleaseNotes', () => {
  it('returns the section body for one version without its heading and without the next', () => {
    const notes = extractReleaseNotes(ONE, '1.2.0');
    expect(notes.startsWith('### Added')).toBe(true);
    expect(notes).toContain('Something broken.');
    expect(notes).not.toContain('An older note.');
  });

  it('returns null for a version that is not in the file', () => {
    expect(extractReleaseNotes(ONE, '9.9.9')).toBeNull();
  });

  it('stops the oldest release at the link-reference block rather than at EOF', () => {
    const notes = extractReleaseNotes(ONE, '1.1.0');
    expect(notes).toContain('An older note.');
    expect(notes).not.toContain('example.invalid');
    expect(notes.endsWith('An older note.')).toBe(true);
  });
});

describe('the real CHANGELOG.md', () => {
  const markdown = readFileSync('CHANGELOG.md', 'utf8');
  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;

  it('parses and validates against package.json', () => {
    const { releases } = parseChangelog(markdown);
    expect(() => validateReleases(releases, version)).not.toThrow();
  });

  it('has extractable release notes for every version it lists', () => {
    for (const r of parseChangelog(markdown).releases) {
      expect(extractReleaseNotes(markdown, r.version), r.version).toBeTruthy();
    }
  });
});
