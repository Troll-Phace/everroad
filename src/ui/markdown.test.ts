import { describe, expect, it } from 'vitest';
import { parseNotes } from './markdown';

describe('parseNotes', () => {
  it('splits a release body into its headings and bullets', () => {
    const sections = parseNotes(
      ['### Added', '', '- A thing', '- Another thing', '', '### Fixed', '', '- A fix'].join('\n'),
    );
    expect(sections).toEqual([
      { heading: 'Added', items: ['A thing', 'Another thing'] },
      { heading: 'Fixed', items: ['A fix'] },
    ]);
  });

  it('rejoins bullets that CHANGELOG.md wrapped at 80 columns', () => {
    const sections = parseNotes(
      ['### Added', '- The first half of a', '  wrapped bullet'].join('\n'),
    );
    expect(sections[0].items).toEqual(['The first half of a wrapped bullet']);
  });

  it('keeps bullets that appear before any heading', () => {
    expect(parseNotes('- Loose bullet')).toEqual([{ heading: '', items: ['Loose bullet'] }]);
  });

  it('shrugs at a body it cannot parse rather than throwing', () => {
    // The update panel renders a string fetched at runtime; the alternative to
    // shrugging is an exception on the path that tells the player an update
    // exists.
    expect(() => parseNotes('just some prose\n\nand more of it')).not.toThrow();
    expect(parseNotes('just some prose')).toEqual([]);
  });

  it('is empty for an empty body', () => {
    expect(parseNotes('')).toEqual([]);
  });
});
