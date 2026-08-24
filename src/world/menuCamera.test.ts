import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MENU_SHOTS,
  MIN_TERRAIN_CLEARANCE,
  MenuCamera,
  type CinematicTarget,
  type MenuShotId,
} from './menuCamera';
import { RoadPath } from './roadPath';
import { terrainMeshHeight } from './chunks';

/**
 * The shot director is testable without a renderer: it writes to a
 * PerspectiveCamera and reads a structural slice of the Vehicle, and the road
 * curve and terrain field it queries are both pure TypeScript.
 *
 * Two things matter here. The editorial contract — durations in range, no
 * repeated cuts, the car staying in frame. And the physical one: the eye must
 * never end up inside the land. The terrain is a rolling height field, so a
 * shot that clears it over flat ground buries itself in the next hill crest,
 * which is exactly the regression this file exists to hold shut.
 */

function camera(): THREE.PerspectiveCamera {
  return new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 9000);
}

/** A deterministic stand-in for Math.random, cycling a fixed list. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/**
 * Seeded generator for the long runs. A varied stream is the point of those
 * tests, but per rules/testing.md it must not be the wall-clock-seeded one.
 */
function rng(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x1_0000_0000;
  };
}

/**
 * A car driving the given path, placed exactly the way `Vehicle` places it:
 * world position derived from `(s, lateral)`, yaw from the road heading.
 */
class FakeCar implements CinematicTarget {
  readonly root = { position: new THREE.Vector3() };
  yaw = 0;
  constructor(
    private path: RoadPath,
    public s: number,
    public lateral = 2.1,
    public speedMps = 24,
  ) {
    this.place();
  }
  advance(dt: number): void {
    this.s += this.speedMps * dt;
    this.place();
  }
  private place(): void {
    this.yaw = this.path.pose(this.s).heading;
    this.path.point(this.s, this.lateral, this.root.position);
  }
}

/** The rand stream that lands the director on shot `i` with mid-range rolls. */
function pickShot(i: number): () => number {
  return seq([i / MENU_SHOTS.length + 1e-9, 0.5, 0.3, 0.7]);
}

/** Run the director for `sec` seconds at 60 fps, collecting each cut's id. */
function run(cam: MenuCamera, car: FakeCar, sec: number): MenuShotId[] {
  const dt = 1 / 60;
  const ids: MenuShotId[] = [];
  let last: MenuShotId | null = null;
  for (let i = 0; i < Math.round(sec / dt); i++) {
    car.advance(dt);
    cam.update(car, dt);
    if (cam.shotId !== last) {
      last = cam.shotId;
      ids.push(last!);
    }
  }
  return ids;
}

describe('the shot list', () => {
  it('covers the eight angles the menu is specified to cut between', () => {
    const ids = MENU_SHOTS.map((s) => s.id);
    const required = [
      'lowChase',
      'droneFlyby',
      'trackingCar',
      'craneReveal',
      'overtake',
      'roadsideStatic',
      'heroLowFront',
      'orbit',
    ] as const;
    for (const id of required) expect(ids).toContain(id);
    // Pinned both ways: an angle added without a test is as much a drift from
    // the spec as one quietly dropped.
    expect(ids).toHaveLength(required.length);
  });

  it('has no duplicate ids', () => {
    const ids = MENU_SHOTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every duration window inside 7..11 s', () => {
    for (const shot of MENU_SHOTS) {
      expect(shot.minSec).toBeGreaterThanOrEqual(7);
      expect(shot.maxSec).toBeLessThanOrEqual(11);
      expect(shot.maxSec).toBeGreaterThanOrEqual(shot.minSec);
    }
  });

  it('uses a spread of focal lengths rather than one lens moved around', () => {
    const fovs = MENU_SHOTS.map((s) => s.fov);
    for (const fov of fovs) {
      expect(fov).toBeGreaterThan(15);
      expect(fov).toBeLessThan(90);
    }
    expect(Math.max(...fovs) - Math.min(...fovs)).toBeGreaterThan(20);
  });

  it('declares exactly the roadside static as the latched vantage', () => {
    const anchored = MENU_SHOTS.filter((s) => s.anchored).map((s) => s.id);
    expect(anchored).toEqual(['roadsideStatic']);
  });

  it('only the anchored shot latches at the cut', () => {
    for (const shot of MENU_SHOTS) {
      if (shot.begin) expect(shot.anchored).toBe(true);
    }
  });
});

describe('MenuCamera direction', () => {
  it('has no shot before the first update', () => {
    const path = new RoadPath(1);
    expect(new MenuCamera(camera(), path, seq([0])).shotId).toBeNull();
  });

  it('cuts to a shot on the first update, with no easing in', () => {
    const path = new RoadPath(1);
    const c = camera();
    const cam = new MenuCamera(c, path, seq([0, 0.5, 0.2, 0.7]));
    cam.update(new FakeCar(path, 400), 1 / 60);
    expect(cam.shotId).toBe(MENU_SHOTS[0].id);
    // The camera adopted the shot's focal length outright.
    expect(c.fov).toBe(MENU_SHOTS[0].fov);
  });

  it('rolls each take inside its own duration window', () => {
    const path = new RoadPath(1);
    for (let i = 0; i < MENU_SHOTS.length; i++) {
      for (const durationRoll of [0, 0.5, 0.999]) {
        // rand() #1 picks the shot, #2 picks the duration.
        const cam = new MenuCamera(
          camera(),
          path,
          seq([i / MENU_SHOTS.length + 1e-9, durationRoll, 0.4, 0.6]),
        );
        cam.update(new FakeCar(path, 400), 1 / 60);
        const shot = MENU_SHOTS[i];
        expect(cam.shotId).toBe(shot.id);
        expect(cam.shotDuration).toBeGreaterThanOrEqual(shot.minSec);
        expect(cam.shotDuration).toBeLessThanOrEqual(shot.maxSec);
      }
    }
  });

  it('never cuts to the shot already on screen', () => {
    const path = new RoadPath(20260824);
    const cam = new MenuCamera(camera(), path, rng(20260824));
    const ids = run(cam, new FakeCar(path, 500), 60 * 12);
    expect(ids.length).toBeGreaterThan(60); // it really did keep cutting
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
  });

  it('reaches every shot in the list over a long run', () => {
    const path = new RoadPath(7);
    const cam = new MenuCamera(camera(), path, rng(7));
    const seen = new Set(run(cam, new FakeCar(path, 500), 60 * 20));
    expect(seen.size).toBe(MENU_SHOTS.length);
  });

  it('holds a take for its full duration and cuts immediately after', () => {
    const path = new RoadPath(1);
    const car = new FakeCar(path, 400);
    const cam = new MenuCamera(camera(), path, seq([0, 0.5, 0.4, 0.6]));
    cam.update(car, 1 / 60);
    const first = cam.shotId;
    const duration = cam.shotDuration;
    // One frame short of the duration the take is still on screen.
    while (cam.shotElapsed + 1 / 60 < duration) {
      car.advance(1 / 60);
      cam.update(car, 1 / 60);
    }
    expect(cam.shotId).toBe(first);
    cam.update(car, 1 / 60);
    expect(cam.shotId).not.toBe(first);
  });

  it('cuts again straight after reset()', () => {
    const path = new RoadPath(1);
    const car = new FakeCar(path, 400);
    const cam = new MenuCamera(camera(), path, rng(3));
    cam.update(car, 1 / 60);
    cam.update(car, 1 / 60);
    expect(cam.shotElapsed).toBeGreaterThan(0);
    cam.reset();
    expect(cam.shotId).toBeNull();
    cam.update(car, 1 / 60);
    expect(cam.shotId).not.toBeNull();
    // The cut frame is the take's first frame (u = 0), not one dt into it.
    expect(cam.shotElapsed).toBe(0);
  });
});

describe('terrain clearance', () => {
  /**
   * The regression the bug report named: low-slung takes (the low chase, the
   * camera car alongside, the roadside static, the start of the overtake) sat
   * at a height that clears flat ground and buries the eye in a hill crest.
   * Asserted for every shot, over long stretches of varied road, against the
   * *drawn* terrain — the same surface scenery grounds to, so it agrees with
   * what the player actually sees.
   */
  it.each(MENU_SHOTS.map((s, i) => [s.id, i] as const))(
    'keeps %s at least MIN_TERRAIN_CLEARANCE above the drawn terrain',
    (_id, i) => {
      for (const seed of [20260824, 4242, 91]) {
        const path = new RoadPath(seed);
        const car = new FakeCar(path, 800);
        const c = camera();
        const cam = new MenuCamera(c, path, pickShot(i));
        for (let f = 0; f < 600; f++) {
          car.advance(1 / 60);
          cam.update(car, 1 / 60);
          if (cam.shotId !== MENU_SHOTS[i].id) break;
          const ground = terrainMeshHeight(path, cam.camS, cam.camLat);
          expect(c.position.y - ground).toBeGreaterThanOrEqual(MIN_TERRAIN_CLEARANCE - 1e-9);
        }
      }
    },
  );

  it('clears an intervening crest, not just the ground under the eye', () => {
    // The clamp probes forward along the sight line too, so the guarantee has
    // to hold a few metres toward the subject, where a ridge would cut in.
    const path = new RoadPath(20260824);
    const c = camera();
    const cam = new MenuCamera(c, path, rng(1234));
    const car = new FakeCar(path, 1500);
    for (let f = 0; f < 4000; f++) {
      car.advance(1 / 60);
      cam.update(car, 1 / 60);
      const toS = car.s - cam.camS;
      const toLat = car.lateral - cam.camLat;
      const len = Math.hypot(toS, toLat);
      if (len < 1e-3) continue;
      for (const d of [2.5, 6]) {
        const t = Math.min(d, len) / len;
        const ground = terrainMeshHeight(path, cam.camS + toS * t, cam.camLat + toLat * t);
        expect(c.position.y).toBeGreaterThanOrEqual(ground + MIN_TERRAIN_CLEARANCE - 1e-9);
      }
    }
  });

  it('only ever lifts the camera, never lowers or repositions it', () => {
    // A shot that wants to skim the ground should still skim it: over the flat
    // verge beside the road the clamp is inert and the framing is untouched.
    const path = new RoadPath(20260824);
    const chase = MENU_SHOTS.findIndex((s) => s.id === 'lowChase');
    const car = new FakeCar(path, 600);
    const c = camera();
    const cam = new MenuCamera(c, path, pickShot(chase));
    let everSkimmed = false;
    for (let f = 0; f < 400; f++) {
      car.advance(1 / 60);
      cam.update(car, 1 / 60);
      if (cam.shotId !== 'lowChase') break;
      const road = path.pose(cam.camS).pos.y;
      // Never pushed below the road surface it was composed against...
      expect(c.position.y).toBeGreaterThan(road);
      // ...and it still hugs the road rather than being hoisted clear of it.
      if (c.position.y - road < 3) everSkimmed = true;
    }
    expect(everSkimmed).toBe(true);
  });

  it('eases the lift off rather than dropping the camera off a ridge', () => {
    // Frame-to-frame vertical motion stays smooth: a hard per-frame max shows
    // up here as a step of tens of centimetres in a single 60 fps frame.
    const path = new RoadPath(20260824);
    const car = new FakeCar(path, 2000);
    const c = camera();
    const cam = new MenuCamera(c, path, rng(99));
    let prev: number | null = null;
    let prevShot: MenuShotId | null = null;
    for (let f = 0; f < 6000; f++) {
      car.advance(1 / 60);
      cam.update(car, 1 / 60);
      // Cuts are supposed to be discontinuous; only judge within a take.
      if (cam.shotId === prevShot && prev !== null) {
        expect(Math.abs(c.position.y - prev)).toBeLessThan(0.6);
      }
      prev = c.position.y;
      prevShot = cam.shotId;
    }
  });
});

describe('shot framing', () => {
  it('places a finite camera near enough to make the car the subject', () => {
    const path = new RoadPath(20260824);
    for (let i = 0; i < MENU_SHOTS.length; i++) {
      const c = camera();
      const car = new FakeCar(path, 900, 2.1, 30);
      const cam = new MenuCamera(c, path, pickShot(i));
      for (let f = 0; f < 400; f++) {
        car.advance(1 / 60);
        cam.update(car, 1 / 60);
        if (cam.shotId !== MENU_SHOTS[i].id) break;
        expect(Number.isFinite(c.position.x)).toBe(true);
        expect(Number.isFinite(c.position.y)).toBe(true);
        expect(Number.isFinite(c.position.z)).toBe(true);
        expect(c.position.distanceTo(car.root.position)).toBeLessThan(320);
      }
    }
  });

  it('keeps the car within the frustum of the take it is shooting', () => {
    const path = new RoadPath(20260824);
    const frustum = new THREE.Frustum();
    const m = new THREE.Matrix4();
    for (let i = 0; i < MENU_SHOTS.length; i++) {
      const c = camera();
      const car = new FakeCar(path, 900, 2.1, 26);
      const cam = new MenuCamera(c, path, pickShot(i));
      for (let f = 0; f < 300; f++) {
        car.advance(1 / 60);
        cam.update(car, 1 / 60);
        if (cam.shotId !== MENU_SHOTS[i].id) break;
        c.updateMatrixWorld(true);
        m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
        frustum.setFromProjectionMatrix(m);
        expect(frustum.containsPoint(car.root.position)).toBe(true);
      }
    }
  });
});

describe('floating-origin rebase', () => {
  /**
   * Road coordinates do not move when the world does, so the eye — which is
   * re-derived from `(s, lat)` every frame — rebases for free. Only the damped
   * look target is world-space, and it is what `shiftOrigin` exists for.
   */
  it('holds the same pose relative to the car across a rebase', () => {
    for (let i = 0; i < MENU_SHOTS.length; i++) {
      const path = new RoadPath(20260824);
      const car = new FakeCar(path, 2400);
      const c = camera();
      const cam = new MenuCamera(c, path, pickShot(i));
      for (let f = 0; f < 30; f++) {
        car.advance(1 / 60);
        cam.update(car, 1 / 60);
      }
      const offsetBefore = c.position.clone().sub(car.root.position);

      // Exactly what main.ts does: shift the path, the car, and the rig.
      const dx = -Math.round(car.root.position.x);
      const dz = -Math.round(car.root.position.z);
      path.shiftOrigin(dx, dz);
      cam.shiftOrigin(dx, dz);
      car.advance(1 / 60);
      cam.update(car, 1 / 60);

      const offsetAfter = c.position.clone().sub(car.root.position);
      expect(offsetAfter.distanceTo(offsetBefore)).toBeLessThan(1);
    }
  });
});
