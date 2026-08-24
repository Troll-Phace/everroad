import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './materials';
import type { SceneryKind } from './biomes';

/**
 * Low-poly scenery prototypes. Each prototype is a flat set of vertex arrays;
 * chunks.ts stamps them into one merged vertex-colored geometry per chunk.
 *
 * Vertices carry:
 *  - shade: brightness multiplier (painterly vertical gradient)
 *  - mask:  1 -> tint with the per-instance palette color, 0 -> keep baked color
 */

export interface Proto {
  pos: Float32Array;
  norm: Float32Array;
  baked: Float32Array; // rgb per vertex (used when mask=0; also multiplied when mask=1? no: replaced)
  shade: Float32Array;
  mask: Float32Array;
  vertexCount: number;
  /** Approximate radius for near-miss/obstacle checks. */
  radius: number;
  /** Height, used to sink base into terrain. */
  height: number;
}

interface Part {
  geo: THREE.BufferGeometry;
  matrix?: THREE.Matrix4;
  bakedColor?: string; // used when not instance-tinted
  instanceTint?: boolean;
  shadeFn?: (x: number, y: number, z: number) => number;
  jitter?: number; // vertex displacement for organic blobs
  smooth?: boolean;
}

function buildProto(parts: Part[], radius: number, height: number, seed = 7): Proto {
  const posArr: number[] = [];
  const normArr: number[] = [];
  const bakedArr: number[] = [];
  const shadeArr: number[] = [];
  const maskArr: number[] = [];
  const r = rng(seed);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();

  for (const part of parts) {
    let geo = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.jitter) {
      // Weld first so shared corners move together, then displace, then smooth.
      geo = BufferGeometryUtils.mergeVertices(geo, 1e-3);
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const jr = rng(seed * 31 + i * 7);
        p.setXYZ(
          i,
          p.getX(i) + (jr() - 0.5) * part.jitter,
          p.getY(i) + (jr() - 0.5) * part.jitter,
          p.getZ(i) + (jr() - 0.5) * part.jitter,
        );
      }
      geo.computeVertexNormals();
      geo = geo.toNonIndexed();
    } else if (part.smooth) {
      geo = BufferGeometryUtils.mergeVertices(geo, 1e-3);
      geo.computeVertexNormals();
      geo = geo.toNonIndexed();
    }
    const m = part.matrix ?? IDENTITY;
    nm.getNormalMatrix(m);
    const p = geo.attributes.position as THREE.BufferAttribute;
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    c.set(part.bakedColor ?? '#ffffff');
    for (let i = 0; i < p.count; i++) {
      v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m);
      n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(nm).normalize();
      posArr.push(v.x, v.y, v.z);
      normArr.push(n.x, n.y, n.z);
      bakedArr.push(c.r, c.g, c.b);
      shadeArr.push(part.shadeFn ? part.shadeFn(v.x, v.y, v.z) : 1);
      maskArr.push(part.instanceTint ? 1 : 0);
    }
    geo.dispose();
  }
  void r;
  return {
    pos: new Float32Array(posArr),
    norm: new Float32Array(normArr),
    baked: new Float32Array(bakedArr),
    shade: new Float32Array(shadeArr),
    mask: new Float32Array(maskArr),
    vertexCount: posArr.length / 3,
    radius,
    height,
  };
}

const IDENTITY = new THREE.Matrix4();

function mat(
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = 1,
  sz = 1,
  ry = 0,
  rz = 0,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Canopy vertical gradient: darker at the bottom — painterly volume. */
function canopyShade(baseY: number, topY: number) {
  return (_x: number, y: number, _z: number) =>
    0.72 + 0.38 * THREE.MathUtils.clamp((y - baseY) / (topY - baseY), 0, 1);
}

const TRUNK = '#7a5238';
const TRUNK_LIGHT = '#8f6244';

function blob(r: number): THREE.BufferGeometry {
  return new THREE.IcosahedronGeometry(r, 1);
}

const protoCache = new Map<SceneryKind, Proto>();

export function getProto(kind: SceneryKind): Proto {
  let p = protoCache.get(kind);
  if (!p) {
    p = buildInner(kind);
    protoCache.set(kind, p);
  }
  return p;
}

function buildInner(kind: SceneryKind): Proto {
  switch (kind) {
    case 'oak':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.28, 0.45, 2.4, 6),
            matrix: mat(0, 1.2, 0),
            bakedColor: TRUNK,
          },
          {
            geo: blob(1.9),
            matrix: mat(0, 3.6, 0, 1, 0.92, 1),
            instanceTint: true,
            jitter: 0.34,
            shadeFn: canopyShade(1.8, 5.4),
          },
          {
            geo: blob(1.25),
            matrix: mat(1.15, 2.9, 0.4),
            instanceTint: true,
            jitter: 0.3,
            shadeFn: canopyShade(1.6, 4.2),
          },
          {
            geo: blob(1.1),
            matrix: mat(-1.05, 3.1, -0.35),
            instanceTint: true,
            jitter: 0.28,
            shadeFn: canopyShade(1.8, 4.3),
          },
        ],
        2.4,
        5.5,
        11,
      );
    case 'maple':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.24, 0.4, 3.0, 6),
            matrix: mat(0, 1.5, 0),
            bakedColor: TRUNK,
          },
          {
            geo: blob(2.2),
            matrix: mat(0, 4.6, 0, 1, 1.05, 1),
            instanceTint: true,
            jitter: 0.42,
            shadeFn: canopyShade(2.4, 7.0),
          },
          {
            geo: blob(1.35),
            matrix: mat(1.3, 3.6, 0.5),
            instanceTint: true,
            jitter: 0.34,
            shadeFn: canopyShade(2.2, 5.0),
          },
          {
            geo: blob(1.2),
            matrix: mat(-1.25, 3.9, -0.4),
            instanceTint: true,
            jitter: 0.32,
            shadeFn: canopyShade(2.4, 5.2),
          },
        ],
        2.6,
        6.9,
        13,
      );
    case 'pine':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.22, 0.34, 1.6, 6),
            matrix: mat(0, 0.8, 0),
            bakedColor: TRUNK,
          },
          {
            geo: new THREE.ConeGeometry(2.0, 2.6, 7),
            matrix: mat(0, 2.4, 0),
            instanceTint: true,
            smooth: true,
            shadeFn: canopyShade(1.1, 3.7),
          },
          {
            geo: new THREE.ConeGeometry(1.5, 2.3, 7),
            matrix: mat(0, 4.0, 0),
            instanceTint: true,
            smooth: true,
            shadeFn: canopyShade(2.9, 5.2),
          },
          {
            geo: new THREE.ConeGeometry(1.0, 2.0, 7),
            matrix: mat(0, 5.5, 0),
            instanceTint: true,
            smooth: true,
            shadeFn: canopyShade(4.5, 6.5),
          },
        ],
        2.1,
        6.5,
        17,
      );
    case 'poplar':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6),
            matrix: mat(0, 0.8, 0),
            bakedColor: TRUNK_LIGHT,
          },
          {
            geo: blob(1.4),
            matrix: mat(0, 4.2, 0, 1, 2.5, 1),
            instanceTint: true,
            jitter: 0.3,
            shadeFn: canopyShade(1.0, 7.6),
          },
        ],
        1.6,
        7.7,
        19,
      );
    case 'cherryTree':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.26, 0.42, 2.2, 6),
            matrix: mat(0, 1.1, 0, 1, 1, 1, 0, 0.12),
            bakedColor: '#6b4a3a',
          },
          {
            geo: blob(2.1),
            matrix: mat(0, 3.6, 0, 1.25, 0.78, 1.25),
            instanceTint: true,
            jitter: 0.4,
            shadeFn: canopyShade(2.0, 5.0),
          },
          {
            geo: blob(1.2),
            matrix: mat(1.5, 3.1, 0.5, 1.1, 0.75, 1.1),
            instanceTint: true,
            jitter: 0.3,
            shadeFn: canopyShade(1.9, 4.1),
          },
          {
            geo: blob(1.05),
            matrix: mat(-1.4, 3.3, -0.4, 1.1, 0.7, 1.1),
            instanceTint: true,
            jitter: 0.3,
            shadeFn: canopyShade(2.1, 4.2),
          },
        ],
        2.7,
        4.9,
        23,
      );
    case 'rock':
      return buildProto(
        [
          {
            geo: new THREE.IcosahedronGeometry(0.9, 0),
            matrix: mat(0, 0.42, 0, 1.25, 0.8, 1.0),
            instanceTint: true,
            jitter: 0.22,
            shadeFn: (_x, y) => 0.8 + y * 0.3,
          },
          {
            geo: new THREE.IcosahedronGeometry(0.55, 0),
            matrix: mat(0.9, 0.25, 0.3, 1, 0.75, 1),
            instanceTint: true,
            jitter: 0.16,
            shadeFn: (_x, y) => 0.8 + y * 0.3,
          },
        ],
        1.4,
        1.2,
        29,
      );
    case 'flowers': {
      const parts: Part[] = [];
      const r = rng(31);
      for (let i = 0; i < 4; i++) {
        const x = (r() - 0.5) * 1.6;
        const z = (r() - 0.5) * 1.6;
        const h = 0.5 + r() * 0.35;
        parts.push({
          geo: new THREE.CylinderGeometry(0.03, 0.04, h, 4),
          matrix: mat(x, h / 2, z),
          bakedColor: '#5da84e',
        });
        parts.push({
          geo: blob(0.16),
          matrix: mat(x, h + 0.08, z),
          instanceTint: true,
          shadeFn: () => 1.1,
        });
      }
      return buildProto(parts, 1.0, 0.9, 31);
    }
    case 'grassTuft': {
      const parts: Part[] = [];
      const r = rng(37);
      for (let i = 0; i < 5; i++) {
        const x = (r() - 0.5) * 1.3;
        const z = (r() - 0.5) * 1.3;
        const h = 0.5 + r() * 0.5;
        parts.push({
          geo: new THREE.ConeGeometry(0.16, h, 4),
          matrix: mat(x, h / 2, z, 1, 1, 1, r() * 3, (r() - 0.5) * 0.35),
          instanceTint: true,
          shadeFn: (_x, y) => 0.85 + y * 0.4,
        });
      }
      return buildProto(parts, 0.9, 1.0, 37);
    }
    case 'hay':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.85, 0.85, 1.5, 10),
            matrix: mat(0, 0.85, 0, 1, 1, 1, 0, Math.PI / 2),
            bakedColor: '#e0b95c',
            smooth: true,
            shadeFn: (_x, y) => 0.78 + y * 0.32,
          },
        ],
        1.5,
        1.7,
        41,
      );
    case 'fence': {
      const parts: Part[] = [];
      for (let i = 0; i < 3; i++) {
        parts.push({
          geo: new THREE.BoxGeometry(0.14, 1.1, 0.14),
          matrix: mat(-2 + i * 2, 0.55, 0),
          bakedColor: '#8a6142',
        });
      }
      parts.push({
        geo: new THREE.BoxGeometry(4.3, 0.1, 0.08),
        matrix: mat(0, 0.85, 0),
        bakedColor: '#9c7250',
      });
      parts.push({
        geo: new THREE.BoxGeometry(4.3, 0.1, 0.08),
        matrix: mat(0, 0.45, 0),
        bakedColor: '#9c7250',
      });
      return buildProto(parts, 2.2, 1.1, 43);
    }
    case 'windmill':
      return buildProto(
        [
          {
            geo: new THREE.CylinderGeometry(0.9, 1.6, 9, 7),
            matrix: mat(0, 4.5, 0),
            bakedColor: '#e8ddc8',
          },
          {
            geo: new THREE.ConeGeometry(1.15, 1.6, 7),
            matrix: mat(0, 9.7, 0),
            bakedColor: '#a06a4a',
          },
          {
            geo: new THREE.BoxGeometry(0.28, 7.4, 0.06),
            matrix: mat(0, 8.6, 1.15, 1, 1, 1, 0, 0.6),
            bakedColor: '#8a6142',
          },
          {
            geo: new THREE.BoxGeometry(7.4, 0.28, 0.06),
            matrix: mat(0, 8.6, 1.15, 1, 1, 1, 0, 0.6),
            bakedColor: '#8a6142',
          },
        ],
        2.2,
        10.4,
        47,
      );
    case 'sunflowerPatch': {
      const parts: Part[] = [];
      const r = rng(53);
      for (let i = 0; i < 7; i++) {
        const x = (r() - 0.5) * 2.6;
        const z = (r() - 0.5) * 2.6;
        const h = 1.1 + r() * 0.5;
        parts.push({
          geo: new THREE.CylinderGeometry(0.04, 0.05, h, 4),
          matrix: mat(x, h / 2, z),
          bakedColor: '#4e9440',
        });
        parts.push({
          geo: blob(0.24),
          matrix: mat(x, h + 0.1, z, 1, 0.6, 1),
          instanceTint: true,
          shadeFn: () => 1.15,
        });
        parts.push({ geo: blob(0.09), matrix: mat(x, h + 0.16, z), bakedColor: '#7a4a26' });
      }
      return buildProto(parts, 1.7, 1.7, 53);
    }
    case 'lavenderRow': {
      const parts: Part[] = [];
      const r = rng(59);
      for (let i = 0; i < 6; i++) {
        const x = -2.2 + i * 0.9 + (r() - 0.5) * 0.2;
        parts.push({
          geo: blob(0.42),
          matrix: mat(x, 0.42, (r() - 0.5) * 0.3, 1, 1.5, 1),
          instanceTint: true,
          jitter: 0.12,
          shadeFn: (_x, y) => 0.8 + y * 0.5,
        });
      }
      return buildProto(parts, 2.4, 1.1, 59);
    }
    case 'reeds': {
      const parts: Part[] = [];
      const r = rng(61);
      for (let i = 0; i < 6; i++) {
        const x = (r() - 0.5) * 1.6;
        const z = (r() - 0.5) * 1.6;
        const h = 1.3 + r() * 0.9;
        parts.push({
          geo: new THREE.ConeGeometry(0.09, h, 4),
          matrix: mat(x, h / 2, z, 1, 1, 1, 0, (r() - 0.5) * 0.22),
          bakedColor: i % 2 ? '#c2b268' : '#8fa858',
          shadeFn: (_x, y) => 0.85 + y * 0.25,
        });
      }
      return buildProto(parts, 1.1, 2.0, 61);
    }
  }
}
