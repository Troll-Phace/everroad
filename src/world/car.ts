import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toonMat } from './materials';
import type { CarStyle, CarBodyType } from '../types';

/**
 * Procedural toy-like cars. Every car is rounded boxes + cylinders with toon
 * shading — cute, chunky, readable at chase-cam distance.
 * Group origin: center of the car at ground level (y=0).
 */

export interface CarRig {
  group: THREE.Group;
  wheels: THREE.Mesh[];
  /** For hover cars: glow discs to bob/pulse. */
  hoverPads: THREE.Mesh[];
  bodyType: CarBodyType;
  /**
   * World-space wheel radius (body `wheelR` × the rig's uniform scale), so
   * wheel spin can be matched to ground speed. 0 for wheelless hover cars.
   */
  wheelRadius: number;
  /**
   * Materials created per-rig (NOT from the shared toonMat cache), disposed
   * with the rig by disposeCar. Currently the hover pad/glow basics.
   */
  ownedMaterials: THREE.Material[];
}

interface BodyParams {
  len: number; // chassis length
  wid: number;
  chassisH: number;
  chassisY: number; // bottom of chassis above ground
  cabinLen: number;
  cabinH: number;
  cabinOffset: number; // z offset of cabin (+ = toward front)
  wheelR: number;
  wheelInsetZ: number; // wheels from each end
  nose?: number; // extra low nose box length (sports)
  bed?: boolean; // pickup bed cutout
}

const BODIES: Record<CarBodyType, BodyParams> = {
  compact: {
    len: 3.3,
    wid: 1.75,
    chassisH: 0.62,
    chassisY: 0.3,
    cabinLen: 1.7,
    cabinH: 0.62,
    cabinOffset: -0.1,
    wheelR: 0.34,
    wheelInsetZ: 0.72,
  },
  sedan: {
    len: 4.2,
    wid: 1.8,
    chassisH: 0.58,
    chassisY: 0.32,
    cabinLen: 2.0,
    cabinH: 0.56,
    cabinOffset: -0.15,
    wheelR: 0.35,
    wheelInsetZ: 0.85,
  },
  wagon: {
    len: 4.4,
    wid: 1.82,
    chassisH: 0.6,
    chassisY: 0.32,
    cabinLen: 2.7,
    cabinH: 0.6,
    cabinOffset: -0.5,
    wheelR: 0.36,
    wheelInsetZ: 0.85,
  },
  pickup: {
    len: 4.6,
    wid: 1.9,
    chassisH: 0.68,
    chassisY: 0.38,
    cabinLen: 1.5,
    cabinH: 0.62,
    cabinOffset: 0.5,
    wheelR: 0.42,
    wheelInsetZ: 0.9,
    bed: true,
  },
  van: {
    len: 4.5,
    wid: 1.9,
    chassisH: 1.0,
    chassisY: 0.34,
    cabinLen: 3.2,
    cabinH: 0.75,
    cabinOffset: -0.3,
    wheelR: 0.38,
    wheelInsetZ: 0.9,
  },
  classic: {
    len: 4.3,
    wid: 1.78,
    chassisH: 0.6,
    chassisY: 0.36,
    cabinLen: 1.7,
    cabinH: 0.58,
    cabinOffset: -0.35,
    wheelR: 0.4,
    wheelInsetZ: 0.8,
    nose: 0.9,
  },
  muscle: {
    len: 4.5,
    wid: 1.94,
    chassisH: 0.6,
    chassisY: 0.3,
    cabinLen: 1.9,
    cabinH: 0.5,
    cabinOffset: -0.3,
    wheelR: 0.4,
    wheelInsetZ: 0.85,
  },
  sports: {
    len: 4.2,
    wid: 1.9,
    chassisH: 0.5,
    chassisY: 0.26,
    cabinLen: 1.7,
    cabinH: 0.45,
    cabinOffset: -0.25,
    wheelR: 0.36,
    wheelInsetZ: 0.8,
    nose: 1.0,
  },
  super: {
    len: 4.4,
    wid: 1.98,
    chassisH: 0.44,
    chassisY: 0.24,
    cabinLen: 1.9,
    cabinH: 0.42,
    cabinOffset: -0.1,
    wheelR: 0.35,
    wheelInsetZ: 0.82,
    nose: 1.1,
  },
  hover: {
    len: 4.2,
    wid: 1.9,
    chassisH: 0.5,
    chassisY: 0.55,
    cabinLen: 2.1,
    cabinH: 0.5,
    cabinOffset: 0,
    wheelR: 0,
    wheelInsetZ: 0.85,
    nose: 0.8,
  },
};

const GLASS = '#bfe8f0';
const TIRE = '#2b2b33';
const HUB = '#d8d8d8';

export function buildCar(style: CarStyle): CarRig {
  const p = BODIES[style.bodyType];
  const g = new THREE.Group();
  const body = toonMat(style.bodyColor);
  const accent = toonMat(style.accentColor);
  const glass = toonMat(GLASS);

  // Chassis
  const chassis = new THREE.Mesh(new RoundedBoxGeometry(p.wid, p.chassisH, p.len, 3, 0.14), body);
  chassis.position.y = p.chassisY + p.chassisH / 2;
  chassis.castShadow = true;
  g.add(chassis);

  // Low nose for sporty/classic silhouettes
  if (p.nose) {
    const nose = new THREE.Mesh(
      new RoundedBoxGeometry(p.wid * 0.94, p.chassisH * 0.72, p.nose, 3, 0.1),
      body,
    );
    nose.position.set(0, p.chassisY + (p.chassisH * 0.72) / 2, p.len / 2 - p.nose / 2 + 0.35);
    nose.castShadow = true;
    g.add(nose);
  }

  // Cabin + glass band
  const cabinY = p.chassisY + p.chassisH;
  const cabin = new THREE.Mesh(
    new RoundedBoxGeometry(p.wid * 0.86, p.cabinH, p.cabinLen, 3, 0.16),
    accent,
  );
  cabin.position.set(0, cabinY + p.cabinH / 2 - 0.05, p.cabinOffset);
  cabin.castShadow = true;
  g.add(cabin);
  const glassBand = new THREE.Mesh(
    new RoundedBoxGeometry(p.wid * 0.88, p.cabinH * 0.5, p.cabinLen * 0.92, 2, 0.1),
    glass,
  );
  glassBand.position.set(0, cabinY + p.cabinH * 0.42, p.cabinOffset);
  g.add(glassBand);

  // Pickup bed walls
  if (p.bed) {
    const bedWall = new THREE.Mesh(new RoundedBoxGeometry(p.wid * 0.92, 0.32, 1.7, 2, 0.06), body);
    bedWall.position.set(0, p.chassisY + p.chassisH + 0.1, -p.len / 2 + 1.0);
    g.add(bedWall);
  }

  // Accent stripe down the hood for muscle/sports/super
  if (style.bodyType === 'muscle' || style.bodyType === 'sports' || style.bodyType === 'super') {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, p.len * 0.95), accent);
    stripe.position.y = p.chassisY + p.chassisH + 0.02;
    g.add(stripe);
  }

  // Lights
  const head = toonMat('#fff6c9', { emissive: 0xfff2b0 });
  const tail = toonMat('#ff5a4a', { emissive: 0xff3020 });
  for (const side of [-1, 1]) {
    const h = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.16, 0.08, 1, 0.04), head);
    h.position.set(side * (p.wid / 2 - 0.32), p.chassisY + p.chassisH * 0.62, p.len / 2 + 0.01);
    g.add(h);
    const t = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.08, 1, 0.04), tail);
    t.position.set(side * (p.wid / 2 - 0.32), p.chassisY + p.chassisH * 0.62, -p.len / 2 - 0.01);
    g.add(t);
  }

  // Wheels or hover pads
  const wheels: THREE.Mesh[] = [];
  const hoverPads: THREE.Mesh[] = [];
  const ownedMaterials: THREE.Material[] = [];
  if (style.bodyType === 'hover') {
    const padMat = new THREE.MeshBasicMaterial({
      color: 0x7ae8ff,
      transparent: true,
      opacity: 0.65,
      toneMapped: false,
    });
    ownedMaterials.push(padMat);
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.08, 12), padMat);
      pad.position.set(sx * (p.wid / 2 - 0.35), 0.22, sz * (p.len / 2 - p.wheelInsetZ));
      g.add(pad);
      hoverPads.push(pad);
    }
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x58d8ff,
      transparent: true,
      opacity: 0.4,
      toneMapped: false,
    });
    ownedMaterials.push(glowMat);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(p.wid * 0.8, 0.04, p.len * 0.7), glowMat);
    glow.position.y = 0.14;
    g.add(glow);
  } else {
    const tireMat = toonMat(TIRE);
    const hubMat = toonMat(HUB);
    for (const [sx, sz] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const wheel = new THREE.Group();
      const tire = new THREE.Mesh(
        new THREE.CylinderGeometry(p.wheelR, p.wheelR, 0.26, 12),
        tireMat,
      );
      tire.rotation.z = Math.PI / 2;
      wheel.add(tire);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(p.wheelR * 0.5, p.wheelR * 0.5, 0.28, 8),
        hubMat,
      );
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      wheel.position.set(sx * (p.wid / 2 - 0.08), p.wheelR, sz * (p.len / 2 - p.wheelInsetZ));
      g.add(wheel);
      // Store the tire mesh for spinning (rotate around its local Y after z-rot).
      wheels.push(tire);
      tire.userData.wheelGroup = wheel;
    }
  }

  g.scale.setScalar(style.scale);
  return {
    group: g,
    wheels,
    hoverPads,
    bodyType: style.bodyType,
    wheelRadius: p.wheelR * style.scale,
    ownedMaterials,
  };
}

/**
 * Dispose a rig built by buildCar: every per-mesh geometry plus the rig's
 * own uncached materials. The toonMat-cached materials are shared across
 * rigs and scenery, so they are deliberately NOT disposed here.
 */
export function disposeCar(rig: CarRig): void {
  rig.group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();
  });
  for (const m of rig.ownedMaterials) m.dispose();
}

/** Spin wheels & bob hover pads. Call each frame. */
export function animateCar(rig: CarRig, speedMps: number, dt: number, time: number): void {
  for (const w of rig.wheels) {
    // Tire cylinder was rotated z=90°, so forward rolling is local Y.
    // Angular rate is ground speed over the rig's real wheel radius.
    w.rotation.y -= (speedMps * dt) / rig.wheelRadius;
    (w.userData.wheelGroup as THREE.Group).children[1].rotation.y = w.rotation.y;
  }
  if (rig.hoverPads.length) {
    const bob = Math.sin(time * 3.1) * 0.05;
    rig.group.position.y += 0; // bob applied by vehicle via hoverBob()
    for (let i = 0; i < rig.hoverPads.length; i++) {
      const pad = rig.hoverPads[i];
      (pad.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.25 * Math.sin(time * 5 + i * 1.7);
    }
    void bob;
  }
}

export function hoverBob(rig: CarRig, time: number): number {
  return rig.bodyType === 'hover' ? 0.12 + Math.sin(time * 2.2) * 0.07 : 0;
}
