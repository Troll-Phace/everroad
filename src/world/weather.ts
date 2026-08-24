import * as THREE from 'three';
import type { BiomeId, TimePhase, WeatherId, EventBus } from '../types';
import { BIOMES } from './biomes';

/**
 * Weather: an episode state machine (clear/rain/fog/leaves/aurora) with soft
 * crossfades, plus the particle systems for rain and drifting leaves/petals.
 */

const FADE_SEC = 8;

const LEAF_COLORS: Partial<Record<BiomeId, string[]>> = {
  autumn: ['#e8542f', '#f07f36', '#f2a53a', '#d43b28'],
  cherry: ['#f7bcd2', '#ffd2e4', '#f2a0c0'],
};
const LEAF_DEFAULT = ['#d9c25a', '#c9a84a'];

export class Weather {
  current: WeatherId = 'clear';
  private previous: WeatherId = 'clear';
  /** 0..1 fade from previous -> current. */
  private fade = 1;
  private episodeLeft = 45;

  private rain: THREE.Points;
  private rainVel: Float32Array;
  private leaves: THREE.InstancedMesh;
  private leafState: Array<{ x: number; y: number; z: number; phase: number; spin: number }> = [];

  constructor(
    private scene: THREE.Scene,
    private bus: EventBus,
  ) {
    // ---- rain: points in a box around the camera ----
    const RAIN_N = 900;
    const rainPos = new Float32Array(RAIN_N * 3);
    this.rainVel = new Float32Array(RAIN_N);
    for (let i = 0; i < RAIN_N; i++) {
      rainPos[i * 3] = (Math.random() - 0.5) * 70;
      rainPos[i * 3 + 1] = Math.random() * 30;
      rainPos[i * 3 + 2] = (Math.random() - 0.5) * 70;
      this.rainVel[i] = 20 + Math.random() * 8;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
    this.rain = new THREE.Points(
      rainGeo,
      new THREE.PointsMaterial({
        color: 0xcfe0f0,
        size: 0.14,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    scene.add(this.rain);

    // ---- leaves/petals: instanced fluttering quads ----
    const LEAF_N = 170;
    const leafGeo = new THREE.PlaneGeometry(0.28, 0.2);
    const leafMat = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.leaves = new THREE.InstancedMesh(leafGeo, leafMat, LEAF_N);
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leaves.frustumCulled = false;
    const c = new THREE.Color();
    for (let i = 0; i < LEAF_N; i++) {
      this.leafState.push({
        x: (Math.random() - 0.5) * 60,
        y: Math.random() * 18,
        z: (Math.random() - 0.5) * 60,
        phase: Math.random() * Math.PI * 2,
        spin: 0.6 + Math.random() * 2,
      });
      this.leaves.setColorAt(i, c.set('#e8a75f'));
    }
    scene.add(this.leaves);
  }

  /** Intensity (0..1) of a given weather right now, respecting the crossfade. */
  intensity(id: WeatherId): number {
    let v = 0;
    if (this.current === id) v += this.fade;
    if (this.previous === id) v += 1 - this.fade;
    return v;
  }

  /** Multiplier applied to base fog density. */
  fogMultiplier(biomeMist: number): number {
    return biomeMist * (1 + this.intensity('fog') * 2.6 + this.intensity('rain') * 0.5);
  }

  get auroraStrength(): number {
    return this.intensity('aurora');
  }

  update(
    dt: number,
    camPos: THREE.Vector3,
    biomeId: BiomeId,
    phase: TimePhase,
    speedMps: number,
    time: number,
  ): void {
    // ---- episode machine ----
    this.fade = Math.min(1, this.fade + dt / FADE_SEC);
    this.episodeLeft -= dt;
    // Aurora can't outlive the night.
    if (this.current === 'aurora' && phase !== 'night')
      this.episodeLeft = Math.min(this.episodeLeft, 0);
    if (this.episodeLeft <= 0) {
      const next = this.pick(biomeId, phase);
      if (next !== this.current) {
        this.previous = this.current;
        this.current = next;
        this.fade = 0;
        this.bus.emit('weatherChange', { id: next });
      }
      this.episodeLeft = 55 + Math.random() * 95;
    }

    // ---- rain particles ----
    const rainI = this.intensity('rain');
    (this.rain.material as THREE.PointsMaterial).opacity = rainI * 0.55;
    this.rain.visible = rainI > 0.01;
    if (this.rain.visible) {
      const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i) - this.rainVel[i] * dt;
        if (y < 0) y += 30;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this.rain.position.copy(camPos);
      this.rain.position.y = camPos.y - 8;
    }

    // ---- leaves ----
    const leafI = this.intensity('leaves');
    (this.leaves.material as THREE.MeshBasicMaterial).opacity = leafI * 0.92;
    this.leaves.visible = leafI > 0.01;
    if (this.leaves.visible) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const e = new THREE.Euler();
      const v = new THREE.Vector3();
      for (let i = 0; i < this.leafState.length; i++) {
        const L = this.leafState[i];
        L.y -= (0.9 + Math.sin(L.phase) * 0.3) * dt;
        L.x += Math.sin(time * L.spin + L.phase) * 1.6 * dt;
        L.z -= speedMps * 0.12 * dt; // slight relative drift
        if (L.y < -2) {
          L.y = 16 + Math.random() * 4;
          L.x = (Math.random() - 0.5) * 60;
          L.z = (Math.random() - 0.5) * 60;
        }
        e.set(time * L.spin, L.phase + time * 0.7, Math.sin(time + L.phase));
        q.setFromEuler(e);
        m.compose(v.set(camPos.x + L.x, camPos.y - 6 + L.y, camPos.z + L.z), q, ONE);
        this.leaves.setMatrixAt(i, m);
      }
      this.leaves.instanceMatrix.needsUpdate = true;
    }
  }

  /** Re-tint leaves for the current biome (call on biome change). */
  retintLeaves(biomeId: BiomeId): void {
    const palette = LEAF_COLORS[biomeId] ?? LEAF_DEFAULT;
    const c = new THREE.Color();
    for (let i = 0; i < this.leafState.length; i++) {
      this.leaves.setColorAt(i, c.set(palette[i % palette.length]));
    }
    if (this.leaves.instanceColor) this.leaves.instanceColor.needsUpdate = true;
  }

  private pick(biomeId: BiomeId, phase: TimePhase): WeatherId {
    const b = BIOMES[biomeId];
    const entries: Array<[WeatherId, number]> = [
      ['clear', 55],
      ['rain', 12],
      ['fog', 8 * (b.mist > 1.4 ? 2.4 : 1) * (phase === 'dawn' ? 2 : 1)],
      ['leaves', biomeId === 'autumn' ? 26 : biomeId === 'cherry' ? 22 : 4],
      ['aurora', phase === 'night' ? 13 : 0],
    ];
    let total = 0;
    for (const [, w] of entries) total += w;
    let roll = Math.random() * total;
    for (const [id, w] of entries) {
      roll -= w;
      if (roll <= 0) return id;
    }
    return 'clear';
  }

  shiftOrigin(dx: number, dz: number): void {
    this.rain.position.x += dx;
    this.rain.position.z += dz;
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
