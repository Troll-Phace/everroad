/**
 * Settings panel: audio, quality, fps counter, save export/import/reset.
 *
 * Note on volumes: UIActions only exposes setAudioEnabled/setQuality, so the
 * music/sfx sliders mutate state.settings.musicVolume/sfxVolume directly —
 * the audio engine reads those live each update.
 */
import type { GameSettings, UIDeps } from '../types';
import { el } from './dom';
import type { Effects } from './effects';
import type { PanelDef, PanelManager } from './panels';

const CONFIRM_WINDOW_MS = 3000;

export function settingsPanel(deps: UIDeps, manager: PanelManager, effects: Effects): PanelDef {
  const { state, actions } = deps;

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
      const importErr = el('div', 'settings-error hidden', 'That code could not be read.');
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
      let armed = false;
      let armTimer = 0;
      resetBtn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          resetBtn.textContent = 'Erase EVERYTHING? Click again';
          resetBtn.classList.add('btn-danger');
          armTimer = window.setTimeout(() => {
            armed = false;
            resetBtn.textContent = 'Reset save';
            resetBtn.classList.remove('btn-danger');
          }, CONFIRM_WINDOW_MS);
          return;
        }
        window.clearTimeout(armTimer);
        actions.resetSave();
        // Re-render so the controls reflect the freshly reset settings.
        manager.refresh();
      });
      content.append(resetBtn);
    },
  };
}
