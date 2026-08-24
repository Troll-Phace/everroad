import * as THREE from 'three';

/**
 * Painterly toon materials. A tiny gradient ramp gives everything soft
 * 3-step cel shading; saturated pastel colors + fog + postfx do the rest.
 */

let ramp: THREE.DataTexture | null = null;

export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  // 4-stop ramp, soft: shadow tones stay colorful (never gray/black).
  const stops = [150, 195, 235, 255];
  const data = new Uint8Array(stops.length * 4);
  stops.forEach((v, i) => {
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  });
  ramp = new THREE.DataTexture(data, stops.length, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.needsUpdate = true;
  return ramp;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();

/** Cached flat-color toon material. */
export function toonMat(color: string | number, opts?: { emissive?: number }): THREE.MeshToonMaterial {
  const key = `${color}|${opts?.emissive ?? 0}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    if (opts?.emissive) m.emissive = new THREE.Color(opts.emissive);
    matCache.set(key, m);
  }
  return m;
}

let vMat: THREE.MeshToonMaterial | null = null;
/** Shared vertex-colored toon material for merged terrain/scenery geometry. */
export function vertexToonMat(): THREE.MeshToonMaterial {
  if (!vMat) {
    vMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      vertexColors: true,
      gradientMap: toonRamp(),
    });
  }
  return vMat;
}

/** Small deterministic RNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 1-D value noise built from a few sines (deterministic). */
export function sineNoise(x: number, seed: number): number {
  return (
    Math.sin(x * 1.0 + seed * 12.9898) * 0.5 +
    Math.sin(x * 2.13 + seed * 78.233) * 0.3 +
    Math.sin(x * 4.7 + seed * 37.719) * 0.2
  );
}

/** Cheap 2-D value-ish noise (smooth, tileless), output ~[-1,1]. */
export function noise2(x: number, y: number): number {
  return (
    Math.sin(x * 0.754 + Math.sin(y * 0.531) * 2.1) * 0.55 +
    Math.sin(y * 0.917 + Math.sin(x * 0.343) * 1.7) * 0.45
  );
}

/** Jitter a color's HSL slightly for painterly variation. Returns new color. */
export function jitterColor(c: THREE.Color, r: () => number, amount = 0.05): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const out = new THREE.Color();
  out.setHSL(
    (hsl.h + (r() - 0.5) * amount + 1) % 1,
    THREE.MathUtils.clamp(hsl.s + (r() - 0.5) * amount * 2, 0, 1),
    THREE.MathUtils.clamp(hsl.l + (r() - 0.5) * amount * 2, 0.05, 0.95),
  );
  return out;
}
