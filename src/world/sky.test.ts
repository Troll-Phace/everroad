import { describe, it, expect } from 'vitest';
import {
  AURORA_BAND,
  AURORA_FADE_IN,
  AURORA_WAVE_HARMONICS,
  AURORA_WINDOW,
  SKY_FRAGMENT_SHADER,
  auroraBandProfile,
  auroraIntensityFade,
  auroraVerticalMask,
} from './sky';

/**
 * The aurora's vertical extent is the one part of the sky shader that is pure
 * math on `h = dir.y`, so it is lifted into `auroraVerticalMask` /
 * `auroraBandProfile` and the shader is generated from the same constants.
 * These tests guard the property the hard-cutoff bug violated: the drawn
 * brightness must reach zero smoothly, everywhere the band can travel.
 */

/** What the shader actually adds to the sky, before colour and flicker. */
const drawn = (h: number, wave: number): number =>
  auroraBandProfile(h, wave) * auroraVerticalMask(h);

/** Band centres reachable across the whole wave animation. */
const waves = (): number[] => {
  const out: number[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) out.push(-AURORA_BAND.waveAmp + (2 * AURORA_BAND.waveAmp * i) / n);
  return out;
};

/** Centre of the first curtain for a given wave value. */
const bandCenter = (wave: number): number =>
  AURORA_BAND.centerBase + wave * AURORA_BAND.centerSwing;

/**
 * Linear -> sRGB, the encode Three.js applies on the way to the framebuffer.
 * The dome is a raw `ShaderMaterial` with no tone mapping, so this is the only
 * transform between what the shader computes and what the player sees; its
 * slope near black is 12.92, which is why "small in linear" is not the same as
 * "invisible on screen".
 */
const toSRGB = (linear: number): number =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055;

/** Brightest aurora colour channel in the shader's `mix` endpoints. */
const AURORA_MAX_CHANNEL = 0.95;
/** The shader's overall aurora gain in the final `col +=`. */
const AURORA_GAIN = 0.8;

/**
 * Peak of the drawn profile over the whole wave animation. With the brightest
 * channel and the top of the flicker range (0.75 + 0.25 = 1.0) this bounds
 * what the aurora adds per unit of `uAurora`.
 */
const AURORA_PEAK_DRAWN = (() => {
  let peak = 0;
  for (const wave of waves())
    for (let h = -0.2; h <= 1; h += 0.0005) peak = Math.max(peak, drawn(h, wave));
  return peak;
})();

/** `FADE_SEC` in src/world/weather.ts: weather crossfades ramp over 8 seconds. */
const CROSSFADE_SEC = 8;

/**
 * Per-frame change in the aurora's peak 8-bit sRGB level as the weather
 * crossfade drives `uAurora` linearly 0 -> 1 at `fps`. `fade` lets the test
 * compare the shipped fade against the bare linear ramp it replaced.
 */
const crossfadeSteps = (fps: number, fade: (u: number) => number): number[] => {
  const frames = Math.round(fps * CROSSFADE_SEC);
  const out: number[] = [];
  let prev = 0;
  for (let n = 1; n <= frames; n++) {
    const u = n / frames;
    const level = toSRGB(AURORA_PEAK_DRAWN * AURORA_MAX_CHANNEL * AURORA_GAIN * u * fade(u)) * 255;
    out.push(level - prev);
    prev = level;
  }
  return out;
};

describe('auroraVerticalMask', () => {
  it('is exactly zero at and outside the window edges', () => {
    expect(auroraVerticalMask(AURORA_WINDOW.horizonLo)).toBe(0);
    expect(auroraVerticalMask(AURORA_WINDOW.horizonLo - 0.01)).toBe(0);
    expect(auroraVerticalMask(-1)).toBe(0);
    expect(auroraVerticalMask(AURORA_WINDOW.topHi)).toBe(0);
    expect(auroraVerticalMask(AURORA_WINDOW.topHi + 0.01)).toBe(0);
    expect(auroraVerticalMask(1)).toBe(0);
  });

  it('stays in 0..1 and reaches full strength through the band', () => {
    for (let h = -1; h <= 1; h += 0.001) {
      const m = auroraVerticalMask(h);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
    expect(auroraVerticalMask(0.35)).toBeCloseTo(1, 6);
    expect(auroraVerticalMask(AURORA_WINDOW.topLo)).toBeCloseTo(1, 6);
  });

  it('leaves both curtain cores at full brightness wherever the wave puts them', () => {
    // The lowest the centre ever travels is the worst case for the horizon
    // fade; the second curtain at its highest is the worst case for the top
    // fade, and it is `secondOffset` above the first, so the sweep has to
    // follow both or the upper curtain can be dimmed unnoticed.
    const lowest = AURORA_BAND.centerBase - AURORA_BAND.waveAmp * AURORA_BAND.centerSwing;
    expect(lowest).toBeGreaterThan(AURORA_WINDOW.horizonHi - 0.01);
    const highest =
      AURORA_BAND.centerBase +
      AURORA_BAND.waveAmp * AURORA_BAND.centerSwing +
      AURORA_BAND.secondOffset;
    expect(highest).toBeLessThan(AURORA_WINDOW.topLo);
    for (const wave of waves()) {
      const center = bandCenter(wave);
      expect(auroraVerticalMask(center)).toBeGreaterThan(0.99);
      expect(auroraVerticalMask(center + AURORA_BAND.secondOffset)).toBeGreaterThan(0.99);
    }
  });

  it('places each window edge out on a curtain skirt, never through its body', () => {
    // The hard-cutoff bug cut at h = 0.06, where the Gaussian was still at
    // 0.226 of peak — that leftover brightness is exactly what the eye read as
    // a line. Wherever the window bites, the curtain under it must already
    // have decayed, so raising `horizonLo` back toward the old cut, or pulling
    // `topLo` down into the upper curtain, fails here.
    for (const wave of waves()) {
      const peak = auroraBandProfile(bandCenter(wave), wave);
      expect(auroraBandProfile(AURORA_WINDOW.horizonLo, wave) / peak).toBeLessThan(0.15);
      expect(auroraBandProfile(AURORA_WINDOW.topLo, wave) / peak).toBeLessThan(0.15);
    }
  });

  it('fades the skirt that hangs toward the horizon', () => {
    // Deliberate: ground and haze occlude a real aurora low down, and FogExp2
    // does not reach the dome. Only the skirt is affected, never the core.
    expect(auroraVerticalMask(0.1)).toBeLessThan(0.4);
    expect(auroraVerticalMask(0.06)).toBeLessThan(0.1);
  });
});

describe('aurora vertical profile', () => {
  it('has no step anywhere, at any point in the wave animation', () => {
    // A reintroduced hard cut shows up as a jump between adjacent samples; the
    // Gaussian's own steepest slope is ~7.7 per unit h, i.e. ~0.004 per step.
    for (const wave of waves()) {
      let prev = drawn(-0.2, wave);
      let worst = 0;
      for (let h = -0.2; h <= 1; h += 0.0005) {
        const v = drawn(h, wave);
        worst = Math.max(worst, Math.abs(v - prev));
        prev = v;
      }
      expect(worst).toBeLessThan(0.01);
    }
  });

  it('is below one 8-bit step at the shader branch guards', () => {
    for (const wave of waves()) {
      expect(drawn(AURORA_WINDOW.horizonLo, wave)).toBe(0);
      expect(drawn(AURORA_WINDOW.topHi, wave)).toBe(0);
      expect(drawn(AURORA_WINDOW.horizonLo + 0.002, wave)).toBeLessThan(1 / 255);
      expect(drawn(AURORA_WINDOW.topHi - 0.002, wave)).toBeLessThan(1 / 255);
      // ...and below one step on screen too, which is the stricter claim: the
      // sRGB encode multiplies values this close to black by 12.92.
      const level = (h: number): number =>
        toSRGB(drawn(h, wave) * AURORA_MAX_CHANNEL * AURORA_GAIN) * 255;
      expect(level(AURORA_WINDOW.horizonLo + 0.002)).toBeLessThan(1);
      expect(level(AURORA_WINDOW.topHi - 0.002)).toBeLessThan(1);
    }
  });

  it('still reads as a curtain rather than a uniform wash', () => {
    for (const wave of waves()) {
      let peak = 0;
      let low = Infinity;
      for (let h = AURORA_WINDOW.horizonLo; h <= AURORA_WINDOW.topHi; h += 0.001) {
        const v = drawn(h, wave);
        peak = Math.max(peak, v);
        low = Math.min(low, v);
      }
      expect(peak).toBeGreaterThan(0.95);
      expect(low).toBeLessThan(0.05 * peak);
    }
  });
});

describe('auroraIntensityFade', () => {
  it('is exactly zero at and below no aurora at all', () => {
    expect(auroraIntensityFade(0)).toBe(0);
    expect(auroraIntensityFade(-0.5)).toBe(0);
  });

  it('rises monotonically to full and stays there', () => {
    let prev = -1;
    for (let u = 0; u <= 1; u += 0.001) {
      const f = auroraIntensityFade(u);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
    expect(auroraIntensityFade(AURORA_FADE_IN)).toBe(1);
    expect(auroraIntensityFade(1)).toBe(1);
  });

  it('is spent within the first second of the weather crossfade', () => {
    // The fade exists to kill the switch-on pop, not to restyle the fade-in:
    // once the crossfade has run a second the aurora must be at full strength.
    expect(auroraIntensityFade(1 / CROSSFADE_SEC)).toBe(1);
  });

  it('switches the aurora on below one 8-bit step, at any frame rate', () => {
    // The reported bug: at the old `uAurora > 0.01` guard the first lit frame
    // arrived at ~22/255 out of black. Even with the guard at zero, a bare
    // linear ramp lands the first frame at ~6/255 because of the sRGB slope.
    for (const fps of [60, 30]) {
      expect(crossfadeSteps(fps, auroraIntensityFade)[0]).toBeLessThan(1);
    }
  });

  it('never steps harder anywhere in the crossfade than the bare ramp it replaced', () => {
    // A window that is too narrow does not remove the step, it just moves it
    // further up the ramp and steepens it on the way. The fade has to beat the
    // un-faded ramp everywhere, not only on frame one.
    for (const fps of [60, 30]) {
      const faded = Math.max(...crossfadeSteps(fps, auroraIntensityFade));
      const bare = Math.max(...crossfadeSteps(fps, () => 1));
      expect(faded).toBeLessThanOrEqual(bare);
    }
  });
});

describe('SKY_FRAGMENT_SHADER', () => {
  it('guards the aurora only where the mask is already zero', () => {
    const m = /uAurora > ([\d.]+) && h > ([\d.]+) && h < ([\d.]+)/.exec(SKY_FRAGMENT_SHADER);
    if (!m) throw new Error('aurora branch guard not found in the sky fragment shader');
    const intensity = Number(m[1]);
    const lo = Number(m[2]);
    const hi = Number(m[3]);
    expect(auroraVerticalMask(lo)).toBe(0);
    expect(auroraVerticalMask(hi)).toBe(0);
    // The intensity guard is the same construction on the other axis: it may
    // only sit where the fade has already taken the whole term to zero.
    expect(auroraIntensityFade(intensity)).toBe(0);
    // ...and the branch must not exclude any part of the window that is lit.
    expect(lo).toBeLessThanOrEqual(AURORA_WINDOW.horizonLo);
    expect(hi).toBeGreaterThanOrEqual(AURORA_WINDOW.topHi);
  });

  it('multiplies the aurora by the mask instead of cutting it', () => {
    expect(SKY_FRAGMENT_SHADER).toContain('(band + band2) * mask');
  });

  it('multiplies the aurora by the intensity fade instead of switching it on', () => {
    expect(SKY_FRAGMENT_SHADER).toContain('* uAurora * fadeIn * 0.8');
    const m = /float fadeIn = smoothstep\(([\d.]+), ([\d.]+), uAurora\)/.exec(SKY_FRAGMENT_SHADER);
    if (!m) throw new Error('aurora intensity fade not found in the sky fragment shader');
    expect(Number(m[1])).toBe(0);
    expect(Number(m[2])).toBeCloseTo(AURORA_FADE_IN, 6);
  });

  it('keeps the aurora colour and gain the tests bound the pop against', () => {
    // `AURORA_MAX_CHANNEL` / `AURORA_GAIN` above are lifted from these; if the
    // shader is rebalanced the sRGB bounds have to be recomputed with it.
    expect(SKY_FRAGMENT_SHADER).toContain(`vec3(0.25, ${AURORA_MAX_CHANNEL}, 0.55)`);
    expect(SKY_FRAGMENT_SHADER).toContain(`vec3(0.55, 0.35, ${AURORA_MAX_CHANNEL})`);
    expect(SKY_FRAGMENT_SHADER).toContain(`* fadeIn * ${AURORA_GAIN}`);
  });

  it('generates the wave harmonics, so waveAmp cannot drift from the sines', () => {
    const expr = /float wave =([\s\S]*?);/.exec(SKY_FRAGMENT_SHADER);
    if (!expr) throw new Error('aurora wave expression not found in the sky fragment shader');
    const coeffs = [...expr[1].matchAll(/([\d.]+)\s*\*\s*sin\(/g)].map((c) => Number(c[1]));
    expect(coeffs).toHaveLength(AURORA_WAVE_HARMONICS.length);
    coeffs.forEach((c, i) => expect(c).toBeCloseTo(AURORA_WAVE_HARMONICS[i], 6));
    // `waves()` sweeps +/- waveAmp; if that is not what the sines can reach,
    // every test built on the sweep is quietly exercising the wrong range.
    expect(coeffs.reduce((a, b) => a + b, 0)).toBeCloseTo(AURORA_BAND.waveAmp, 6);
  });
});
