import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { animateCar, buildCar, buildProceduralCar } from './car';
import { CARS, STARTER_CAR_ID } from '../game/economy/cars';
import type { CarStyle } from '../types';

const style: CarStyle = {
  bodyType: 'compact',
  bodyColor: '#bdb08c',
  accentColor: '#6e685c',
  scale: 0.9,
};

/** World-space direction of a wheel's axle: the cylinder's own +Y. */
function axleOf(wheel: THREE.Mesh): THREE.Vector3 {
  wheel.updateMatrixWorld(true);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(
    wheel.getWorldQuaternion(new THREE.Quaternion()),
  );
}

describe('wheels roll about the axle', () => {
  // A wheel is a cylinder along its own +Y, tilted 90 deg about Z so the axle
  // lies along X, and animateCar advances rotation.y to roll it. With the
  // default XYZ Euler order that composes as Rx*Ry*Rz, which makes rotation.y
  // a turn about the parent's vertical axis applied AFTER the tilt: the wheel
  // yaws flat in the arch instead of rolling. The axle direction is the thing
  // that tells the two apart, so it is what these tests pin.
  for (const build of [
    ['procedural', () => buildProceduralCar(style)],
    ['handcrafted', () => buildCar(style)],
  ] as const) {
    const [label, make] = build;

    it(`keeps the ${label} axle pinned across a full revolution`, () => {
      const rig = make();
      expect(rig.wheels.length).toBe(4);

      const start = axleOf(rig.wheels[0]).clone();
      expect(Math.abs(start.x)).toBeCloseTo(1, 6);

      // Drive far enough to take the wheels through many revolutions.
      for (let i = 0; i < 240; i++) animateCar(rig, 23, 1 / 60, i / 60);

      for (const wheel of rig.wheels) {
        // Rolling keeps the axle on X. Yawing swings it through Z.
        const pinned = (axle: THREE.Vector3) => {
          expect(Math.abs(axle.x)).toBeCloseTo(1, 5);
          expect(Math.abs(axle.z)).toBeLessThan(1e-5);
          expect(Math.abs(axle.y)).toBeLessThan(1e-5);
        };
        pinned(axleOf(wheel));

        // The hubcap is a separate mesh carrying its own Euler order, so it can
        // yaw inside a correctly rolling tyre if only the tyre is covered.
        const hub = (wheel.userData.wheelGroup as THREE.Group).children[1];
        if (hub instanceof THREE.Mesh) pinned(axleOf(hub));
      }
    });

    it(`rolls the ${label} wheels forward, not backward`, () => {
      // Headlights sit at +Z, so forward is +Z. Take a point on the rim that
      // starts at the top of the wheel: rolling forward carries it toward the
      // front of the car. Without this, flipping the sign of the step and of
      // the test's own convention together would go unnoticed.
      const rig = make();
      const wheel = rig.wheels[0];
      // The Z tilt maps local +X onto world up, so that is the rim point to watch.
      const top = new THREE.Vector3(1, 0, 0);

      wheel.updateMatrixWorld(true);
      const before = top.clone().applyQuaternion(wheel.getWorldQuaternion(new THREE.Quaternion()));
      expect(before.y).toBeCloseTo(1, 5);

      animateCar(rig, 1.5, 1 / 60, 0);
      wheel.updateMatrixWorld(true);
      const after = top.clone().applyQuaternion(wheel.getWorldQuaternion(new THREE.Quaternion()));

      expect(after.z).toBeGreaterThan(before.z);
    });

    it(`actually turns the ${label} wheels`, () => {
      const rig = make();
      const before = rig.wheels[0].rotation.y;
      animateCar(rig, 23, 1 / 60, 0);
      expect(rig.wheels[0].rotation.y).not.toBeCloseTo(before, 6);
    });
  }

  it('spins the hub with its wheel', () => {
    const rig = buildCar(style);
    for (let i = 0; i < 30; i++) animateCar(rig, 23, 1 / 60, i / 60);
    for (const wheel of rig.wheels) {
      const hub = (wheel.userData.wheelGroup as THREE.Group).children[1];
      expect((hub as THREE.Object3D).rotation.y).toBeCloseTo(wheel.rotation.y, 9);
    }
  });
});

describe('wheel spin stays renderable', () => {
  const rig = () => buildProceduralCar(style);
  const stepOf = (r: ReturnType<typeof rig>, speedMps: number, dt: number) => {
    const before = r.wheels[0].rotation.y;
    animateCar(r, speedMps, dt, 0);
    // Wheels roll backwards in Euler terms; compare the shortest way round so
    // the wrap at 0 does not read as a huge jump.
    let d = r.wheels[0].rotation.y - before;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return -d;
  };

  it('matches the physical rate at low speed', () => {
    const r = rig();
    const speed = 1.5; // ~3 mph — well under the cap
    const expected = (speed * (1 / 60)) / r.wheelRadius;
    // Relative, not absolute: an absolute tolerance here is a function of
    // BODIES.compact.wheelR and the car's scale, so tuning either one would
    // turn this red for a reason unrelated to what it is testing.
    expect(stepOf(r, speed, 1 / 60) / expected).toBeGreaterThan(0.99);
  });

  it('never steps past what a 12-sided tyre can depict', () => {
    // Half of the tyre's 30 deg repeat. Past this the eye resolves the motion
    // as going the other way.
    const nyquist = Math.PI / 12;
    const r = rig();
    for (const mph of [10, 20, 30, 40, 52, 70, 120, 400]) {
      expect(stepOf(r, mph * 0.44704, 1 / 60)).toBeLessThan(nyquist);
    }
  });

  it('never reverses under frame-time jitter at a steady speed', () => {
    // The original symptom: at a constant 52 mph, ordinary jitter flipped the
    // apparent direction frame to frame. "Apparent" is the operative word — a
    // 12-sided tyre looks identical every 30 deg, so what the eye reads is the
    // step folded into that repeat, taken the shortest way round. Asserting on
    // the raw angle would pass even with no cap at all.
    const repeat = (Math.PI * 2) / 12;
    const apparent = (step: number) => {
      const folded = ((step % repeat) + repeat) % repeat;
      return folded > repeat / 2 ? folded - repeat : folded;
    };

    const r = rig();
    const speed = 52 * 0.44704;
    let seed = 7;
    for (let i = 0; i < 200; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const dt = 0.015 + (seed / 2147483648) * 0.0035;
      expect(apparent(stepOf(r, speed, dt))).toBeGreaterThan(0);
    }
  });

  it('increases monotonically with speed', () => {
    const r = rig();
    let previous = 0;
    for (const mph of [5, 10, 20, 30, 40, 52, 70]) {
      const step = stepOf(r, mph * 0.44704, 1 / 60);
      expect(step).toBeGreaterThan(previous);
      previous = step;
    }
  });

  it('keeps the accumulated angle bounded over a long session', () => {
    const r = rig();
    // An hour of driving at speed, at 60 fps.
    for (let i = 0; i < 60 * 60 * 60; i++) animateCar(r, 23, 1 / 60, 0);
    expect(Math.abs(r.wheels[0].rotation.y)).toBeLessThanOrEqual(Math.PI * 2);
  });

  it('leaves a wheelless hover rig alone', () => {
    const hover = buildProceduralCar({ ...style, bodyType: 'hover' });
    expect(hover.wheelRadius).toBe(0);
    expect(() => animateCar(hover, 23, 1 / 60, 0)).not.toThrow();
  });
});

describe('the starter car', () => {
  it('is the body type these tests exercise', () => {
    const starter = CARS.find((c) => c.id === STARTER_CAR_ID);
    expect(starter?.style.bodyType).toBe(style.bodyType);
    expect(starter?.style.scale).toBe(style.scale);
  });
});
