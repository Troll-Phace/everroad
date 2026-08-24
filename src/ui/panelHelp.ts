/**
 * Help panel: controls table + a short "how it works" primer.
 * Shown automatically once for brand-new saves.
 */
import { el } from './dom';
import type { PanelDef } from './panels';

const CONTROLS: Array<[string, string]> = [
  ['W A S D / Arrows', 'Take the wheel — steer; W/S nudge speed'],
  ['Shift (hold)', 'Drift while steering — builds combo'],
  ['G', 'Garage'],
  ['U', 'Upgrades'],
  ['T', 'Trophies'],
  ['P', 'New Journey (prestige)'],
  ['M', 'Mute audio'],
  ['H', 'This help'],
  ['N', "What's New — the patch notes for this build"],
  ['Esc', 'Close panel / settings'],
];

export function helpPanel(): PanelDef {
  return {
    id: 'help',
    title: 'How to drive',
    key: 'H',
    render(content) {
      content.append(
        el(
          'p',
          'help-blurb',
          'Everroad drives itself — coins accrue every mile, even while you are away. ' +
            'Take the wheel to weave through coin lines, drift, and shave past hay bales ' +
            'for a combo multiplier that pays out fast. When your journey has gone far ' +
            'enough, begin a New Journey to earn Horizon Tokens and grow permanently stronger.',
        ),
      );

      const table = el('table', 'help-table');
      const tbody = el('tbody');
      for (const [key, desc] of CONTROLS) {
        const tr = el('tr');
        const kcell = el('td', 'help-key');
        kcell.append(el('span', 'key-hint', key));
        const dcell = el('td', 'help-desc', desc);
        tr.append(kcell, dcell);
        tbody.append(tr);
      }
      table.append(tbody);
      content.append(table);
    },
  };
}
