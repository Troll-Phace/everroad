/**
 * Nature ambience: wind swells (always present), birds by day, crickets by
 * night, and a rain bed with occasional distant rumbles.
 *
 * Aurora weather used to add a tonal "shimmer" pad here: two bare detuned
 * sines at the palette root + fifth, three octaves up, sounding continuously
 * with a slow chorus LFO. On the brighter biomes that put them at 1319 Hz and
 * 1976 Hz -- the band the ear is most sensitive to, with no harmonic content
 * to soften it and no envelope to break it up. It read as a high-pitched
 * whine, and it was removed. Aurora is now a purely visual event. If a tonal
 * aurora cue is ever wanted again, it needs a lower register, a real
 * envelope, and something other than naked sines.
 *
 * Everything event-like (birds, crickets, rumbles) is scheduled off the audio
 * clock inside update() — no timers, no setInterval.
 */

import type { TimePhase, WeatherId } from '../types';
import { loopingNoise, rand, rampTo } from './helpers';

export interface NatureMood {
  timePhase: TimePhase;
  weatherId: WeatherId;
}

export interface NatureLayer {
  update(now: number, mood: NatureMood): void;
}

export function createNatureLayer(
  ctx: BaseAudioContext,
  /** Bus for noise-based ambience and critters (sfx bus). */
  out: AudioNode,
  buffers: { white: AudioBuffer; pink: AudioBuffer; brown: AudioBuffer },
): NatureLayer {
  // --- wind: pink noise through a wandering bandpass, slow swell LFO -------
  const wind = loopingNoise(ctx, buffers.pink, out);
  wind.filter.type = 'bandpass';
  wind.filter.frequency.value = 480;
  wind.filter.Q.value = 0.5;
  wind.gain.gain.value = 0.016;

  const swell = ctx.createOscillator();
  swell.type = 'sine';
  swell.frequency.value = 0.045;
  const swellDepth = ctx.createGain();
  swellDepth.gain.value = 0.009;
  swell.connect(swellDepth);
  swellDepth.connect(wind.gain.gain);
  swell.start();

  const wander = ctx.createOscillator();
  wander.type = 'sine';
  wander.frequency.value = 0.028;
  const wanderDepth = ctx.createGain();
  wanderDepth.gain.value = 160;
  wander.connect(wanderDepth);
  wanderDepth.connect(wind.filter.frequency);
  wander.start();

  // --- rain bed: shaped white noise, faded in/out with weather -------------
  const rain = loopingNoise(ctx, buffers.white, out);
  rain.filter.type = 'lowpass';
  rain.filter.frequency.value = 5200;
  rain.filter.Q.value = 0.3;
  const rainHp = ctx.createBiquadFilter();
  rainHp.type = 'highpass';
  rainHp.frequency.value = 420;
  // Re-route: src -> lowpass -> highpass -> gain (loopingNoise wired filter->gain).
  rain.filter.disconnect();
  rain.filter.connect(rainHp);
  rainHp.connect(rain.gain);
  rain.gain.gain.value = 0;

  // --- critter/one-shot output ---------------------------------------------
  const critters = ctx.createGain();
  critters.gain.value = 1;
  critters.connect(out);

  // --- event scheduling ----------------------------------------------------
  let lastWeather: WeatherId | null = null;
  let lastPhase: TimePhase | null = null;
  let nextBird = 0;
  let nextCricket = 0;
  let nextRumble = 0;

  function birdChirp(now: number): void {
    const notes = 2 + ((Math.random() * 3) | 0);
    let t = now + 0.02;
    for (let i = 0; i < notes; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const f0 = rand(2400, 3800);
      osc.frequency.setValueAtTime(f0, t);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(1.15, 1.45), t + 0.05);
      osc.frequency.exponentialRampToValueAtTime(f0 * rand(0.85, 1.0), t + 0.1);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(rand(0.025, 0.045), t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      osc.connect(g);
      g.connect(critters);
      osc.start(t);
      osc.stop(t + 0.16);
      t += rand(0.12, 0.22);
    }
  }

  function cricketBurst(now: number): void {
    const ticks = 4 + ((Math.random() * 3) | 0);
    const f = 4100 + rand(-250, 350);
    let t = now + 0.02;
    for (let i = 0; i < ticks; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.011, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      osc.connect(g);
      g.connect(critters);
      osc.start(t);
      osc.stop(t + 0.04);
      t += 0.065;
    }
  }

  function rainRumble(now: number): void {
    // Distant soft thunder: a low sine swell + a puff of lowpassed brown noise.
    const t = now + 0.05;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(rand(42, 58), t);
    osc.frequency.linearRampToValueAtTime(rand(34, 44), t + 2.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(rand(0.03, 0.05), t + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    osc.connect(g);
    g.connect(critters);
    osc.start(t);
    osc.stop(t + 2.5);

    const src = ctx.createBufferSource();
    src.buffer = buffers.brown;
    src.loop = true; // envelope, not buffer length, ends the burst
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 110;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.06, t + 0.7);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(critters);
    src.start(t, Math.random());
    src.stop(t + 2.3);
  }

  return {
    update(now: number, mood: NatureMood): void {
      // Weather transitions.
      if (mood.weatherId !== lastWeather) {
        lastWeather = mood.weatherId;
        const rainy = mood.weatherId === 'rain';
        const breezy = mood.weatherId === 'leaves';
        rampTo(rain.gain.gain, rainy ? 0.05 : 0, 2.5, now);
        // Leaves/petals: slightly stronger wind swells.
        rampTo(wind.gain.gain, breezy ? 0.03 : 0.016, 3, now);
        rampTo(swellDepth.gain, breezy ? 0.017 : 0.009, 3, now);
        if (rainy) nextRumble = now + rand(8, 20);
      }
      if (mood.timePhase !== lastPhase) {
        lastPhase = mood.timePhase;
        nextBird = now + rand(2, 8);
        nextCricket = now + rand(1, 3);
      }

      // Critters — birds when the sun is up (not in rain), crickets at night.
      const sunUp = mood.timePhase === 'day' || mood.timePhase === 'dawn';
      if (sunUp && mood.weatherId !== 'rain' && now >= nextBird) {
        birdChirp(now);
        nextBird = now + rand(4, 15);
      }
      if (mood.timePhase === 'night' && now >= nextCricket) {
        cricketBurst(now);
        nextCricket = now + rand(0.6, 1.8);
      }
      if (mood.weatherId === 'rain' && now >= nextRumble) {
        rainRumble(now);
        nextRumble = now + rand(15, 40);
      }
    },
  };
}
