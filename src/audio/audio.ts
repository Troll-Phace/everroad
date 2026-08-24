/**
 * Everroad audio engine — fully generative Web Audio, no assets, no DOM.
 *
 * Node graph (see docs/AUDIO.md for details):
 *
 *   music layers ─▶ musicBus ─┐
 *                             ├─▶ master ─▶ compressor ─▶ destination
 *   sfx layers ───▶ sfxBus ───┘
 *
 * The AudioContext is NOT constructed until start() (first user gesture).
 * Every public method is a safe no-op before start(), while disabled, and if
 * audio construction failed — an audio problem must never crash the game.
 */

import type { AudioEngine, BiomeId, TimePhase, WeatherId } from '../types';
import { PALETTES } from './palettes';
import { clamp, createNoiseBuffer, midiToFreq, rampTo } from './helpers';
import { createMusicLayer, type MusicLayer } from './music';
import { createEngineLayer, type EngineLayer } from './engineSound';
import { createNatureLayer, type NatureLayer } from './nature';
import { createSfx, type SfxKit } from './sfx';

interface Mood {
  biomeId: BiomeId;
  timePhase: TimePhase;
  weatherId: WeatherId;
  speedMph: number;
  isDrifting: boolean;
}

/** How long setEnabled(false) takes to fade out before we suspend the context. */
const DISABLE_FADE_SEC = 0.5;
/** Crossfade length when the biome (and therefore the palette) changes. */
const BIOME_FADE_SEC = 5;

export function createAudioEngine(): AudioEngine {
  // --- state that exists before/without a context --------------------------
  let ctx: AudioContext | null = null;
  let started = false;
  let failed = false;
  let enabled = true;
  let musicVol = 0.8;
  let sfxVol = 0.8;
  /** ctx.currentTime at which we were disabled; used to suspend after the fade. */
  let disabledAt = -1;

  // --- graph + layers (built in start()) -----------------------------------
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let music: MusicLayer | null = null;
  let engine: EngineLayer | null = null;
  let nature: NatureLayer | null = null;
  let sfx: SfxKit | null = null;

  // Last-applied mood pieces, so changes are detected even across a
  // disabled/suspended gap.
  let curBiome: BiomeId = 'meadow';
  let lastAppliedBiome: BiomeId | null = null;
  let lastAppliedPhase: TimePhase | null = null;

  /** Perceptual-ish volume curve. */
  function volCurve(v: number): number {
    const c = clamp(v, 0, 1);
    return c * c;
  }

  function applyVolumes(): void {
    if (!ctx || !musicBus || !sfxBus) return;
    const now = ctx.currentTime;
    rampTo(musicBus.gain, volCurve(musicVol), 0.15, now);
    rampTo(sfxBus.gain, volCurve(sfxVol), 0.15, now);
  }

  function shimmerFreqs(): [number, number] {
    // Root + fifth, three octaves up — consonant with every chord in the key.
    const root = PALETTES[curBiome].root;
    return [midiToFreq(root + 36), midiToFreq(root + 43)];
  }

  function build(): void {
    const AC: typeof AudioContext | undefined =
      typeof window !== 'undefined'
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) {
      failed = true;
      return;
    }
    ctx = new AC();

    // Master chain: buses -> master -> soft glue compressor -> speakers.
    master = ctx.createGain();
    master.gain.value = 0; // gentle fade-in below
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.3;
    master.connect(comp);
    comp.connect(ctx.destination);

    musicBus = ctx.createGain();
    musicBus.gain.value = volCurve(musicVol);
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = volCurve(sfxVol);
    sfxBus.connect(master);

    const buffers = {
      white: createNoiseBuffer(ctx, 'white'),
      pink: createNoiseBuffer(ctx, 'pink'),
      brown: createNoiseBuffer(ctx, 'brown'),
    };

    music = createMusicLayer(ctx, musicBus, PALETTES[curBiome]);
    lastAppliedBiome = curBiome;
    engine = createEngineLayer(ctx, sfxBus, buffers);
    nature = createNatureLayer(ctx, sfxBus, musicBus, buffers, shimmerFreqs);
    sfx = createSfx(ctx, sfxBus, buffers.white);

    if (enabled) {
      rampTo(master.gain, 1, 1.5, ctx.currentTime);
    }
  }

  /** Ready to make (or schedule) sound right now? */
  function ready(): boolean {
    return started && !failed && !!ctx;
  }

  function readyForSfx(): boolean {
    return ready() && enabled && !!sfx && !!music && ctx!.state === 'running';
  }

  return {
    start(): void {
      if (started || failed) return;
      try {
        build();
        if (failed) return;
        started = true;
        // Some browsers hand us a suspended context even inside a gesture.
        void ctx?.resume?.().catch?.(() => undefined);
      } catch {
        failed = true;
        try {
          void ctx?.close();
        } catch {
          /* ignore */
        }
        ctx = null;
      }
    },

    setEnabled(b: boolean): void {
      enabled = b;
      if (!ready() || !master || !ctx) return;
      try {
        const now = ctx.currentTime;
        if (b) {
          disabledAt = -1;
          void ctx.resume?.().catch?.(() => undefined);
          rampTo(master.gain, 1, DISABLE_FADE_SEC, now);
        } else {
          // Ramp down over ~0.5 s; update() suspends the context after the
          // tail so we never cut audio abruptly.
          rampTo(master.gain, 0, DISABLE_FADE_SEC, now);
          disabledAt = now;
        }
      } catch {
        /* never crash the game over audio */
      }
    },

    setMusicVolume(v: number): void {
      musicVol = clamp(v, 0, 1);
      try {
        applyVolumes();
      } catch {
        /* ignore */
      }
    },

    setSfxVolume(v: number): void {
      sfxVol = clamp(v, 0, 1);
      try {
        applyVolumes();
      } catch {
        /* ignore */
      }
    },

    update(mood: Mood): void {
      curBiome = mood.biomeId;
      if (!ready() || !ctx || !music || !engine || !nature) return;
      try {
        if (!enabled) {
          // After the disable fade finishes, park the context to save CPU.
          if (
            disabledAt >= 0 &&
            ctx.state === 'running' &&
            ctx.currentTime > disabledAt + DISABLE_FADE_SEC + 0.3
          ) {
            void ctx.suspend?.().catch?.(() => undefined);
          }
          return;
        }
        if (ctx.state !== 'running') return; // resume still pending

        const now = ctx.currentTime;

        if (mood.biomeId !== lastAppliedBiome) {
          lastAppliedBiome = mood.biomeId;
          music.setPalette(PALETTES[mood.biomeId], BIOME_FADE_SEC);
        }
        if (mood.timePhase !== lastAppliedPhase) {
          lastAppliedPhase = mood.timePhase;
          music.setPhase(mood.timePhase);
        }

        music.update(now);
        engine.update(mood.speedMph, mood.isDrifting);
        nature.update(now, mood);
      } catch {
        /* never crash the game over audio */
      }
    },

    onPickup(kind: 'coin' | 'relic'): void {
      if (!readyForSfx()) return;
      try {
        const m = music!;
        if (kind === 'coin') {
          sfx!.coin(m.randomScaleFreq(2 + ((Math.random() * 2) | 0)));
        } else {
          // Ascending arpeggio: scale degrees d, d+2, d+4 two octaves up.
          const d = (Math.random() * 4) | 0;
          sfx!.relic([m.scaleFreq(d, 2), m.scaleFreq(d + 2, 2), m.scaleFreq(d + 4, 2)]);
        }
      } catch {
        /* ignore */
      }
    },

    onAchievement(): void {
      if (!readyForSfx()) return;
      try {
        sfx!.achievement(midiToFreq(music!.rootMidi() + 24));
      } catch {
        /* ignore */
      }
    },

    onPurchase(): void {
      if (!readyForSfx()) return;
      try {
        sfx!.purchase(music!.scaleFreq(0, 3));
      } catch {
        /* ignore */
      }
    },

    onNearMiss(): void {
      if (!readyForSfx()) return;
      try {
        sfx!.nearMiss();
      } catch {
        /* ignore */
      }
    },

    onPrestige(): void {
      if (!readyForSfx()) return;
      try {
        const m = music!;
        const cascade: number[] = [];
        for (let d = 0; d <= 7; d += 1) cascade.push(m.scaleFreq(d, 2));
        sfx!.prestige(midiToFreq(m.rootMidi()), cascade);
      } catch {
        /* ignore */
      }
    },
  };
}
