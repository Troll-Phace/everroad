/**
 * Settings panel: audio, quality, fps counter, quit to menu, and save
 * export/import/reset. Reachable from gameplay and from the main menu; rows
 * that only make sense in one of the two are gated on `runtime.appMode`.
 *
 * Note on volumes: UIActions only exposes setAudioEnabled/setQuality, so the
 * music/sfx sliders mutate state.settings.musicVolume/sfxVolume directly —
 * the audio engine reads those live each update.
 */
import type { GameSettings, UIDeps } from '../types';
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

      // ---- quit to menu ---------------------------------------------------
      // Only meaningful in gameplay: the menu is already where this leads.
      if (runtime.appMode === 'playing') {
        content.append(el('div', 'panel-divider'));
        content.append(el('div', 'section-label', 'Session'));

        const quitBtn = el('button', 'btn btn-big', 'Quit to Main Menu');
        // A browser tab cannot close itself, so "quit" means exactly this:
        // save, then hand the world back to the attract-mode menu.
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
    },
  };
}
