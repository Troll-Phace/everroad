/**
 * Decoder for the handcrafted-model data in `generated.ts`.
 *
 * The encoder is `scripts/lib/model-codec.mjs`; the two are round-tripped
 * against each other in `codec.test.ts`, because a silent drift here would
 * ship a mangled mesh rather than fail a build.
 *
 * Binary layout, per part, little-endian:
 *
 *   Int16  positions[vertexCount * 3]   quantised into the part's bbox
 *   Uint16 indices  [triCount * 3]
 *   Uint8  shade    [vertexCount]       present only when hasShade
 *
 * Normals are derived here from triangle winding — flat by default, averaged
 * when the part is marked smooth — which is how the procedural protos shade
 * too, and saves three bytes a vertex in the bundle.
 */

import type { CarBodyType } from '../../types';

export type ModelProfile = 'scenery' | 'car';
export type PartRole = 'static' | 'wheel' | 'hub' | 'hoverPad' | 'glow';

export interface EncodedPart {
  name: string;
  role: PartRole;
  /** A profile slot ('body', 'tint', …) or a literal '#rrggbb'. */
  slot: string;
  smooth: boolean;
  vertexCount: number;
  triCount: number;
  /** [minX, minY, minZ, maxX, maxY, maxZ] — the quantisation range. */
  bbox: readonly number[];
  hasShade: boolean;
  data: string;
  /** Spin/pulse origin for wheel, hub and hoverPad parts. */
  pivot?: readonly number[];
}

export interface SceneryMeta {
  radius: number;
  height: number;
}

export interface CarMeta {
  bodyType: CarBodyType;
  wheelRadius: number;
  scaleHint: number;
}

export type EncodedModel =
  | { name: string; profile: 'scenery'; meta: SceneryMeta; parts: EncodedPart[] }
  | { name: string; profile: 'car'; meta: CarMeta; parts: EncodedPart[] };

/** One part expanded to non-indexed triangles, ready for a BufferGeometry. */
export interface ExpandedPart {
  name: string;
  role: PartRole;
  slot: string;
  pivot: readonly [number, number, number];
  /** vertexCount = triCount * 3 */
  positions: Float32Array;
  normals: Float32Array;
  /** Per-expanded-vertex brightness multiplier; all 1 when the part has none. */
  shade: Float32Array;
  vertexCount: number;
}

const POS_RANGE = 65535;
const SHADE_SCALE = 2;

function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Expand one encoded part into flat, non-indexed arrays with normals. */
export function decodePart(part: EncodedPart): ExpandedPart {
  const { vertexCount, triCount, bbox, hasShade } = part;
  const bytes = fromBase64(part.data);
  const expected = vertexCount * 6 + triCount * 6 + (hasShade ? vertexCount : 0);
  if (bytes.byteLength !== expected) {
    throw new Error(
      `model part "${part.name}": expected ${expected} bytes, decoded ${bytes.byteLength}`,
    );
  }

  const buffer = bytes.buffer as ArrayBuffer;
  const quantized = new Int16Array(buffer, bytes.byteOffset, vertexCount * 3);
  const indices = new Uint16Array(buffer, bytes.byteOffset + vertexCount * 6, triCount * 3);

  // Dequantise into the part's bounding box.
  const verts = new Float32Array(vertexCount * 3);
  for (let a = 0; a < 3; a++) {
    const min = bbox[a];
    const span = bbox[a + 3] - min;
    for (let v = 0; v < vertexCount; v++) {
      const i = v * 3 + a;
      verts[i] = span <= 0 ? min : min + ((quantized[i] + 32768) / POS_RANGE) * span;
    }
  }

  const shadeIn = new Float32Array(vertexCount);
  if (hasShade) {
    const raw = new Uint8Array(
      buffer,
      bytes.byteOffset + vertexCount * 6 + triCount * 6,
      vertexCount,
    );
    for (let v = 0; v < vertexCount; v++) shadeIn[v] = (raw[v] / 255) * SHADE_SCALE;
  } else {
    shadeIn.fill(1);
  }

  const smoothNormals = part.smooth ? accumulateNormals(verts, indices, vertexCount) : null;

  const out = triCount * 3;
  const positions = new Float32Array(out * 3);
  const normals = new Float32Array(out * 3);
  const shade = new Float32Array(out);

  const ax = new Float32Array(3);
  const bx = new Float32Array(3);

  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    let nx = 0;
    let ny = 0;
    let nz = 0;
    if (!smoothNormals) {
      for (let a = 0; a < 3; a++) {
        ax[a] = verts[i1 * 3 + a] - verts[i0 * 3 + a];
        bx[a] = verts[i2 * 3 + a] - verts[i0 * 3 + a];
      }
      nx = ax[1] * bx[2] - ax[2] * bx[1];
      ny = ax[2] * bx[0] - ax[0] * bx[2];
      nz = ax[0] * bx[1] - ax[1] * bx[0];
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
    }

    const tri = [i0, i1, i2];
    for (let c = 0; c < 3; c++) {
      const src = tri[c];
      const dst = t * 3 + c;
      positions[dst * 3] = verts[src * 3];
      positions[dst * 3 + 1] = verts[src * 3 + 1];
      positions[dst * 3 + 2] = verts[src * 3 + 2];
      if (smoothNormals) {
        normals[dst * 3] = smoothNormals[src * 3];
        normals[dst * 3 + 1] = smoothNormals[src * 3 + 1];
        normals[dst * 3 + 2] = smoothNormals[src * 3 + 2];
      } else {
        normals[dst * 3] = nx;
        normals[dst * 3 + 1] = ny;
        normals[dst * 3 + 2] = nz;
      }
      shade[dst] = shadeIn[src];
    }
  }

  const p = part.pivot;
  return {
    name: part.name,
    role: part.role,
    slot: part.slot,
    pivot: p ? [p[0], p[1], p[2]] : [0, 0, 0],
    positions,
    normals,
    shade,
    vertexCount: out,
  };
}

/** Area-weighted vertex normals over the indexed form. */
function accumulateNormals(verts: Float32Array, indices: Uint16Array, vertexCount: number) {
  const acc = new Float32Array(vertexCount * 3);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t];
    const i1 = indices[t + 1];
    const i2 = indices[t + 2];
    const ax = verts[i1 * 3] - verts[i0 * 3];
    const ay = verts[i1 * 3 + 1] - verts[i0 * 3 + 1];
    const az = verts[i1 * 3 + 2] - verts[i0 * 3 + 2];
    const bx = verts[i2 * 3] - verts[i0 * 3];
    const by = verts[i2 * 3 + 1] - verts[i0 * 3 + 1];
    const bz = verts[i2 * 3 + 2] - verts[i0 * 3 + 2];
    // Un-normalised cross product weights each face by twice its area.
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    for (const i of [i0, i1, i2]) {
      acc[i * 3] += nx;
      acc[i * 3 + 1] += ny;
      acc[i * 3 + 2] += nz;
    }
  }
  for (let v = 0; v < vertexCount; v++) {
    const len = Math.hypot(acc[v * 3], acc[v * 3 + 1], acc[v * 3 + 2]) || 1;
    acc[v * 3] /= len;
    acc[v * 3 + 1] /= len;
    acc[v * 3 + 2] /= len;
  }
  return acc;
}

/** Total triangles in a model — used by the viewer and the budget report. */
export function modelTriangles(model: EncodedModel): number {
  return model.parts.reduce((sum, p) => sum + p.triCount, 0);
}
