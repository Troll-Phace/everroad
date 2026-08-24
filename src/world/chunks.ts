import * as THREE from 'three';
import { RoadPath, DS } from './roadPath';
import { BIOMES, biomeAt, blendColor, blendNumber, pickScenery, type SceneryKind } from './biomes';
import { getProto } from './scenery';
import { vertexToonMat, rng, noise2, jitterColor } from './materials';

export const CHUNK_LEN = 60;
const AHEAD = 22; // chunks ahead of the car (~1.3 km)
const BEHIND = 3;

/** Roadside object the pickups system can near-miss against. */
export interface Obstacle {
  s: number;
  lateral: number;
  radius: number;
  key: string;
}

interface Chunk {
  index: number;
  group: THREE.Group;
  obstacles: Obstacle[];
  geos: THREE.BufferGeometry[];
}

/** Terrain height in path space — shared by terrain mesh + scenery placement. */
export function terrainHeight(path: RoadPath, s: number, lat: number): number {
  const roadY = path.elevation(s);
  const a = Math.abs(lat);
  const hills =
    noise2(s * 0.006, lat * 0.011) * 7 +
    noise2(s * 0.0016, lat * 0.0028) * 16;
  const far = THREE.MathUtils.smoothstep(a, 55, 160);
  const rise = far * (10 + noise2(s * 0.001, lat * 0.002) * 14);
  const blendK = THREE.MathUtils.smoothstep(a, 6.2, 30);
  return roadY - 0.06 + blendK * (hills * 0.55 + rise) - blendK * 1.2;
}

// Road cross-section: lateral offsets + which paint each column carries.
const ROAD_COLS = [-5.5, -4.65, -4.35, -4.05, -0.16, 0.16, 4.05, 4.35, 4.65, 5.5];
type Paint = 'dirt' | 'asphalt' | 'edge' | 'dash';
const ROAD_PAINT: Paint[] = ['dirt', 'asphalt', 'edge', 'asphalt', 'dash', 'dash', 'asphalt', 'edge', 'asphalt', 'dirt'];

const COL_DIRT = new THREE.Color('#96795a');
const COL_ASPHALT = new THREE.Color('#4d4d5c');
const COL_CREAM = new THREE.Color('#f2e5c0');

// Terrain lateral columns (nonuniform: fine near road).
const TER_COLS = [-165, -115, -75, -48, -30, -18, -10, -5.9, 5.9, 10, 18, 30, 48, 75, 115, 165];
const TER_ROW_STEP = 6;

export class ChunkManager {
  private chunks = new Map<number, Chunk>();
  private mat = vertexToonMat();
  readonly root = new THREE.Group();

  constructor(private path: RoadPath, private scene: THREE.Scene) {
    scene.add(this.root);
  }

  update(carS: number): void {
    const cur = Math.floor(carS / CHUNK_LEN);
    for (let i = cur - BEHIND; i <= cur + AHEAD; i++) {
      if (i >= 0 && !this.chunks.has(i)) this.buildChunk(i);
    }
    for (const [idx, chunk] of this.chunks) {
      if (idx < cur - BEHIND || idx > cur + AHEAD) {
        this.root.remove(chunk.group);
        for (const g of chunk.geos) g.dispose();
        this.chunks.delete(idx);
      }
    }
    this.path.prune(carS - BEHIND * CHUNK_LEN - 100);
  }

  shiftOrigin(dx: number, dz: number): void {
    for (const chunk of this.chunks.values()) {
      chunk.group.position.x += dx;
      chunk.group.position.z += dz;
    }
  }

  /** Obstacles within `range` meters of path distance s. */
  *obstaclesNear(s: number, range: number): Generator<Obstacle> {
    const lo = Math.floor((s - range) / CHUNK_LEN);
    const hi = Math.floor((s + range) / CHUNK_LEN);
    for (let i = lo; i <= hi; i++) {
      const c = this.chunks.get(i);
      if (!c) continue;
      for (const ob of c.obstacles) {
        if (Math.abs(ob.s - s) <= range) yield ob;
      }
    }
  }

  // ------------------------------------------------------------------
  private buildChunk(index: number): void {
    const s0 = index * CHUNK_LEN;
    const s1 = s0 + CHUNK_LEN;
    this.path.ensure(s1 + DS);

    const group = new THREE.Group();
    // Anchor the group at the chunk start so vertex coords stay small.
    const anchor = this.path.pose(s0).pos.clone();
    anchor.y = 0;
    group.position.copy(anchor);

    const geos: THREE.BufferGeometry[] = [];
    const road = this.buildRoad(s0, s1, anchor);
    geos.push(road.geometry);
    group.add(road);
    const terrain = this.buildTerrain(s0, s1, anchor);
    geos.push(terrain.geometry);
    group.add(terrain);

    const obstacles: Obstacle[] = [];
    const scenery = this.buildScenery(index, s0, s1, anchor, obstacles);
    if (scenery) {
      geos.push(scenery.geometry);
      group.add(scenery);
    }

    this.root.add(group);
    this.chunks.set(index, { index, group, obstacles, geos });
  }

  private buildRoad(s0: number, s1: number, anchor: THREE.Vector3): THREE.Mesh {
    const rows = Math.round((s1 - s0) / DS) + 1;
    const cols = ROAD_COLS.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const p = new THREE.Vector3();
    const c = new THREE.Color();

    for (let r = 0; r < rows; r++) {
      const s = s0 + r * DS;
      const dashOn = Math.floor(s / 4) % 2 === 0;
      for (let j = 0; j < cols; j++) {
        this.path.point(s, ROAD_COLS[j], p);
        const k = (r * cols + j) * 3;
        pos[k] = p.x - anchor.x;
        pos[k + 1] = p.y + 0.02;
        pos[k + 2] = p.z - anchor.z;
        const paint = ROAD_PAINT[j];
        if (paint === 'dirt') c.copy(COL_DIRT);
        else if (paint === 'edge') c.copy(COL_CREAM);
        else if (paint === 'dash') c.copy(dashOn ? COL_CREAM : COL_ASPHALT);
        else c.copy(COL_ASPHALT);
        // subtle painterly variation
        const v = 1 + noise2(s * 0.13, j * 1.7) * 0.05;
        col[k] = c.r * v;
        col[k + 1] = c.g * v;
        col[k + 2] = c.b * v;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(gridIndices(rows, cols));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildTerrain(s0: number, s1: number, anchor: THREE.Vector3): THREE.Mesh {
    const rows = Math.round((s1 - s0) / TER_ROW_STEP) + 1;
    const cols = TER_COLS.length;
    const pos = new Float32Array(rows * cols * 3);
    const col = new Float32Array(rows * cols * 3);
    const p = new THREE.Vector3();
    const ground = new THREE.Color();
    const groundAlt = new THREE.Color();
    const mixed = new THREE.Color();

    for (let r = 0; r < rows; r++) {
      const s = s0 + r * TER_ROW_STEP;
      blendColor(s, (b) => b.ground, ground);
      blendColor(s, (b) => b.groundAlt, groundAlt);
      for (let j = 0; j < cols; j++) {
        const lat = TER_COLS[j];
        this.path.point(s, lat, p);
        const k = (r * cols + j) * 3;
        pos[k] = p.x - anchor.x;
        pos[k + 1] = terrainHeight(this.path, s, lat);
        pos[k + 2] = p.z - anchor.z;
        // Color: noise blend between ground tones + gentle brightness wobble.
        const t = noise2(s * 0.02 + 7, lat * 0.03) * 0.5 + 0.5;
        mixed.copy(ground).lerp(groundAlt, t);
        const v = 1 + noise2(s * 0.09, lat * 0.11 + 3) * 0.07;
        col[k] = mixed.r * v;
        col[k + 1] = mixed.g * v;
        col[k + 2] = mixed.b * v;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(gridIndices(rows, cols));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = true;
    return mesh;
  }

  private buildScenery(
    index: number,
    s0: number,
    s1: number,
    anchor: THREE.Vector3,
    obstacles: Obstacle[],
  ): THREE.Mesh | null {
    const r = rng((index * 2654435761) % 4294967291);
    const count = Math.round(blendNumber(s0 + CHUNK_LEN / 2, (b) => b.density) * (0.85 + r() * 0.3));

    const posOut: number[] = [];
    const normOut: number[] = [];
    const colOut: number[] = [];
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const vec = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const nm = new THREE.Matrix3();
    const tint = new THREE.Color();
    const worldP = new THREE.Vector3();

    for (let i = 0; i < count; i++) {
      const s = s0 + r() * (s1 - s0);
      const kind = pickScenery(s, r());
      const proto = getProto(kind);
      const side = r() < 0.5 ? -1 : 1;
      let lat: number;
      switch (kind) {
        case 'fence':
        case 'hay':
          lat = side * (6.8 + r() * 6);
          break;
        case 'windmill':
          lat = side * (45 + r() * 90);
          break;
        case 'sunflowerPatch':
        case 'lavenderRow':
          lat = side * (9 + r() * 55);
          break;
        case 'flowers':
        case 'grassTuft':
          lat = side * (6.5 + r() * 40);
          break;
        default:
          lat = side * (8.5 + r() * 130);
      }

      const scale =
        kind === 'windmill' ? 0.9 + r() * 0.4 :
        kind === 'rock' ? 0.6 + r() * 1.1 :
        0.75 + r() * 0.6;

      // Rows and fences align with the road; everything else spins freely.
      const heading = this.path.heading(s);
      const yaw =
        kind === 'fence' || kind === 'lavenderRow' || kind === 'sunflowerPatch'
          ? heading + Math.PI / 2 + (r() - 0.5) * 0.15
          : r() * Math.PI * 2;

      this.path.point(s, lat, worldP);
      const y = terrainHeight(this.path, s, lat);

      // Instance tint: canopy/flower/rock palette blended at s.
      pickTint(s, kind, r, tint);

      q.setFromEuler(eul.set(0, yaw, 0));
      m.compose(vec.set(worldP.x - anchor.x, y - 0.12, worldP.z - anchor.z), q, tmpScale.setScalar(scale));
      nm.getNormalMatrix(m);

      const { pos, norm, baked, shade, mask, vertexCount, radius } = proto;
      for (let vI = 0; vI < vertexCount; vI++) {
        vec.set(pos[vI * 3], pos[vI * 3 + 1], pos[vI * 3 + 2]).applyMatrix4(m);
        nrm.set(norm[vI * 3], norm[vI * 3 + 1], norm[vI * 3 + 2]).applyMatrix3(nm).normalize();
        posOut.push(vec.x, vec.y, vec.z);
        normOut.push(nrm.x, nrm.y, nrm.z);
        const sh = shade[vI];
        if (mask[vI] > 0.5) {
          colOut.push(tint.r * sh, tint.g * sh, tint.b * sh);
        } else {
          colOut.push(baked[vI * 3] * sh, baked[vI * 3 + 1] * sh, baked[vI * 3 + 2] * sh);
        }
      }

      // Near-shoulder solid objects become near-miss targets.
      if ((kind === 'hay' || kind === 'rock' || kind === 'fence') && Math.abs(lat) < 10) {
        obstacles.push({ s, lateral: lat, radius: radius * scale, key: `${index}:${i}` });
      }
    }

    if (!posOut.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posOut), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normOut), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colOut), 3));
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

const tmpScale = new THREE.Vector3();

function pickTint(s: number, kind: SceneryKind, r: () => number, out: THREE.Color): void {
  const sample = biomeAt(s);
  // Choose a biome proportional to blend weights, then a palette entry.
  let pickRoll = r();
  let biome = BIOMES[sample.id];
  for (const { id, w } of sample.weights) {
    pickRoll -= w;
    if (pickRoll <= 0) {
      biome = BIOMES[id];
      break;
    }
  }
  let base: string;
  if (kind === 'flowers' || kind === 'sunflowerPatch' || kind === 'lavenderRow') {
    base = biome.flowerColors[Math.floor(r() * biome.flowerColors.length)];
  } else if (kind === 'rock') {
    base = r() < 0.5 ? '#a8a49a' : '#8f8c85';
  } else if (kind === 'grassTuft') {
    base = r() < 0.5 ? biome.ground : biome.groundAlt;
  } else {
    base = biome.canopy[Math.floor(r() * biome.canopy.length)];
  }
  out.copy(jitterColor(tmpColor.set(base), r, 0.07));
}

const tmpColor = new THREE.Color();

function gridIndices(rows: number, cols: number): THREE.BufferAttribute {
  const idx = new Uint32Array((rows - 1) * (cols - 1) * 6);
  let k = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = r * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  return new THREE.BufferAttribute(idx, 1);
}
