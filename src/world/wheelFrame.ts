/**
 * The wheel's axle frame — the one orientation contract shared by the
 * procedural car builder (`car.ts`) and the handcrafted-model assembler
 * (`models/carModel.ts`).
 *
 * It lives in its own leaf module rather than in `car.ts` because `car.ts`
 * already imports `carModel.ts` for `handcraftedCar`; putting the helper there
 * would close a runtime import cycle between the two.
 */

import type * as THREE from 'three';

/**
 * Put a wheel mesh into its axle frame.
 *
 * A tyre is a cylinder built along its own +Y, so it is tilted 90° about Z to
 * lay the axle along X, and `animateCar` then rolls it by advancing
 * `rotation.y`. For that to be a *roll*, the tilt has to be applied last:
 * Euler order `ZYX` composes as Rz·Ry·Rx, so Y turns the cylinder about its
 * own axis and Z then lays that axis down.
 *
 * With Three.js's default `XYZ` order it composes the other way (Rx·Ry·Rz),
 * which makes `rotation.y` a rotation about the *parent's* vertical axis
 * applied after the tilt: the wheel yaws flat in the arch like a castor
 * instead of rolling. That was the long-standing "flailing wheels" bug, and it
 * is why the order is set explicitly here rather than left to the default.
 *
 * `spinFrame` in `models/carModel.ts` is unaffected: at `rotation.y = 0` both
 * orders reduce to exactly Rz(90°), so the counter-rotation it applies to
 * handcrafted geometry still restores the authored orientation.
 */
export function axleFrame(mesh: THREE.Object3D): void {
  mesh.rotation.order = 'ZYX';
  mesh.rotation.z = Math.PI / 2;
}
