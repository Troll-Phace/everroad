/**
 * Per-biome musical palettes for Everroad's generative score.
 *
 * Each biome gets a key/mode chosen for its mood. Chords are expressed as
 * semitone offsets from `root` (a MIDI note in the C2–E3 region so pads sit
 * warm and low); the melody `scale` is one octave of intervals used for
 * wind-chime notes, coin plinks, and arpeggios so every one-shot lands in key.
 */

import type { BiomeId } from '../types';

export interface BiomePalette {
  /** Tonal center as a MIDI note (pads voice around this). */
  root: number;
  /** Melody scale: semitone intervals within one octave, ascending from root. */
  scale: number[];
  /** Chord progression; each chord is semitone offsets from `root` (low→high). */
  chords: number[][];
  /** Brightness bias 0..1 — nudges the pad lowpass cutoff per biome. */
  brightness: number;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MAJOR_PENT = [0, 2, 4, 7, 9];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const LYDIAN = [0, 2, 4, 6, 7, 9, 11];
const MINOR_PENT = [0, 3, 5, 7, 10];
const SUS_PENT = [0, 2, 5, 7, 9];

export const PALETTES: Record<BiomeId, BiomePalette> = {
  // Emerald Meadows — warm, open C major. Cmaj7 / Fmaj7 / Am7 / G(add9).
  meadow: {
    root: 48, // C3
    scale: MAJOR,
    chords: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [-3, 0, 4, 7],
      [7, 11, 14, 21],
    ],
    brightness: 0.55,
  },

  // Amber Farmland — folksy D major, plain triads with an added 2nd.
  // D(add9) / G(add9) / D / A7.
  farmland: {
    root: 50, // D3
    scale: MAJOR,
    chords: [
      [0, 4, 7, 14],
      [5, 9, 12, 16],
      [0, 4, 7, 12],
      [7, 11, 14, 17],
    ],
    brightness: 0.6,
  },

  // Sunflower Coast — sunny E major, bright register.
  // E(add9) / A(add9) / C#m7 / B7.
  sunflower: {
    root: 52, // E3
    scale: MAJOR_PENT,
    chords: [
      [0, 4, 7, 14],
      [5, 9, 12, 19],
      [9, 12, 16, 19],
      [7, 11, 14, 17],
    ],
    brightness: 0.7,
  },

  // Emberwood (HERO) — nostalgic G mixolydian warmth.
  // G(add9) / Fmaj7 / C(add9) / Dm7 — the bVII gives that amber glow.
  autumn: {
    root: 43, // G2
    scale: MIXOLYDIAN,
    chords: [
      [0, 4, 7, 14],
      [-2, 2, 5, 9],
      [5, 9, 12, 19],
      [7, 10, 14, 17],
    ],
    brightness: 0.5,
  },

  // Mistpine Hills — cool E minor. Em(add9) / Cmaj7 / G / Am7.
  pine: {
    root: 40, // E2
    scale: MINOR_PENT,
    chords: [
      [0, 3, 7, 14],
      [8, 12, 15, 19],
      [3, 7, 10, 15],
      [5, 8, 12, 15],
    ],
    brightness: 0.35,
  },

  // Lavender Reach — dreamy F lydian. Fmaj7(#11) / Cmaj7 / G/F-color / Em7.
  lavender: {
    root: 41, // F2
    scale: LYDIAN,
    chords: [
      [0, 4, 11, 18],
      [7, 11, 14, 18],
      [2, 6, 9, 16],
      [11, 14, 18, 21],
    ],
    brightness: 0.45,
  },

  // Blossom Vale — bright A major pentatonic. A(add9) / F#m7 / D(add9) / E(add9).
  cherry: {
    root: 45, // A2
    scale: MAJOR_PENT,
    chords: [
      [0, 4, 7, 14],
      [-3, 0, 4, 7],
      [5, 9, 12, 19],
      [7, 11, 14, 21],
    ],
    brightness: 0.65,
  },

  // Dawnmarsh — airy suspended D. Dsus2 / Csus4-color / Gsus2 / Asus4.
  wetland: {
    root: 50, // D3
    scale: SUS_PENT,
    chords: [
      [0, 5, 7, 14],
      [-2, 3, 5, 10],
      [5, 7, 12, 17],
      [7, 12, 14, 19],
    ],
    brightness: 0.42,
  },
};
