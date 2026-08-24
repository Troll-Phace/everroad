/**
 * Settings panel: audio, quality, fps counter, the session quit rows, save
 * export/import/reset, and the build badge. Reachable from gameplay and from
 * the main menu; rows that only make sense in one of the two are gated on
 * `runtime.appMode`, and the desktop-only quit on `isDesktop()`.
 *
 * Note on volumes: UIActions only exposes setAudioEnabled/setQuality, so the
 * music/sfx sliders mutate state.settings.musicVolume/sfxVolume directly —
 * the audio engine reads those live each update.
 */
import type { GameSettings, UIDeps } from '../types';
import { isDesktop } from '../version/version';
import { desktop } from '../version/desktop';
import { createBuildBadge } from './buildBadge';
import { armConfirm } from './confirm';
import { el } from './dom';
import type { Effects } from './effects';
import type { PanelDef, PanelManager } from './panels';
import type { ModeTransition } from './transition';

export function settingsPanel(
  deps: UIDeps,
  manager: PanelManager,
  effects: Effects,
  transition: ModeTransition,
): PanelDef {
  const { state, runtime, actions } = deps;

  function row(label: string, control: HTMLElement): HTMLElement {
    const r = el('div', 'settings-row');
    r.append(el('span', 'settings-label', label), control);
    return r;
  }

  return {
    id: 'settings',
    title: 'Settings',
    key: 'Esc',
    render(content) {
      // ---- audio ----------------------------------------------------------
      content.append(el('div', 'section-label', 'Audio'));

      const audioToggle = el('input');
      audioToggle.type = 'checkbox';
      audioToggle.className = 'toggle';
      audioToggle.checked = state.settings.audioEnabled;
      audioToggle.addEventListener('change', () => actions.setAudioEnabled(audioToggle.checked));
      content.append(row('Audio', audioToggle));

      const musicSlider = el('input');
      musicSlider.type = 'range';
      musicSlider.min = '0';
      musicSlider.max = '100';
      musicSlider.className = 'slider';
      musicSlider.value = String(Math.round(state.settings.musicVolume * 100));
      musicSlider.addEventListener('input', () => {
        state.settings.musicVolume = Number(musicSlider.value) / 100;
      });
      content.append(row('Music volume', musicSlider));

      const sfxSlider = el('input');
      sfxSlider.type = 'range';
      sfxSlider.min = '0';
      sfxSlider.max = '100';
      sfxSlider.className = 'slider';
      sfxSlider.value = String(Math.round(state.settings.sfxVolume * 100));
      sfxSlider.addEventListener('input', () => {
        state.settings.sfxVolume = Number(sfxSlider.value) / 100;
      });
      content.append(row('SFX volume', sfxSlider));

      // ---- graphics -------------------------------------------------------
      content.append(el('div', 'panel-divider'));
      content.append(el('div', 'section-label', 'Graphics'));

      const quality = el('select', 'select');
      for (const q of ['low', 'medium', 'high'] as const) {
        const opt = el('option', undefined, q[0].toUpperCase() + q.slice(1));
        opt.value = q;
        quality.append(opt);
      }
      quality.value = state.settings.quality;
      quality.addEventListener('change', () =>
        actions.setQuality(quality.value as GameSettings['quality']),
      );
      content.append(row('Quality', quality));

      const fpsToggle = el('input');
      fpsToggle.type = 'checkbox';
      fpsToggle.className = 'toggle';
      fpsToggle.checked = state.settings.showFps;
      fpsToggle.addEventListener('change', () => {
        state.settings.showFps = fpsToggle.checked;
      });
      content.append(row('Show FPS', fpsToggle));

      // ---- session --------------------------------------------------------
      // Quit to Main Menu is gameplay-only: on the menu it leads where the
      // player already is. Quit to Desktop is not — closing the app from the
      // title screen is the ordinary case for a desktop build — so the section
      // shows whenever either row has something to offer.
      const inGame = runtime.appMode === 'playing';
      if (inGame || isDesktop()) {
        content.append(el('div', 'panel-divider'));
        content.append(el('div', 'section-label', 'Session'));

        if (inGame) {
          const quitBtn = el('button', 'btn btn-big', 'Quit to Main Menu');
          // In the WEB build this is the only "quit" there is: a browser tab
          // cannot close itself, so quitting means saving and handing the world
          // back to the attract-mode menu. The desktop build adds the real one
          // below and keeps this as the way back to the title screen.
          const quitNote = el('div', 'settings-note', 'Saves your journey first.');
          quitBtn.addEventListener('click', () => {
            if (transition.busy) return;
            transition.run(() => {
              manager.close();
              actions.quitToMenu();
            });
          });
          content.append(quitBtn, quitNote);
        }

        if (isDesktop()) {
          const exitBtn = el('button', 'btn btn-big', 'Quit to Desktop');
          const exitNote = el(
            'div',
            'settings-note',
            inGame ? 'Saves your journey, then closes Everroad.' : 'Closes Everroad.',
          );
          // A plain button, not armConfirm: DESIGN_SYSTEM §4.2 reserves the
          // arm-and-confirm for actions that destroy something, and this one
          // destroys nothing — in gameplay it goes out through the same saving
          // path as Quit to Main Menu, and on the title screen there is no
          // session to lose in the first place.
          exitBtn.addEventListener('click', () => {
            if (transition.busy) return;
            // `quitToMenu` is the save path the UI is given; UIActions exposes
            // no bare save(). Gated on there being a session, since on the menu
            // it would reset the attract scene for the last frame before exit.
            if (runtime.appMode === 'playing') actions.quitToMenu();
            desktop()?.quit();
          });
          content.append(exitBtn, exitNote);
        }
      }

      // ---- save -----------------------------------------------------------
      content.append(el('div', 'panel-divider'));
      content.append(el('div', 'section-label', 'Save'));

      const exportArea = el('textarea', 'save-area hidden') as HTMLTextAreaElement;
      exportArea.readOnly = true;
      exportArea.rows = 3;
      exportArea.spellcheck = false;

      const exportRow = el('div', 'settings-btn-row');
      const exportBtn = el('button', 'btn btn-ghost', 'Export save');
      const copyBtn = el('button', 'btn btn-ghost hidden', 'Copy');
      exportBtn.addEventListener('click', () => {
        exportArea.value = actions.exportSave();
        exportArea.classList.remove('hidden');
        copyBtn.classList.remove('hidden');
        exportArea.select();
      });
      copyBtn.addEventListener('click', () => {
        exportArea.select();
        void navigator.clipboard?.writeText(exportArea.value).then(
          () => effects.toast({ icon: '📋', body: 'Save code copied' }),
          () => effects.toast({ icon: '⚠️', body: 'Copy failed — select and copy manually' }),
        );
      });
      exportRow.append(exportBtn, copyBtn);
      content.append(exportRow, exportArea);

      const importArea = el('textarea', 'save-area') as HTMLTextAreaElement;
      importArea.rows = 3;
      importArea.spellcheck = false;
      importArea.placeholder = 'Paste a save code here…';
      const importErr = el(
        'div',
        'settings-error hidden',
        'That code could not be read — it may be damaged, or from a newer version of the game.',
      );
      const importBtn = el('button', 'btn btn-ghost', 'Import save');
      importBtn.addEventListener('click', () => {
        const ok = actions.importSave(importArea.value.trim());
        importErr.classList.toggle('hidden', ok);
        if (ok) {
          importArea.value = '';
          effects.toast({ icon: '💾', body: 'Save imported' });
          // Controls above were built from the pre-import state; rebuild them.
          manager.refresh();
        }
      });
      content.append(importArea, importBtn, importErr);

      // ---- danger zone ----------------------------------------------------
      content.append(el('div', 'panel-divider'));
      const resetBtn = el('button', 'btn btn-ghost btn-danger-ghost', 'Reset save');
      armConfirm(resetBtn, {
        idle: 'Reset save',
        armed: 'Erase EVERYTHING? Click again',
        onConfirm: () => {
          actions.resetSave();
          // Re-render so the controls reflect the freshly reset settings.
          manager.refresh();
        },
      });
      content.append(resetBtn);

      // ---- build ----------------------------------------------------------
      // Last line in the panel, quiet and selectable: its whole job is to be
      // pasted into a bug report.
      content.append(el('div', 'panel-divider'));
      content.append(createBuildBadge('build-badge mono'));
    },
  };
}
