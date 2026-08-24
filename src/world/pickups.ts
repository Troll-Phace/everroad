import * as THREE from 'three';
import type { EventBus } from '../types';
import type { RoadPath } from './roadPath';
import { CHUNK_LEN, type ChunkManager } from './chunks';
import type { Vehicle } from './vehicle';
import { toonMat } from './materials';

/**
 * Coins, relics, near-misses, and the style combo meter.
 * Economy math is injected so world code never imports game logic.
 */

export interface PickupDeps {
  getMagnetRadius(): number;
  getPickupCoinValue(combo: number): number;
  getRelicChancePerMile(): number;
  getComboCap(): number;
  getComboDuration(): number;
  onCoins(amount: number): void;
  onRelic(): void;
  onNearMiss(): void;
}

const COIN_CAP = 160;
/** Relic gem radius in meters — one shared geometry serves every spawn. */
const RELIC_RADIUS = 0.5;
/** Near-miss dedupe entries tolerated before dead chunks are pruned out. */
const CONSUMED_PRUNE_AT = 400;

interface Coin {
  s: number;
  lateral: number;
  y: number;
  active: boolean;
}

export class Pickups {
  combo = 1;
  comboTimer = 0;

  private coins: Coin[] = [];
  private coinMesh: THREE.InstancedMesh;
  private furthestSpawn = 120;
  private relic: { s: number; lateral: number; mesh: THREE.Mesh } | null = null;
  private relicMiles = 0;
  // At most one relic is live at a time, so a single geometry + material is
  // shared across every spawn instead of allocating (and leaking) per spawn.
  private relicGeo = new THREE.IcosahedronGeometry(RELIC_RADIUS, 0);
  private relicMat = new THREE.MeshToonMaterial({
    color: '#c9a0ff',
    emissive: 0x7a3aff,
    emissiveIntensity: 1,
  });
  /** Obstacle key -> owning chunk index, so dead chunks can be pruned. */
  private consumedObstacles = new Map<string, number>();
  private time = 0;

  constructor(
    private scene: THREE.Scene,
    private path: RoadPath,
    private chunks: ChunkManager,
    private bus: EventBus,
    private deps: PickupDeps,
  ) {
    const geo = new THREE.CylinderGeometry(0.34, 0.34, 0.09, 14);
    geo.rotateX(Math.PI / 2); // face the road
    const mat = toonMat('#ffd23f', { emissive: 0x8a6a10 });
    this.coinMesh = new THREE.InstancedMesh(geo, mat, COIN_CAP);
    this.coinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coinMesh.frustumCulled = false;
    this.coinMesh.count = 0;
    scene.add(this.coinMesh);
    for (let i = 0; i < COIN_CAP; i++) this.coins.push({ s: 0, lateral: 0, y: 0, active: false });
  }

  update(dt: number, vehicle: Vehicle, milesDelta: number): void {
    this.time += dt;
    const carS = vehicle.s;
    const carLat = vehicle.lateral;
    const active = vehicle.isActive;

    // ---- combo ----
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
    } else if (this.combo > 1) {
      this.combo = Math.max(1, this.combo - dt * 1.6);
    }
    if (vehicle.isDrifting) this.gainCombo(dt * 0.28);

    // ---- spawn coin patterns ahead ----
    if (this.furthestSpawn < carS + 380) {
      this.spawnPattern(this.furthestSpawn + 55 + Math.random() * 110);
    }

    // ---- coins: magnet, collect, cull, render ----
    // Magnet only works with hands on the wheel — idle cruising still scoops
    // direct hits, but weaving is what pays.
    const magnetR = active ? this.deps.getMagnetRadius() : 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const v = new THREE.Vector3();
    const p = new THREE.Vector3();
    let renderCount = 0;
    for (const coin of this.coins) {
      if (!coin.active) continue;
      if (coin.s < carS - 25) {
        coin.active = false;
        continue;
      }
      const ds = coin.s - carS;
      const dl = coin.lateral - carLat;
      const dist = Math.hypot(ds, dl);
      // Magnet pull
      if (dist < magnetR && dist > 0.01) {
        const pull = (1 - dist / magnetR) * 26 * dt;
        coin.s -= (ds / dist) * pull;
        coin.lateral -= (dl / dist) * pull;
      }
      // Collect
      if (Math.abs(coin.s - carS) < 1.9 && Math.abs(coin.lateral - carLat) < 1.4) {
        coin.active = false;
        if (active) this.gainCombo(0.12);
        const value = this.deps.getPickupCoinValue(this.combo);
        this.deps.onCoins(value);
        this.bus.emit('pickup', { kind: 'coin', value });
        continue;
      }
      if (renderCount < COIN_CAP && coin.s < carS + 320) {
        this.path.point(coin.s, coin.lateral, p);
        const bob = Math.sin(this.time * 2.2 + coin.s * 0.5) * 0.08;
        e.set(0, this.time * 2.4 + coin.s, 0);
        q.setFromEuler(e);
        m.compose(v.set(p.x, p.y + 0.75 + bob, p.z), q, ONE);
        this.coinMesh.setMatrixAt(renderCount++, m);
      }
    }
    this.coinMesh.count = renderCount;
    this.coinMesh.instanceMatrix.needsUpdate = true;

    // ---- relics ----
    this.relicMiles += milesDelta;
    if (!this.relic && this.relicMiles > 0.05) {
      const chance = this.deps.getRelicChancePerMile() * this.relicMiles;
      this.relicMiles = 0;
      if (Math.random() < chance) this.spawnRelic(carS + 260);
    }
    if (this.relic) {
      const r = this.relic;
      r.mesh.rotation.y += dt * 1.4;
      r.mesh.position.y += Math.sin(this.time * 2.6) * 0.003;
      this.relicMat.emissiveIntensity = 0.9 + Math.sin(this.time * 4) * 0.35;
      if (r.s < carS - 30) {
        this.scene.remove(r.mesh);
        this.relic = null;
      } else if (Math.abs(r.s - carS) < 2.4 && Math.abs(r.lateral - carLat) < 2.6) {
        this.scene.remove(r.mesh);
        this.relic = null;
        this.deps.onRelic();
        this.gainCombo(0.5);
        this.bus.emit('pickup', { kind: 'relic', value: 1 });
      }
    }

    // ---- near-misses ----
    if (active && vehicle.speedMps > 9) {
      for (const ob of this.chunks.obstaclesNear(carS, 6)) {
        if (this.consumedObstacles.has(ob.key)) continue;
        if (Math.abs(ob.s - carS) > 1.6) continue;
        const gap = Math.abs(ob.lateral - carLat) - ob.radius;
        if (gap > -0.2 && gap < 1.9) {
          this.consumedObstacles.set(ob.key, Math.floor(ob.s / CHUNK_LEN));
          this.gainCombo(0.4);
          this.deps.onNearMiss();
          this.bus.emit('nearMiss', { comboNow: this.combo });
        }
      }
      if (this.consumedObstacles.size > CONSUMED_PRUNE_AT) this.pruneConsumed();
    }
  }

  /**
   * Drop dedupe entries whose chunk has been recycled. Clearing wholesale
   * would re-arm obstacles still inside the +/-1.6 m award window and let them
   * pay out twice.
   */
  private pruneConsumed(): void {
    for (const [key, chunkIndex] of this.consumedObstacles) {
      if (!this.chunks.hasChunk(chunkIndex)) this.consumedObstacles.delete(key);
    }
  }

  private gainCombo(amount: number): void {
    this.combo = Math.min(this.deps.getComboCap(), this.combo + amount);
    this.comboTimer = this.deps.getComboDuration();
  }

  private spawnPattern(startS: number): void {
    const kind = Math.floor(Math.random() * 4);
    const count = 7 + Math.floor(Math.random() * 4);
    const baseLat = (Math.random() - 0.5) * 6;
    const targetLat = (Math.random() - 0.5) * 6;
    for (let i = 0; i < count; i++) {
      const coin = this.coins.find((c) => !c.active);
      if (!coin) break;
      const t = i / (count - 1);
      coin.s = startS + i * 3.4;
      switch (kind) {
        case 0:
          coin.lateral = baseLat;
          break; // straight line
        case 1:
          coin.lateral = THREE.MathUtils.lerp(baseLat, targetLat, t);
          break; // sweep
        case 2:
          coin.lateral = Math.sin(t * Math.PI * 2) * 3.2;
          break; // slalom
        default:
          coin.lateral = baseLat + Math.sin(t * Math.PI) * 2.6;
          break; // arc
      }
      coin.lateral = THREE.MathUtils.clamp(coin.lateral, -4, 4);
      coin.active = true;
    }
    this.furthestSpawn = startS + count * 3.4;
  }

  private spawnRelic(s: number): void {
    const lateral = (Math.random() < 0.5 ? -1 : 1) * 5.6;
    const mesh = new THREE.Mesh(this.relicGeo, this.relicMat);
    const p = this.path.point(s, lateral);
    mesh.position.set(p.x, p.y + 1.1, p.z);
    this.scene.add(mesh);
    this.relic = { s, lateral, mesh };
  }

  /**
   * Release the GPU resources this system owns. Materials from the shared
   * `toonMat` cache (the coin material) are used elsewhere and are
   * deliberately not disposed here, matching disposeCar in car.ts.
   */
  dispose(): void {
    if (this.relic) {
      this.scene.remove(this.relic.mesh);
      this.relic = null;
    }
    this.scene.remove(this.coinMesh);
    this.coinMesh.geometry.dispose();
    this.coinMesh.dispose();
    this.relicGeo.dispose();
    this.relicMat.dispose();
  }

  /**
   * Clear every live coin, the relic, the combo and the near-miss dedupe.
   * Called when the car teleports along the path (attract-mode re-seed, or
   * starting a journey from the menu): coins and obstacles are keyed by
   * absolute `s`, so leaving them alive would strand them behind the car and
   * carry a menu-earned combo into play.
   */
  reset(carS: number): void {
    for (const coin of this.coins) coin.active = false;
    this.coinMesh.count = 0;
    this.coinMesh.instanceMatrix.needsUpdate = true;
    if (this.relic) {
      this.scene.remove(this.relic.mesh);
      this.relic = null;
    }
    this.relicMiles = 0;
    this.consumedObstacles.clear();
    this.combo = 1;
    this.comboTimer = 0;
    // Re-arm the spawn cursor just ahead of the car, the same gap the
    // constructor seeds at s = 0; leaving it behind would trickle patterns in
    // one per frame from the old origin.
    this.furthestSpawn = carS + 120;
  }

  shiftOrigin(dx: number, dz: number): void {
    if (this.relic) {
      this.relic.mesh.position.x += dx;
      this.relic.mesh.position.z += dz;
    }
    // Coins live in path space (s, lateral) — matrices rebuilt each frame.
  }
}

const ONE = new THREE.Vector3(1, 1, 1);
