/**
 * Music bed: slowly evolving pad chords + occasional wind-chime melody notes.
 *
 * Pads: each chord is a cluster of detuned triangle+sine oscillator pairs fed
 * through a shared lowpass (with a slow LFO breathing the cutoff). Chord
 * changes overlap: the old chord releases over ~8 s while the new one swells
 * in over ~6 s, so the bed never hard-cuts. Biome changes are just a chord
 * change into the new palette with a ~5 s crossfade.
 */

import type { TimePhase } from '../types';
import type { BiomePalette } from './palettes';
import { midiToFreq, rand, rampTo } from './helpers';

interface PadChord {
  gain: GainNode;
  oscs: OscillatorNode[];
}

interface PhaseCfg {
  /** Pad lowpass base cutoff (Hz) — biome brightness nudges this. */
  cutoff: number;
  /** Pad output gain multiplier. */
  gain: number;
  /** Drop the top chord tone for a sparser night voicing. */
  sparse: boolean;
  /** Chime interval range [min, max] seconds and octave offset. */
  chimeMin: number;
  chimeMax: number;
  chimeOctave: number;
  chimeVol: number;
}

const PHASE_CFG: Record<TimePhase, PhaseCfg> = {
  dawn: {
    cutoff: 720,
    gain: 0.9,
    sparse: false,
    chimeMin: 8,
    chimeMax: 20,
    chimeOctave: 2,
    chimeVol: 0.045,
  },
  day: {
    cutoff: 920,
    gain: 1.0,
    sparse: false,
    chimeMin: 8,
    chimeMax: 20,
    chimeOctave: 2,
    chimeVol: 0.045,
  },
  sunset: {
    cutoff: 1250,
    gain: 1.15,
    sparse: false,
    chimeMin: 8,
    chimeMax: 18,
    chimeOctave: 2,
    chimeVol: 0.05,
  },
  // Night: darker filter, sparser voicing, and the chimes become soft
  // high "starlight" plinks arriving a little more often.
  night: {
    cutoff: 430,
    gain: 0.75,
    sparse: true,
    chimeMin: 6,
    chimeMax: 14,
    chimeOctave: 3,
    chimeVol: 0.03,
  },
};

/** Total pad level; individual notes are scaled down by voice count. */
const PAD_LEVEL = 0.14;

export interface MusicLayer {
  /** Crossfade into a new biome palette over `fadeSec` seconds. */
  setPalette(p: BiomePalette, fadeSec: number): void;
  setPhase(phase: TimePhase): void;
  /** Cheap per-frame tick: fires chord changes / chimes off the audio clock. */
  update(now: number): void;
  /** Frequency of a random note of the current scale, `octave` octaves above root. */
  randomScaleFreq(octave: number): number;
  /** Frequency of scale degree `deg` (wraps into higher octaves), `octave` octaves up. */
  scaleFreq(deg: number, octave: number): number;
  /** MIDI root of the current palette. */
  rootMidi(): number;
}

export function createMusicLayer(
  ctx: BaseAudioContext,
  out: AudioNode,
  initial: BiomePalette,
): MusicLayer {
  let palette = initial;
  let phase: TimePhase = 'day';
  let chordIdx = 0;
  let active: PadChord | null = null;
  let nextChordTime = 0;
  let nextChimeTime = 0;

  // --- pad chain: chords -> lowpass filter -> phase gain -> out -------------
  const padOut = ctx.createGain();
  padOut.gain.value = PHASE_CFG.day.gain;
  padOut.connect(out);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = PHASE_CFG.day.cutoff;
  filter.Q.value = 0.7;
  filter.connect(padOut);

  // Slow LFO breathing the cutoff (+/- ~140 Hz over ~16 s).
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.06;
  const lfoDepth = ctx.createGain();
  lfoDepth.gain.value = 140;
  lfo.connect(lfoDepth);
  lfoDepth.connect(filter.frequency);
  lfo.start();

  // --- chime chain: plinks -> (dry + feedback delay) -> out -----------------
  const chimeBus = ctx.createGain();
  chimeBus.gain.value = 1;
  const chimeDry = ctx.createGain();
  chimeDry.gain.value = 0.7;
  chimeBus.connect(chimeDry);
  chimeDry.connect(out);

  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = 0.42;
  const fbFilter = ctx.createBiquadFilter();
  fbFilter.type = 'lowpass';
  fbFilter.frequency.value = 2400;
  const fb = ctx.createGain();
  fb.gain.value = 0.34;
  const wet = ctx.createGain();
  wet.gain.value = 0.5;
  chimeBus.connect(delay);
  delay.connect(fbFilter);
  fbFilter.connect(fb);
  fb.connect(delay);
  delay.connect(wet);
  wet.connect(out);

  function phaseCfg(): PhaseCfg {
    return PHASE_CFG[phase];
  }

  function filterTarget(): number {
    // Biome brightness sweeps +/- ~35% around the phase cutoff.
    return phaseCfg().cutoff * (0.75 + palette.brightness * 0.7);
  }

  function spawnChord(attackSec: number): void {
    const now = ctx.currentTime;
    const cfg = phaseCfg();
    const offsets = palette.chords[chordIdx % palette.chords.length];
    const notes = cfg.sparse && offsets.length > 3 ? offsets.slice(0, offsets.length - 1) : offsets;

    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(filter);
    const oscs: OscillatorNode[] = [];

    // Soft sine sub an octave below the chord root for warmth.
    const bass = ctx.createOscillator();
    bass.type = 'sine';
    bass.frequency.value = midiToFreq(palette.root + notes[0] - 12);
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0.4;
    bass.connect(bassGain);
    bassGain.connect(g);
    bass.start();
    oscs.push(bass);

    const perNote = 1 / notes.length;
    for (const off of notes) {
      const f = midiToFreq(palette.root + off);
      // Detuned pair: triangle slightly flat, sine slightly sharp.
      const pair: Array<[OscillatorType, number, number]> = [
        ['triangle', rand(-6, -2), perNote],
        ['sine', rand(2, 6), perNote * 0.65],
      ];
      for (const [type, cents, vol] of pair) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = cents;
        const og = ctx.createGain();
        og.gain.value = vol;
        osc.connect(og);
        og.connect(g);
        osc.start();
        oscs.push(osc);
      }
    }

    rampTo(g.gain, PAD_LEVEL, attackSec, now);
    active = { gain: g, oscs };
  }

  function releaseChord(chord: PadChord, releaseSec: number): void {
    const now = ctx.currentTime;
    rampTo(chord.gain.gain, 0, releaseSec, now);
    const stopAt = now + releaseSec * 1.5 + 0.2;
    for (const o of chord.oscs) {
      try {
        o.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
  }

  function changeChord(releaseSec: number, attackSec: number): void {
    if (active) releaseChord(active, releaseSec);
    spawnChord(attackSec);
    nextChordTime = ctx.currentTime + rand(20, 30);
  }

  function scaleFreq(deg: number, octave: number): number {
    const s = palette.scale;
    const oct = Math.floor(deg / s.length);
    const idx = ((deg % s.length) + s.length) % s.length;
    return midiToFreq(palette.root + s[idx] + (oct + octave) * 12);
  }

  function playChime(now: number): void {
    const cfg = phaseCfg();
    const freq = scaleFreq((Math.random() * palette.scale.length) | 0, cfg.chimeOctave);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(cfg.chimeVol, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
    osc.connect(g);
    g.connect(chimeBus);
    osc.start(now);
    osc.stop(now + 1.5);
  }

  // Initial chord fades in gently.
  spawnChord(6);
  nextChordTime = ctx.currentTime + rand(20, 30);
  nextChimeTime = ctx.currentTime + rand(4, 10);

  return {
    setPalette(p: BiomePalette, fadeSec: number): void {
      palette = p;
      chordIdx = (Math.random() * p.chords.length) | 0;
      changeChord(fadeSec * 1.2, fadeSec);
      rampTo(filter.frequency, filterTarget(), 3, ctx.currentTime);
    },

    setPhase(p: TimePhase): void {
      phase = p;
      const now = ctx.currentTime;
      // Long, unhurried transitions — day fades like the sky does.
      rampTo(filter.frequency, filterTarget(), 6, now);
      rampTo(padOut.gain, phaseCfg().gain, 6, now);
    },

    update(now: number): void {
      if (now >= nextChordTime) {
        // Mostly walk the progression; sometimes sit on a chord's neighbor.
        chordIdx =
          Math.random() < 0.85
            ? (chordIdx + 1) % palette.chords.length
            : (Math.random() * palette.chords.length) | 0;
        changeChord(8, 6);
      }
      if (now >= nextChimeTime) {
        playChime(now);
        const cfg = phaseCfg();
        nextChimeTime = now + rand(cfg.chimeMin, cfg.chimeMax);
      }
    },

    randomScaleFreq(octave: number): number {
      return scaleFreq((Math.random() * palette.scale.length) | 0, octave);
    },

    scaleFreq,

    rootMidi(): number {
      return palette.root;
    },
  };
}
