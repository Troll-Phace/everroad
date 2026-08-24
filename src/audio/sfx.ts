/**
 * One-shot SFX: subtle, pleasing, always in the current biome's key.
 * The caller (audio.ts) supplies frequencies from the active scale.
 * A small shared echo send gives sparkles and cascades a little air.
 */

import { rand } from './helpers';

export interface SfxKit {
  /** Marimba-ish plink at `freq` (a random note of the current scale). */
  coin(freq: number): void;
  /** Magical 3-note upward arpeggio + sparkle; freqs ascend. */
  relic(freqs: number[]): void;
  /** Warm 3-note major chime built on `rootFreq`. */
  achievement(rootFreq: number): void;
  /** Soft thump + one modest chime. Tasteful. */
  purchase(chimeFreq: number): void;
  /** Quick bandpass noise whoosh. */
  nearMiss(): void;
  /** Big warm rising swell + chime cascade (~2.5 s). */
  prestige(rootFreq: number, cascadeFreqs: number[]): void;
}

export function createSfx(
  ctx: BaseAudioContext,
  out: AudioNode,
  whiteNoise: AudioBuffer
): SfxKit {
  // Shared echo send (delay -> filtered feedback) for sparkly one-shots.
  const echoIn = ctx.createGain();
  echoIn.gain.value = 1;
  const delay = ctx.createDelay(1);
  delay.delayTime.value = 0.27;
  const fbLp = ctx.createBiquadFilter();
  fbLp.type = 'lowpass';
  fbLp.frequency.value = 2600;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const echoOut = ctx.createGain();
  echoOut.gain.value = 0.45;
  echoIn.connect(delay);
  delay.connect(fbLp);
  fbLp.connect(fb);
  fb.connect(delay);
  delay.connect(echoOut);
  echoOut.connect(out);

  /**
   * Marimba-like pluck: sine fundamental + faint 4x partial, fast decay.
   * `echo` sends a copy into the delay for a soft tail.
   */
  function pluck(freq: number, at: number, vol: number, decay: number, echo = 0): void {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    g.connect(out);
    if (echo > 0) {
      const send = ctx.createGain();
      send.gain.value = echo;
      g.connect(send);
      send.connect(echoIn);
    }

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.connect(g);
    osc.start(at);
    osc.stop(at + decay + 0.05);

    // Bright "bar" partial, dies fast.
    const partial = ctx.createOscillator();
    partial.type = 'sine';
    partial.frequency.value = freq * 4;
    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0, at);
    pg.gain.linearRampToValueAtTime(vol * 0.22, at + 0.005);
    pg.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(0.09, decay * 0.3));
    partial.connect(pg);
    pg.connect(g);
    partial.start(at);
    partial.stop(at + 0.12);
  }

  return {
    coin(freq: number): void {
      // Tiny humanization in pitch and level.
      pluck(freq * rand(0.997, 1.003), ctx.currentTime, rand(0.07, 0.09), 0.3);
    },

    relic(freqs: number[]): void {
      const now = ctx.currentTime;
      freqs.forEach((f, i) => {
        pluck(f, now + i * 0.09, 0.075, 0.5, 0.5);
      });
      // Sparkle: a high octave shimmer over the last note.
      const top = freqs[freqs.length - 1] * 2;
      pluck(top, now + freqs.length * 0.09 + 0.05, 0.045, 0.9, 0.8);
    },

    achievement(rootFreq: number): void {
      const now = ctx.currentTime;
      // Warm major arpeggio: root, third, fifth.
      const ratios = [1, 5 / 4, 3 / 2];
      ratios.forEach((r, i) => {
        pluck(rootFreq * r, now + i * 0.13, 0.08, 0.9, 0.4);
      });
    },

    purchase(chimeFreq: number): void {
      const now = ctx.currentTime;
      // Soft felt thump: quick pitch drop, no click.
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.exponentialRampToValueAtTime(62, now + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.11, now + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(g);
      g.connect(out);
      osc.start(now);
      osc.stop(now + 0.25);

      pluck(chimeFreq, now + 0.06, 0.05, 0.5, 0.25);
    },

    nearMiss(): void {
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = whiteNoise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(450, now);
      bp.frequency.exponentialRampToValueAtTime(3000, now + 0.22);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.06, now + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(now, Math.random());
      src.stop(now + 0.3);
    },

    prestige(rootFreq: number, cascadeFreqs: number[]): void {
      const now = ctx.currentTime;

      // Rising swell: low saw + airy noise through an opening lowpass.
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.setValueAtTime(150, now);
      lp.frequency.exponentialRampToValueAtTime(2600, now + 1.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.06, now + 1.6);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.7);
      lp.connect(g);
      g.connect(out);

      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(rootFreq / 2, now);
      saw.frequency.linearRampToValueAtTime(rootFreq, now + 1.9);
      const sg = ctx.createGain();
      sg.gain.value = 0.6;
      saw.connect(sg);
      sg.connect(lp);
      saw.start(now);
      saw.stop(now + 2.8);

      const air = ctx.createBufferSource();
      air.buffer = whiteNoise;
      air.loop = true;
      const ag = ctx.createGain();
      ag.gain.value = 0.25;
      air.connect(ag);
      ag.connect(lp);
      air.start(now, Math.random());
      air.stop(now + 2.8);

      // Chime cascade riding out of the swell's crest.
      cascadeFreqs.forEach((f, i) => {
        const last = i === cascadeFreqs.length - 1;
        pluck(f, now + 1.4 + i * 0.13, 0.075, last ? 1.6 : 0.7, 0.6);
      });
    },
  };
}
