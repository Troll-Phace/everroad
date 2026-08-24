/**
 * The save-compatibility decision, which is the part of the updater that can
 * cost a player their journey if it is wrong.
 *
 * `src/ui/update.ts` resolves its bridge at module load and finds none under
 * vitest, so these exercise the pure decision with explicit statuses rather
 * than through a mocked Electron.
 */
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from '../types';
import type { UpdateStatus } from '../version/desktop';
import { saveImpact, updateOffered, updatesSupported } from './update';

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: 'available',
    delivery: 'manual',
    version: '9.9.9',
    notes: null,
    progress: 0,
    fileName: null,
    saveVersion: null,
    checkedAt: null,
    error: null,
    ...patch,
  };
}

describe('saveImpact', () => {
  it('warns when the offered release raises the save format', () => {
    expect(saveImpact(status({ saveVersion: SAVE_VERSION + 1 }))).toBe('breaking');
  });

  it('is safe when the offered release uses the same save format', () => {
    expect(saveImpact(status({ saveVersion: SAVE_VERSION }))).toBe('safe');
  });

  it('is safe when the offered release uses an older save format', () => {
    expect(saveImpact(status({ saveVersion: SAVE_VERSION - 1 }))).toBe('safe');
  });

  it('reports unknown — never safe — when the release says nothing', () => {
    // A release cut before release-meta.json existed carries no save version.
    // Treating that as "safe" would be a warning nobody can rely on.
    expect(saveImpact(status({ saveVersion: null }))).toBe('unknown');
  });
});

describe('updateOffered', () => {
  it('is true once a version has been found', () => {
    expect(updateOffered(status({ phase: 'available' }))).toBe(true);
    expect(updateOffered(status({ phase: 'downloading' }))).toBe(true);
    expect(updateOffered(status({ phase: 'ready' }))).toBe(true);
  });

  it('is false before and during a check, and when up to date', () => {
    expect(updateOffered(status({ phase: 'idle', version: null }))).toBe(false);
    expect(updateOffered(status({ phase: 'checking', version: null }))).toBe(false);
    expect(updateOffered(status({ phase: 'none', version: null }))).toBe(false);
  });

  it('is false when a phase implies a version that is not there', () => {
    expect(updateOffered(status({ phase: 'available', version: null }))).toBe(false);
  });
});

describe('updatesSupported', () => {
  it('is false with no Electron bridge — the web build pays for none of this', () => {
    expect(updatesSupported()).toBe(false);
  });
});
