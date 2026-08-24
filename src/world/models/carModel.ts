/**
 * Handcrafted car -> `CarRig`.
 *
 * Assembles the same rig shape `buildCar` returns, so `animateCar`,
 * `hoverBob`, `disposeCar`, the chase camera and the exhaust emitters all keep
 * working against a Blender-authored car with no changes.
 *
 * Two contracts are load-bearing and reproduced here exactly:
 *
 *  - a wheel spins about its mesh's **local Y**, because the procedural tyre
 *    is a cylinder turned 90° about Z. Handcrafted wheel geometry is authored
 *    in its final orientation, so it is counter-rotated into the same frame
 *    and put into the same axle frame — the same `rotation.z` and the same
 *    `ZYX` Euler order, without which `rotation.y` yaws the wheel rather than
 *    rolling it (see `axleFrame` in wheelFrame.ts). Net orientation is
 *    identical; the spin axis is now the axle.
 *  - `wheelGroup.children` is `[tire, hub]`. A rig without a modelled hub gets
 *    an empty placeholder so the index stays valid.
 */

import * as THREE from 'three';
import type { CarStyle } from '../../types';
import type { CarRig } from '../car';
import { axleFrame } from '../wheelFrame';
import {
  GLASS,
  GLOW_COLOR,
  GLOW_OPACITY,
  HEAD_COLOR,
  HEAD_EMISSIVE,
  HUB,
  PAD_COLOR,
  PAD_OPACITY,
  TAIL_COLOR,
  TAIL_EMISSIVE,
  TIRE,
} from '../carPalette';
import { toonMat } from '../materials';
import { decodePart, type CarMeta, type EncodedModel, type ExpandedPart } from './codec';
import { carModel } from './registry';

/** Decoded parts are cached per model; geometry is rebuilt per rig. */
const cache = new Map<string, ExpandedPart[]>();

/** The handcrafted rig for a style, or null to stay procedural. */
export function handcraftedCar(style: CarStyle): CarRig | null {
  const model = carModel(style.bodyType);
  if (!model) return null;
  return buildRigFromModel(model, style);
}

/** Exported for the model viewer, which bypasses the registry. */
export function buildRigFromModel(model: EncodedModel, style: CarStyle): CarRig {
  const meta = model.meta as CarMeta;
  let parts = cache.get(model.name);
  if (!parts) {
    parts = model.parts.map(decodePart);
    cache.set(model.name, parts);
  }

  const group = new THREE.Group();
  const wheels: THREE.Mesh[] = [];
  const hoverPads: THREE.Mesh[] = [];
  const ownedMaterials: THREE.Material[] = [];

  let padMat: THREE.MeshBasicMaterial | null = null;
  const additive = (slot: string) =>
    padMaterial(
      slot,
      ownedMaterials,
      () => padMat,
      (m) => (padMat = m),
    );

  const hubs = new Map<string, ExpandedPart>();
  for (const part of parts) {
    if (part.role === 'hub') hubs.set(suffixOf(part.name), part);
  }

  for (const part of parts) {
    if (part.role === 'hub') continue; // attached by its wheel below

    if (part.role === 'wheel') {
      const wheelGroup = new THREE.Group();
      wheelGroup.position.set(part.pivot[0], part.pivot[1], part.pivot[2]);

      const tire = new THREE.Mesh(
        spinFrame(geometryOf(part)),
        material(part.slot, style, additive),
      );
      axleFrame(tire);
      tire.castShadow = true;
      wheelGroup.add(tire);

      const hubPart = hubs.get(suffixOf(part.name));
      if (hubPart) {
        const hub = new THREE.Mesh(
          spinFrame(geometryOf(hubPart), part.pivot, hubPart.pivot),
          material(hubPart.slot, style, additive),
        );
        axleFrame(hub);
        wheelGroup.add(hub);
      } else {
        wheelGroup.add(new THREE.Object3D());
      }

      group.add(wheelGroup);
      wheels.push(tire);
      tire.userData.wheelGroup = wheelGroup;
      continue;
    }

    const mesh = new THREE.Mesh(geometryOf(part), material(part.slot, style, additive));
    if (part.role === 'hoverPad' || part.role === 'glow') {
      mesh.position.set(part.pivot[0], part.pivot[1], part.pivot[2]);
      if (part.role === 'hoverPad') hoverPads.push(mesh);
    } else {
      mesh.castShadow = part.slot !== 'glass';
    }
    group.add(mesh);
  }

  group.scale.setScalar(style.scale);

  return {
    group,
    wheels,
    hoverPads,
    bodyType: meta.bodyType,
    wheelRadius: meta.wheelRadius * style.scale,
    ownedMaterials,
  };
}

function suffixOf(name: string): string {
  return name.split('_').pop() ?? name;
}

/** Fresh attribute arrays per rig — `disposeCar` disposes what it is given. */
function geometryOf(part: ExpandedPart): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(part.positions.slice(), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(part.normals.slice(), 3));
  return geo;
}

/**
 * Move geometry into the wheel's spin frame: subtract any pivot difference,
 * then counter-rotate so the mesh's `rotation.z = π/2` restores the authored
 * orientation and local Y becomes the axle.
 */
function spinFrame(
  geo: THREE.BufferGeometry,
  wheelPivot?: readonly number[],
  partPivot?: readonly number[],
): THREE.BufferGeometry {
  if (wheelPivot && partPivot) {
    geo.translate(
      partPivot[0] - wheelPivot[0],
      partPivot[1] - wheelPivot[1],
      partPivot[2] - wheelPivot[2],
    );
  }
  geo.rotateZ(-Math.PI / 2);
  return geo;
}

function material(
  slot: string,
  style: CarStyle,
  additive: (slot: string) => THREE.Material,
): THREE.Material {
  switch (slot) {
    case 'body':
      return toonMat(style.bodyColor);
    case 'accent':
      return toonMat(style.accentColor);
    case 'glass':
      return toonMat(GLASS);
    case 'tire':
      return toonMat(TIRE);
    case 'hub':
      return toonMat(HUB);
    case 'head':
      return toonMat(HEAD_COLOR, { emissive: HEAD_EMISSIVE });
    case 'tail':
      return toonMat(TAIL_COLOR, { emissive: TAIL_EMISSIVE });
    case 'pad':
    case 'glow':
      return additive(slot);
    default:
      return toonMat(slot);
  }
}

/** Hover pads and underglow are per-rig transparent basics, so rig-owned. */
function padMaterial(
  slot: string,
  owned: THREE.Material[],
  get: () => THREE.MeshBasicMaterial | null,
  set: (m: THREE.MeshBasicMaterial) => void,
): THREE.MeshBasicMaterial {
  if (slot === 'glow') {
    const m = new THREE.MeshBasicMaterial({
      color: GLOW_COLOR,
      transparent: true,
      opacity: GLOW_OPACITY,
      toneMapped: false,
    });
    owned.push(m);
    return m;
  }
  const existing = get();
  if (existing) return existing;
  const m = new THREE.MeshBasicMaterial({
    color: PAD_COLOR,
    transparent: true,
    opacity: PAD_OPACITY,
    toneMapped: false,
  });
  owned.push(m);
  set(m);
  return m;
}
