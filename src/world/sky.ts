import * as THREE from 'three';
import type { SunSnapshot } from '../engine/daynight';
import { blendColor } from './biomes';

/**
 * Gradient sky dome + sun disc (god-rays source) + moon + procedural stars
 * and aurora, all in one shader. The dome follows the camera.
 */

const PAL = {
  dayZenith: new THREE.Color('#4da3ff'),
  dayHorizon: new THREE.Color('#cfeaff'),
  sunsetZenith: new THREE.Color('#5b4a9e'),
  sunsetHorizon: new THREE.Color('#ff8a3d'),
  nightZenith: new THREE.Color('#0d1330'),
  nightHorizon: new THREE.Color('#273252'),
  dawnHorizonBias: new THREE.Color('#ffb6c9'),
  glowDay: new THREE.Color('#fff2d9'),
  glowSunset: new THREE.Color('#ffb36b'),
  glowNight: new THREE.Color('#9db8e8'),
  sunDisc: new THREE.Color('#fff3d0'),
  sunEmber: new THREE.Color('#ff7a2e'),
};

/**
 * Vertical window the aurora is drawn through, in `h = dir.y` (the sine of
 * elevation on the dome).
 *
 * The curtains are Gaussians whose centre drifts with the wave, so a bare
 * `h > x` branch slices a lit band and leaves a hard bright step. These
 * thresholds drive a smoothstep window instead, and the shader's early-out
 * branch sits exactly on `horizonLo`/`topHi` where that window — and so the
 * whole aurora term — is already identically zero.
 *
 * `horizonLo -> horizonHi` doubles as a horizon fade: a real aurora is
 * occluded by ground and thickened air low down, and the scene's `FogExp2`
 * cannot supply it here because the dome is a raw `ShaderMaterial`.
 * `horizonHi` (0.2) sits just ABOVE the lowest the band centre ever travels
 * (0.30 - 1.9 * 0.055 = 0.1955) — close enough that even at the wave's extreme
 * the core keeps 99.8% brightness, so in practice only the curtain's lower
 * skirt fades. `topLo` sits far enough above the upper
 * curtain that the fade only touches its faint tail.
 */
export const AURORA_WINDOW = {
  horizonLo: 0.03,
  horizonHi: 0.2,
  topLo: 0.72,
  topHi: 0.9,
} as const;

/**
 * Weights of the three summed sines that drift the aurora's band centre, from
 * the slowest angular harmonic to the fastest. The shader's `wave` term is
 * generated from this tuple and `AURORA_BAND.waveAmp` is its sum, so the bound
 * the tests sweep cannot drift away from the sines the GPU actually runs.
 */
export const AURORA_WAVE_HARMONICS = [1, 0.6, 0.3] as const;

/**
 * Vertical shape of the two curtains. Shared by the generated shader and by
 * `auroraBandProfile` so the tests exercise the numbers the GPU actually runs.
 * `waveAmp` bounds the summed sines, i.e. how far the band centre can travel
 * either side of `centerBase`.
 */
export const AURORA_BAND = {
  centerBase: 0.3,
  centerSwing: 0.055,
  waveAmp: AURORA_WAVE_HARMONICS.reduce((sum, w) => sum + w, 0),
  width: 9,
  secondOffset: 0.14,
  secondWidth: 11,
  secondAmp: 0.6,
} as const;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * The aurora's vertical falloff, 0..1, mirroring the `mask` term in the sky
 * fragment shader. Exactly 0 at or outside `AURORA_WINDOW.horizonLo` and
 * `topHi`, which is what lets the shader branch on those same values without
 * cutting anything visible.
 */
export function auroraVerticalMask(h: number): number {
  const w = AURORA_WINDOW;
  return smoothstep(w.horizonLo, w.horizonHi, h) * (1 - smoothstep(w.topLo, w.topHi, h));
}

/**
 * Width of the aurora's fade-in against overall intensity, in `uAurora`
 * (= weather strength x nightness). The contribution is multiplied by
 * `smoothstep(0, AURORA_FADE_IN, uAurora)`, which is the horizontal twin of
 * `AURORA_WINDOW`: it is identically zero at `uAurora <= 0`, which is exactly
 * where the shader's early-out branch sits, so the branch cannot pop.
 *
 * Without it the term is linear in `uAurora`, and the dome is a raw
 * `ShaderMaterial` — no tone mapping, only the sRGB encode, whose slope near
 * black is 12.92. The ~8 s weather crossfade therefore lit the aurora at
 * ~6/255 on its very first frame (~22/255 at the `uAurora > 0.01` guard this
 * replaced): a visible pop out of nothing.
 *
 * 0.05 is chosen from two bounds: wide enough that the first crossfade frame
 * at 60 fps stays under one 8-bit level, and wide enough that no frame of the
 * crossfade steps harder than the un-faded ramp already did (a narrow window
 * such as 0.004 fails the second — it merely moves the step, and steepens it).
 * It reshapes only the bottom 5% of the fade, 0.4 s out of 8 s.
 */
export const AURORA_FADE_IN = 0.05;

/**
 * The aurora's intensity fade, 0..1, mirroring the `fadeIn` term in the sky
 * fragment shader. Exactly 0 at and below `uAurora = 0`, which is what lets
 * the shader branch on `uAurora > 0.0` without cutting anything visible.
 */
export function auroraIntensityFade(uAurora: number): number {
  return smoothstep(0, AURORA_FADE_IN, uAurora);
}

/**
 * Unmasked brightness of the two curtains at elevation `h` for a given `wave`
 * value (the summed sines, |wave| <= `AURORA_BAND.waveAmp`). Mirrors
 * `band + band2` in the shader; multiply by `auroraVerticalMask` for what is
 * actually drawn.
 */
export function auroraBandProfile(h: number, wave: number): number {
  const b = AURORA_BAND;
  const center = b.centerBase + wave * b.centerSwing;
  const d1 = (h - center) * b.width;
  const d2 = (h - center - b.secondOffset) * b.secondWidth;
  return Math.exp(-d1 * d1) + Math.exp(-d2 * d2) * b.secondAmp;
}

/** Format a tuning constant as a GLSL float literal. */
const g = (n: number): string => n.toFixed(4);

export const SKY_VERTEX_SHADER = /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `;

export const SKY_FRAGMENT_SHADER = /* glsl */ `
        varying vec3 vDir;
        uniform vec3 uZenith, uHorizon, uGlowColor;
        uniform vec3 uSunDir;
        uniform float uGlowStrength, uNight, uAurora, uTime;

        float hash(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        void main() {
          vec3 dir = normalize(vDir);
          float h = clamp(dir.y, -1.0, 1.0);
          // Base vertical gradient (below horizon: slightly darkened horizon).
          float t = pow(clamp(h, 0.0, 1.0), 0.5);
          vec3 col = mix(uHorizon, uZenith, t);
          if (h < 0.0) col = uHorizon * (1.0 + h * 0.55);

          // Warm glow around the sun direction (big soft halo).
          float d = max(dot(dir, uSunDir), 0.0);
          col += uGlowColor * (pow(d, 18.0) * 0.85 + pow(d, 4.0) * 0.28) * uGlowStrength;

          // Stars: hashed cells, fade in with night, twinkle subtly.
          if (uNight > 0.01 && h > 0.02) {
            vec3 cell = floor(dir * 220.0);
            float s = hash(cell);
            float star = smoothstep(0.994, 0.999, s);
            float tw = 0.7 + 0.3 * sin(uTime * (1.5 + s * 4.0) + s * 40.0);
            col += vec3(0.9, 0.95, 1.0) * star * tw * uNight * smoothstep(0.02, 0.2, h);
          }

          // Aurora: flowing curtains in a band above the horizon. Both its
          // vertical extent (AURORA_WINDOW) and its switch-on (AURORA_FADE_IN)
          // come from smoothstep windows below, never from the branch: every
          // guard sits where its window is already identically zero, so the
          // branch is a pure early-out and cannot leave a lit edge or a pop.
          if (uAurora > 0.0 && h > ${g(AURORA_WINDOW.horizonLo)} && h < ${g(AURORA_WINDOW.topHi)}) {
            float ang = atan(dir.x, dir.z);
            float wave = ${g(AURORA_WAVE_HARMONICS[0])} * sin(ang * 3.0 + uTime * 0.13)
                       + ${g(AURORA_WAVE_HARMONICS[1])} * sin(ang * 7.0 - uTime * 0.21)
                       + ${g(AURORA_WAVE_HARMONICS[2])} * sin(ang * 13.0 + uTime * 0.34);
            float bandCenter = ${g(AURORA_BAND.centerBase)} + wave * ${g(AURORA_BAND.centerSwing)};
            float d1 = (h - bandCenter) * ${g(AURORA_BAND.width)};
            float d2 = (h - bandCenter - ${g(AURORA_BAND.secondOffset)}) * ${g(AURORA_BAND.secondWidth)};
            float band = exp(-d1 * d1);
            float band2 = exp(-d2 * d2) * ${g(AURORA_BAND.secondAmp)};
            float mask = smoothstep(${g(AURORA_WINDOW.horizonLo)}, ${g(AURORA_WINDOW.horizonHi)}, h)
                       * (1.0 - smoothstep(${g(AURORA_WINDOW.topLo)}, ${g(AURORA_WINDOW.topHi)}, h));
            float flicker = 0.75 + 0.25 * sin(ang * 21.0 + uTime * 0.9);
            float fadeIn = smoothstep(0.0, ${g(AURORA_FADE_IN)}, uAurora);
            vec3 auroraCol = mix(vec3(0.25, 0.95, 0.55), vec3(0.55, 0.35, 0.95),
                                 clamp((h - bandCenter) * 4.0 + 0.5, 0.0, 1.0));
            col += auroraCol * (band + band2) * mask * flicker * uAurora * fadeIn * 0.8;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `;

export class Sky {
  readonly dome: THREE.Mesh;
  readonly sun: THREE.Mesh;
  readonly moon: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private sunMat: THREE.MeshBasicMaterial;
  /** Exposed for fog + lights to reuse each frame. */
  readonly horizonColor = new THREE.Color();
  readonly zenithColor = new THREE.Color();
  readonly sunColor = new THREE.Color();
  private time = 0;

  constructor(scene: THREE.Scene) {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlowColor: { value: new THREE.Color() },
        uGlowStrength: { value: 0.4 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uNight: { value: 0 },
        uAurora: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERTEX_SHADER,
      fragmentShader: SKY_FRAGMENT_SHADER,
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(6000, 40, 20), this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // Sun disc — the god-rays occlusion source.
    this.sunMat = new THREE.MeshBasicMaterial({ color: 0xfff3d0, fog: false, toneMapped: false });
    this.sun = new THREE.Mesh(new THREE.CircleGeometry(230, 40), this.sunMat);
    this.sun.frustumCulled = false;
    this.sun.renderOrder = -9;
    scene.add(this.sun);

    const moonMat = new THREE.MeshBasicMaterial({
      color: 0xe8eeff,
      fog: false,
      transparent: true,
      opacity: 0,
    });
    this.moon = new THREE.Mesh(new THREE.CircleGeometry(120, 32), moonMat);
    this.moon.frustumCulled = false;
    this.moon.renderOrder = -9;
    scene.add(this.moon);
  }

  update(
    camPos: THREE.Vector3,
    snap: SunSnapshot,
    pathS: number,
    aurora: number,
    dt: number,
  ): void {
    this.time += dt;
    const u = this.mat.uniforms;
    const { golden, nightness } = snap;

    // Continuous palette: day -> (golden) sunset -> (nightness) night.
    this.zenithColor
      .copy(PAL.dayZenith)
      .lerp(PAL.sunsetZenith, golden)
      .lerp(PAL.nightZenith, nightness);
    this.horizonColor
      .copy(PAL.dayHorizon)
      .lerp(PAL.sunsetHorizon, golden)
      .lerp(PAL.nightHorizon, nightness);
    // Dawn leans pink instead of orange.
    if (snap.phase === 'dawn') this.horizonColor.lerp(PAL.dawnHorizonBias, 0.45 * golden);
    // Subtle biome tint on the horizon during daylight.
    blendColor(pathS, (b) => b.skyTint, tint);
    this.horizonColor.lerp(tint, 0.22 * (1 - nightness));

    (u.uZenith.value as THREE.Color).copy(this.zenithColor);
    (u.uHorizon.value as THREE.Color).copy(this.horizonColor);
    const glow = (u.uGlowColor.value as THREE.Color)
      .copy(PAL.glowDay)
      .lerp(PAL.glowSunset, golden)
      .lerp(PAL.glowNight, nightness);
    u.uGlowStrength.value = 0.45 + golden * 1.25 - nightness * 0.25;
    (u.uSunDir.value as THREE.Vector3).copy(snap.sunDir);
    u.uNight.value = nightness;
    u.uAurora.value = aurora * nightness;
    u.uTime.value = this.time;

    // Sun color: white-warm -> deep ember at the horizon; disc swells at sunset.
    this.sunColor.copy(PAL.sunDisc).lerp(PAL.sunEmber, golden);
    this.sunMat.color.copy(this.sunColor);
    const sunScale = 1 + golden * 1.15;
    this.sun.scale.setScalar(sunScale);
    this.sun.position.copy(camPos).addScaledVector(snap.sunDir, 5400);
    this.sun.lookAt(camPos);
    this.sun.visible = snap.elevation > -0.22;

    // Moon opposite-ish the sun, fading with nightness.
    const moonDir = tmpV.copy(snap.sunDir).multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.8 + 0.15;
    moonDir.normalize();
    this.moon.position.copy(camPos).addScaledVector(moonDir, 5400);
    this.moon.lookAt(camPos);
    (this.moon.material as THREE.MeshBasicMaterial).opacity = nightness * 0.85;

    this.dome.position.copy(camPos);
    void glow;
  }
}

const tint = new THREE.Color();
const tmpV = new THREE.Vector3();
