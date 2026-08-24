/**
 * Update panel: what is available, what it costs you, and the button that gets
 * it.
 *
 * Desktop only — `updatesSupported()` is false in the browser, where a page
 * cannot replace itself and the menu never offers the panel. Everything the
 * card knows arrives through `src/ui/update.ts`; it performs no check of its
 * own and reads no state from the game.
 *
 * The card is rebuilt from scratch on each status change rather than mutated in
 * place. The phases differ by more than their text — Download becomes Restart,
 * a progress bar appears, the warning banner turns from unknown to breaking —
 * and a set of `hidden` toggles across seven phases is exactly the kind of
 * partial state machine that ships a Download button next to a finished
 * download.
 */
import { SAVE_VERSION } from '../types';
import { APP_VERSION } from '../version/version';
import type { UpdateStatus } from '../version/desktop';
import { el } from './dom';
import { appendInline, parseNotes } from './markdown';
import type { PanelDef } from './panels';
import {
  current,
  installUpdate,
  openReleasePage,
  revealDownload,
  saveImpact,
  startDownload,
  updateOffered,
} from './update';

/** Panel id, also the value written to `document.body.dataset.panel`. */
export const UPDATE_PANEL_ID = 'update';

/**
 * The save-format warning.
 *
 * The wording is exact about one thing that is easy to get wrong: an update
 * does *not* wipe your save. The desktop app keeps the same appId, so it reads
 * the same storage, and every release so far has loaded the previous one's
 * journey untouched. The risk is narrower and worth naming precisely — a
 * release that raises `SAVE_VERSION` may not be able to read the old shape, and
 * once the new build autosaves, the old shape is gone. `loadGame`'s
 * newer-save-parking (src/save/save.ts) protects a *downgrade*; it cannot
 * protect the save that the upgrade already overwrote. So the advice is to
 * export, and it is stated as the thing that actually survives.
 */
function saveBanner(status: UpdateStatus): HTMLElement | null {
  const impact = saveImpact(status);
  if (impact === 'safe') return null;

  const banner = el('div', `update-banner update-banner-${impact}`);
  banner.setAttribute('role', 'note');

  if (impact === 'breaking') {
    banner.append(el('div', 'update-banner-title', 'This update changes the save format'));
    banner.append(
      el(
        'p',
        'update-banner-body',
        `Your journey is stored in the save format this build uses (v${SAVE_VERSION}); ` +
          `v${status.version} uses v${status.saveVersion}. It may not carry over, and once ` +
          'the new build saves once, the old copy is gone.',
      ),
    );
    banner.append(
      el(
        'p',
        'update-banner-body',
        'Copy your save code from Settings first. That copy is the one that survives either way.',
      ),
    );
  } else {
    banner.append(el('div', 'update-banner-title', 'Save compatibility unknown'));
    banner.append(
      el(
        'p',
        'update-banner-body',
        `v${status.version} does not say which save format it uses — releases from before ` +
          'this check existed do not carry that note. Copying your save code from Settings ' +
          'before you update costs nothing.',
      ),
    );
  }
  return banner;
}

/** How the update lands, said plainly rather than implied by which button appears. */
function deliveryNote(status: UpdateStatus): string {
  if (status.delivery === 'in-place') {
    return 'Everroad will download the update and restart into the installer.';
  }
  return (
    'This build cannot replace itself, so Everroad will download the update to your ' +
    'Downloads folder and open it for you to install.'
  );
}

/** The release body, rendered as the What’s New panel renders a changelog section. */
function notesBlock(notes: string): HTMLElement | null {
  const sections = parseNotes(notes);
  if (sections.length === 0) return null;
  const wrap = el('div', 'update-notes');
  for (const section of sections) {
    if (section.heading) wrap.append(el('div', 'section-label', section.heading));
    const list = el('ul', 'release-items');
    for (const item of section.items) {
      const li = el('li');
      appendInline(li, item);
      list.append(li);
    }
    wrap.append(list);
  }
  return wrap;
}

/** The shared `.progress-track` recipe, given a progressbar role. */
function progressBar(fraction: number): HTMLElement {
  const track = el('div', 'progress-track update-progress');
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', '100');
  track.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  const fill = el('div', 'progress-fill');
  fill.style.width = `${Math.round(fraction * 100)}%`;
  track.append(fill);
  return track;
}

function render(content: HTMLElement, status: UpdateStatus): void {
  content.replaceChildren();

  content.append(el('div', 'update-current mono', `You are running v${APP_VERSION}`));

  // ---- nothing to offer ---------------------------------------------------
  if (!updateOffered(status)) {
    if (status.phase === 'checking') {
      content.append(el('p', 'update-lead', 'Looking for a newer release…'));
    } else if (status.phase === 'error') {
      content.append(el('p', 'update-lead', status.error ?? 'The update check failed.'));
    } else {
      content.append(el('p', 'update-lead', 'Everroad is up to date.'));
    }
    return;
  }

  content.append(el('h3', 'update-version', `Everroad v${status.version}`));

  const banner = saveBanner(status);
  if (banner) content.append(banner);

  content.append(el('p', 'update-lead', deliveryNote(status)));

  if (status.notes) {
    const notes = notesBlock(status.notes);
    if (notes) content.append(notes);
  }

  // ---- actions ------------------------------------------------------------
  const actions = el('div', 'update-actions');

  if (status.phase === 'available' || status.phase === 'error') {
    const download = el('button', 'btn btn-big is-primary', 'Download update');
    download.type = 'button';
    download.addEventListener('click', () => startDownload());
    actions.append(download);
  }

  if (status.phase === 'downloading') {
    const pct = Math.round(status.progress * 100);
    content.append(progressBar(status.progress));
    content.append(
      el(
        'div',
        'update-progress-label mono',
        status.fileName ? `${status.fileName} · ${pct}%` : `Downloading… ${pct}%`,
      ),
    );
  }

  if (status.phase === 'ready') {
    if (status.delivery === 'in-place') {
      const install = el('button', 'btn btn-big is-primary', 'Restart & install');
      install.type = 'button';
      install.addEventListener('click', () => installUpdate());
      actions.append(install);
      content.append(
        el('p', 'settings-note', 'Everroad will close, install the update, and reopen.'),
      );
    } else {
      const show = el('button', 'btn btn-big is-primary', 'Show in Downloads');
      show.type = 'button';
      show.addEventListener('click', () => revealDownload());
      actions.append(show);
      content.append(
        el(
          'p',
          'settings-note',
          status.fileName
            ? `${status.fileName} is in your Downloads folder. Open it to finish the update.`
            : 'The download is in your Downloads folder. Open it to finish the update.',
        ),
      );
    }
  }

  // Always available once a version is known: the artifact the feed names is
  // not the only one published, and someone on the RPM or the portable build
  // may want the one that matches how they installed.
  const page = el('button', 'btn btn-ghost', 'Other downloads…');
  page.type = 'button';
  page.addEventListener('click', () => openReleasePage());
  actions.append(page);

  content.append(actions);

  if (status.phase === 'error' && status.error) {
    content.append(el('p', 'update-error', status.error));
  }
}

export function updatePanel(): PanelDef {
  return {
    id: UPDATE_PANEL_ID,
    title: 'Update Available',
    // No hotkey of its own. `U` is Upgrades, and the panel has exactly one way
    // in — the menu row that appears when there is something to say. 'Esc' is
    // the idiom panels.ts reads as "no second hint to draw" (Settings does the
    // same); the card is still dismissed with Esc like every other.
    key: 'Esc',
    render(content) {
      let shown: UpdateStatus | null = null;
      // The panel manager's cheap updater, rather than a subscription: PanelDef
      // has no teardown hook, so a subscription taken here would outlive the
      // card. Re-rendering is gated on the status object actually changing —
      // main sends a fresh object per change — so this idles at one identity
      // comparison four times a second.
      return () => {
        const status = current();
        if (status === shown) return;
        shown = status;
        render(content, status);
      };
    },
  };
}
