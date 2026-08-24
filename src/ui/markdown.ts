/**
 * The sliver of Markdown the patch-notes surfaces render.
 *
 * Shared by the What's New panel (which reads the generated changelog module)
 * and the Update panel (which reads a release body straight off the update
 * feed). Both are the same text: `scripts/release-notes.mjs` extracts a
 * release's CHANGELOG section as the GitHub release body, so the two paths
 * render one format.
 */

/**
 * Render `text` into `parent`, turning `**bold**` into `<strong>` and leaving
 * every other character literal.
 *
 * Built node by node out of text nodes — never `innerHTML`. That mattered when
 * the only caller read repository content; it matters more now that the Update
 * panel renders a string fetched over the network. A rendering path that parses
 * markup is a rendering path that can be made to parse the wrong markup, and
 * this one has no reason to exist.
 */
export function appendInline(parent: HTMLElement, text: string): void {
  const bold = /\*\*(.+?)\*\*/g;
  let at = 0;
  for (let m = bold.exec(text); m !== null; m = bold.exec(text)) {
    if (m.index > at) parent.append(document.createTextNode(text.slice(at, m.index)));
    const strong = document.createElement('strong');
    strong.className = 'whatsnew-strong';
    strong.textContent = m[1];
    parent.append(strong);
    at = m.index + m[0].length;
  }
  // Anything after the last pair — including an unmatched `**`, which stays
  // literal rather than being guessed at.
  if (at < text.length) parent.append(document.createTextNode(text.slice(at)));
}

/** One parsed block of a release body: a `### ` heading and its bullets. */
export interface NotesSection {
  heading: string;
  items: string[];
}

/**
 * Parse a release body into sections.
 *
 * Deliberately forgiving where `scripts/build-changelog.mjs` is strict, and for
 * the opposite reason. That parser guards a build: anything it does not
 * recognise should stop the release. This one renders a string that arrived
 * from the network at runtime, where the only alternative to shrugging is an
 * exception on the path that tells the player an update exists. Bullets before
 * any heading collect under an empty one; unrecognised lines are dropped;
 * wrapped lines are joined onto the bullet above them.
 */
export function parseNotes(body: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let current: NotesSection | null = null;

  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      current = { heading: heading[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (!current) {
        current = { heading: '', items: [] };
        sections.push(current);
      }
      current.items.push(bullet[1].trim());
      continue;
    }
    // A continuation of the bullet above: CHANGELOG.md wraps at 80 columns, so
    // most bullets arrive as several lines.
    const indented = line.trim();
    if (indented && current && current.items.length > 0 && /^\s/.test(line)) {
      current.items[current.items.length - 1] += ` ${indented}`;
    }
  }

  return sections.filter((s) => s.items.length > 0 || s.heading !== '');
}
