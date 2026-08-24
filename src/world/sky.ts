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
};

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
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
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

          // Aurora: flowing curtains in a band above the horizon.
          if (uAurora > 0.01 && h > 0.06 && h < 0.75) {
            float ang = atan(dir.x, dir.z);
            float wave = sin(ang * 3.0 + uTime * 0.13)
                       + 0.6 * sin(ang * 7.0 - uTime * 0.21)
                       + 0.3 * sin(ang * 13.0 + uTime * 0.34);
            float bandCenter = 0.30 + wave * 0.055;
            float band = exp(-pow((h - bandCenter) * 9.0, 2.0));
            float band2 = exp(-pow((h - bandCenter - 0.14) * 11.0, 2.0)) * 0.6;
            float flicker = 0.75 + 0.25 * sin(ang * 21.0 + uTime * 0.9);
            vec3 auroraCol = mix(vec3(0.25, 0.95, 0.55), vec3(0.55, 0.35, 0.95),
                                 clamp((h - bandCenter) * 4.0 + 0.5, 0.0, 1.0));
            col += auroraCol * (band + band2) * flicker * uAurora * 0.8;
          }

          gl_FragColor = vec4(col, 1.0);
        }
      `,
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
    this.sunColor.copy(new THREE.Color('#fff3d0')).lerp(new THREE.Color('#ff7a2e'), golden);
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
