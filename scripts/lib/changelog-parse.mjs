/**
 * CHANGELOG.md -> structured releases.
 *
 * CHANGELOG.md is the source of truth for in-game patch notes (§16). This
 * module is the only thing that understands its syntax; `build-changelog.mjs`
 * turns the result into a committed TypeScript module and `release-notes.mjs`
 * slices the raw Markdown back out for a GitHub Release body.
 *
 * The parser is deliberately strict. A changelog that quietly half-parses ships
 * a patch-notes panel with missing bullets and nobody notices for three
 * releases, so anything it does not recognise is an error with a line number.
 */

/** `## [1.2.3] - 2026-08-24` or `## [Unreleased]`. */
const HEADING = /^## \[([^\]]+)\](?:\s*-\s*(.+))?\s*$/;
/** `### Added` */
const SECTION = /^### (.+?)\s*$/;
/** A top-level bullet. Captures the indent so nested lists can be rejected. */
const BULLET = /^(\s*)-\s+(.*)$/;
/** `[Unreleased]: https://...` link reference definitions at the foot. */
const LINK_REF = /^\[[^\]]+\]:\s*\S+\s*$/;
/** Strict `MAJOR.MINOR.PATCH` with an optional prerelease tail. */
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The heading text used for the section that is not yet released. */
export const UNRELEASED = 'Unreleased';

class ChangelogError extends Error {}

const fail = (line, msg) => {
  throw new ChangelogError(`CHANGELOG.md:${line}: ${msg}`);
};

/**
 * Parse the whole file.
 *
 * Returns `{ releases, unreleased }`, newest release first, where each release
 * is `{ version, date, sections: [{ heading, items }] }`. Bullet text keeps its
 * Markdown `**bold**` intact — the What's New panel renders it — and wrapped
 * continuation lines are joined with single spaces.
 */
export function parseChangelog(markdown) {
  const lines = markdown.split(/\r?\n/);

  const releases = [];
  let unreleased = null;
  /** The release currently being filled, or null while in the preamble. */
  let current = null;
  /** The `### ` section currently being filled. */
  let section = null;
  /** Index into `section.items` of the bullet still open for continuation. */
  let openItem = -1;

  const closeItem = () => {
    openItem = -1;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (!trimmed) {
      // A blank line ends a wrapped bullet but not the section.
      closeItem();
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      const [, name, date] = heading;
      closeItem();
      section = null;
      if (name === UNRELEASED) {
        if (date) fail(lineNo, `the [${UNRELEASED}] heading must not carry a date`);
        current = { version: UNRELEASED, date: '', sections: [] };
        unreleased = current;
        continue;
      }
      if (!date) fail(lineNo, `release [${name}] is missing its "- YYYY-MM-DD" date`);
      current = { version: name, date: date.trim(), sections: [] };
      releases.push(current);
      continue;
    }

    const sec = SECTION.exec(raw);
    if (sec) {
      if (!current) fail(lineNo, `"### ${sec[1]}" appears before any version heading`);
      closeItem();
      section = { heading: sec[1], items: [] };
      current.sections.push(section);
      continue;
    }

    // Everything below only matters inside a release; the preamble is prose.
    if (!current) continue;

    if (LINK_REF.test(trimmed)) {
      closeItem();
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      const [, indent, text] = bullet;
      if (indent.length > 0) {
        fail(
          lineNo,
          'nested list items are not supported — the patch-notes panel renders a flat ' +
            'list per section. Fold this into its parent bullet.',
        );
      }
      if (!section) {
        fail(lineNo, `a bullet under [${current.version}] is not inside a "### " section`);
      }
      section.items.push(text.trim());
      openItem = section.items.length - 1;
      continue;
    }

    // An indented, non-bullet, non-blank line continues the bullet above it.
    if (openItem >= 0 && section) {
      section.items[openItem] = `${section.items[openItem]} ${trimmed}`;
      continue;
    }

    fail(
      lineNo,
      `unrecognised line inside [${current.version}]: ${JSON.stringify(trimmed.slice(0, 60))}`,
    );
  }

  return { releases, unreleased };
}

/** Numeric triple for ordering. Prerelease tails do not participate. */
function triple(version, lineHint) {
  const m = SEMVER.exec(version);
  if (!m) {
    throw new ChangelogError(
      `CHANGELOG.md: "${version}"${lineHint} is not a valid semantic version (MAJOR.MINOR.PATCH).`,
    );
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * Enforce the three-way agreement that keeps the git tag, package.json and the
 * in-game notes from disagreeing. Throws with a message a human can act on.
 */
export function validateReleases(releases, packageVersion) {
  if (!releases.length) {
    throw new ChangelogError('CHANGELOG.md contains no released versions.');
  }

  for (const r of releases) {
    triple(r.version, ' in a "## [...]" heading');
    if (!ISO_DATE.test(r.date)) {
      throw new ChangelogError(
        `CHANGELOG.md: [${r.version}] has date "${r.date}" — expected ISO 8601 YYYY-MM-DD.`,
      );
    }
    const parsed = new Date(`${r.date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== r.date) {
      throw new ChangelogError(
        `CHANGELOG.md: [${r.version}] has date "${r.date}", not a real date.`,
      );
    }
    if (!r.sections.length) {
      throw new ChangelogError(
        `CHANGELOG.md: [${r.version}] has no "### " sections — a release with no notes is a mistake.`,
      );
    }
    for (const s of r.sections) {
      if (!s.items.length) {
        throw new ChangelogError(`CHANGELOG.md: [${r.version}] "### ${s.heading}" has no items.`);
      }
    }
  }

  for (let i = 1; i < releases.length; i++) {
    const prev = releases[i - 1];
    const next = releases[i];
    if (cmp(triple(prev.version, ''), triple(next.version, '')) <= 0) {
      throw new ChangelogError(
        `CHANGELOG.md: versions must be listed newest first and strictly descending, ` +
          `but [${prev.version}] is followed by [${next.version}].`,
      );
    }
  }

  const newest = releases[0].version;
  if (newest !== packageVersion) {
    throw new ChangelogError(
      `Version mismatch: CHANGELOG.md's newest release is [${newest}] but package.json says ` +
        `"${packageVersion}". The tag, the package version and the changelog must agree — ` +
        `see docs/RELEASING.md.`,
    );
  }
}

/**
 * The raw Markdown body of one version's section, without its `## [x]` heading.
 * Used verbatim as the GitHub Release body so the notes are written once.
 *
 * A section ends at the next `## [x]` heading — or, for the oldest release in
 * the file, at the `[Unreleased]: https://...` link-reference block at the foot.
 * Without that second terminator the oldest release's GitHub notes would end
 * with a stray compare URL.
 */
export function extractReleaseNotes(markdown, version) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let inside = false;
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      if (inside) break;
      inside = heading[1] === version;
      continue;
    }
    if (inside) {
      if (LINK_REF.test(line.trim())) break;
      out.push(line);
    }
  }
  if (!inside && !out.length) return null;
  return out.join('\n').trim();
}
