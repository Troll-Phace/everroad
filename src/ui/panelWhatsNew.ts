/**
 * What's New panel: the full patch notes, newest release first.
 *
 * Content comes from `src/version/changelog.generated.ts`, which `npm run
 * changelog` parses out of CHANGELOG.md — the panel renders whatever is there
 * and knows nothing about how it was produced.
 *
 * Reachable from the main menu's corner button and from the `N` hotkey in both
 * app modes; unlike the gameplay panels it describes the *build*, not the
 * journey, so it has nothing to say that depends on a session existing.
 *
 * Releases are disclosure sections rather than `<details>`/`<summary>`: the
 * panel's focus trap (panels.ts `FOCUSABLE`) matches buttons, inputs and
 * explicit tabindex, and a bare `<summary>` is focusable without matching any
 * of them — it would be a tab stop the trap cannot see, which is exactly the
 * hole the trap exists to close.
 */
import { APP_VERSION } from '../version/version';
import { CHANGELOG } from '../version/changelog.generated';
import type { ChangelogRelease } from '../version/changelog.generated';
import { el } from './dom';
import { appendInline } from './markdown';
import type { PanelDef } from './panels';

/** Panel id, also the value written to `document.body.dataset.panel`. */
export const WHATS_NEW_PANEL_ID = 'whatsnew';

/** localStorage key for the last version whose notes were opened. See `markSeen`. */
const SEEN_KEY = 'everroad-seen-version';

/** One release: a disclosure button plus the body it controls. */
function releaseBlock(release: ChangelogRelease, index: number, expanded: boolean): HTMLElement {
  const block = el('div', 'release');
  const bodyId = `whatsnew-release-${index}`;

  const toggle = el('button', 'btn btn-ghost release-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-controls', bodyId);
  const caret = el('span', 'release-caret', '▸');
  caret.setAttribute('aria-hidden', 'true');
  const version = el('span', 'release-version mono', `v${release.version}`);
  const date = el('span', 'release-date mono', release.date);
  toggle.append(caret, version, date);

  const body = el('div', 'release-body');
  body.id = bodyId;
  if (!expanded) body.classList.add('hidden');

  for (const section of release.sections) {
    body.append(el('div', 'section-label', section.heading));
    const list = el('ul', 'release-items');
    for (const item of section.items) {
      const li = el('li');
      appendInline(li, item);
      list.append(li);
    }
    body.append(list);
  }
  if (release.sections.length === 0) {
    body.append(el('p', 'whatsnew-empty', 'No notes were recorded for this release.'));
  }

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    // `.hidden` is `display: none`, which is also what keeps anything inside a
    // collapsed release out of the panel's focus trap (it filters on
    // `offsetParent`).
    body.classList.toggle('hidden', open);
  });

  block.append(toggle, body);
  return block;
}

/**
 * True when this build's notes have not been opened yet — drives the small dot
 * on the menu's What's New button.
 *
 * Deliberately its own localStorage key, disjoint from the save system's
 * `everroad-save-v1` namespace (src/save/save.ts): the UI does not read or
 * write the save, and losing this flag costs the player one redundant dot.
 * Storage can throw (private browsing, disabled cookies), and a missing dot is
 * never worth an exception on the boot path.
 */
export function hasUnseenRelease(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== APP_VERSION;
  } catch {
    return false;
  }
}

/** Record this build's notes as read. Failure is silent, by the same reasoning. */
export function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, APP_VERSION);
  } catch {
    /* storage unavailable — the dot simply comes back next launch */
  }
}

export function whatsNewPanel(): PanelDef {
  return {
    id: WHATS_NEW_PANEL_ID,
    title: "What's New",
    key: 'N',
    render(content) {
      markSeen();

      if (CHANGELOG.length === 0) {
        content.append(el('p', 'whatsnew-empty', 'No release notes are available for this build.'));
        return;
      }

      // Newest first, as CHANGELOG orders it; only the newest opens expanded so
      // the panel starts on what the player came to read.
      CHANGELOG.forEach((release, i) => {
        content.append(releaseBlock(release, i, i === 0));
      });
    },
  };
}
