/**
 * Handcrafted scenery -> `Proto`.
 *
 * The output is byte-for-byte the same shape `buildProto` produces in
 * `scenery.ts`, so `chunks.ts` stamps a Blender-authored tree through exactly
 * the same merged-geometry path as a procedural one — no extra draw call, no
 * second material, no branch in the hot loop.
 */

import * as THREE from 'three';
import type { Proto } from '../scenery';
import { decodePart, type EncodedModel, type SceneryMeta } from './codec';
import { sceneryModel } from './registry';

const cache = new Map<string, Proto>();

/** The handcrafted proto for a scenery kind, or null to stay procedural. */
export function handcraftedProto(kind: string): Proto | null {
  const cached = cache.get(kind);
  if (cached) return cached;

  const model = sceneryModel(kind);
  if (!model) return null;

  const proto = buildProtoFromModel(model);
  cache.set(kind, proto);
  return proto;
}

/** Exported for the model viewer, which builds protos outside the cache. */
export function buildProtoFromModel(model: EncodedModel): Proto {
  const meta = model.meta as SceneryMeta;
  const parts = model.parts.map(decodePart);
  const total = parts.reduce((sum, p) => sum + p.vertexCount, 0);

  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  const baked = new Float32Array(total * 3);
  const shade = new Float32Array(total);
  const mask = new Float32Array(total);

  const color = new THREE.Color();
  let v = 0;

  for (const part of parts) {
    const tinted = part.slot === 'tint';
    // A literal slot is an sRGB hex; THREE.Color converts it the same way the
    // procedural builder's `bakedColor` does, so the two match under the ramp.
    if (!tinted) color.set(part.slot);

    pos.set(part.positions, v * 3);
    norm.set(part.normals, v * 3);
    shade.set(part.shade, v);
    for (let i = 0; i < part.vertexCount; i++) {
      const o = (v + i) * 3;
      baked[o] = tinted ? 1 : color.r;
      baked[o + 1] = tinted ? 1 : color.g;
      baked[o + 2] = tinted ? 1 : color.b;
      mask[v + i] = tinted ? 1 : 0;
    }
    v += part.vertexCount;
  }

  return {
    pos,
    norm,
    baked,
    shade,
    mask,
    vertexCount: total,
    radius: meta.radius,
    height: meta.height,
  };
}
