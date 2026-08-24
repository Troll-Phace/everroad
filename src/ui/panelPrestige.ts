/**
 * Prestige panel: New Journey explanation, preview, and a two-step confirm.
 */
import type { UIDeps } from '../types';
import { formatNumber } from '../types';
import { el } from './dom';
import type { PanelDef, PanelManager } from './panels';

const CONFIRM_WINDOW_MS = 3000;

export function prestigePanel(deps: UIDeps, manager: PanelManager): PanelDef {
  const { state, actions } = deps;

  return {
    id: 'prestige',
    title: 'New Journey',
    key: 'P',
    render(content) {
      content.append(
        el(
          'p',
          'prestige-blurb',
          'Beginning a New Journey resets your coins, journey miles and car parts — ' +
            'but grants Horizon Tokens 🌅 based on how far you drove. Tokens buy ' +
            'permanent upgrades in the Horizon Shop. Your cars, relics and trophies ride along.',
        ),
      );

      const statRow = el('div', 'prestige-stats');
      const journeyStat = el('div', 'prestige-stat');
      journeyStat.append(el('div', 'prestige-stat-label', 'This journey'));
      const journeyVal = el('div', 'prestige-stat-value mono');
      journeyStat.append(journeyVal);
      const gainStat = el('div', 'prestige-stat');
      gainStat.append(el('div', 'prestige-stat-label', 'Tokens on prestige'));
      const gainVal = el('div', 'prestige-stat-value mono accent');
      gainStat.append(gainVal);
      statRow.append(journeyStat, gainStat);
      content.append(statRow);

      const track = el('div', 'progress-track');
      const fill = el('div', 'progress-fill');
      track.append(fill);
      const progressLabel = el('div', 'prestige-progress-label mono');
      content.append(track, progressLabel);

      const btn = el('button', 'btn btn-accent btn-big', 'BEGIN NEW JOURNEY');
      content.append(btn);

      let armed = false;
      let armTimer = 0;

      const disarm = (): void => {
        armed = false;
        window.clearTimeout(armTimer);
        btn.classList.remove('btn-danger');
        btn.textContent = 'BEGIN NEW JOURNEY';
      };

      btn.addEventListener('click', () => {
        if (!armed) {
          armed = true;
          btn.classList.add('btn-danger');
          btn.textContent = 'Are you sure? Parts & coins reset — click again';
          armTimer = window.setTimeout(disarm, CONFIRM_WINDOW_MS);
          return;
        }
        disarm();
        if (actions.prestige()) manager.refresh();
      });

      const update = (): void => {
        const preview = actions.getPrestigePreview();
        const miles = state.stats.journeyMiles;
        journeyVal.textContent = `${miles.toFixed(1)} mi`;
        gainVal.textContent = `+${formatNumber(preview.tokensOnPrestige)} 🌅`;
        const pct = preview.milesRequired > 0 ? Math.min(1, miles / preview.milesRequired) * 100 : 100;
        fill.style.width = `${pct}%`;
        progressLabel.textContent = preview.canPrestige
          ? 'Ready — the horizon calls.'
          : `${miles.toFixed(1)} / ${formatNumber(preview.milesRequired)} mi required`;
        if (!armed) btn.disabled = !preview.canPrestige;
      };
      update();
      return update;
    },
  };
}
