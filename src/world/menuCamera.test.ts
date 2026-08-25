import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  MENU_MAX_LEAD,
  MENU_SAFE_DISTANCE,
  MENU_SHOTS,
  MIN_TERRAIN_CLEARANCE,
  MenuCamera,
  type CinematicTarget,
  type MenuShotId,
} from './menuCamera';
import { RoadPath } from './roadPath';
import { CHUNK_LEN, MENU_BEHIND, PLAY_BEHIND, TER_COLS, terrainMeshHeight } from './chunks';

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

/**
 * Where the rear-boundary sweep below starts its runs. Spread over the road so
 * no single stretch of curvature decides the result.
 */
const START_POSITIONS = [4200, 15000, 40000];

describe('the ribbon\u2019s rear boundary', () => {
  /**
   * The menu is the only rig that looks back down the road, so it is the only
   * one that can see where the world stops. `MENU_BEHIND` is what buys the
   * tail and `MENU_SAFE_DISTANCE` is how much tail is needed; neither number
   * means anything without the other, so they are checked as a pair.
   */
  it('reaches as far back down the road as the cut needs to be hidden', () => {
    expect(MENU_BEHIND * CHUNK_LEN).toBeGreaterThanOrEqual(MENU_SAFE_DISTANCE);
  });

  /**
   * World point back to road-frame `(s, lat)`, searched over the live window.
   * `RoadPath` maps one way only, so this walks it; the step matches the
   * terrain grid's own row spacing.
   */
  function lateralOf(
    path: RoadPath,
    p: THREE.Vector3,
    from = 0,
    to = 0,
  ): { s: number; lat: number } | null {
    const pose = { pos: new THREE.Vector3(), heading: 0 };
    let best: { s: number; lat: number } | null = null;
    let bestAlong = Infinity;
    for (let s2 = from; s2 <= to; s2 += 6) {
      path.pose(s2, pose);
      const dx = p.x - pose.pos.x;
      const dz = p.z - pose.pos.z;
      const along = Math.abs(dx * Math.sin(pose.heading) + dz * Math.cos(pose.heading));
      if (along >= bestAlong) continue;
      const lat = dx * -Math.cos(pose.heading) + dz * Math.sin(pose.heading);
      if (Math.abs(lat) > Math.abs(TER_COLS[0])) continue;
      bestAlong = along;
      best = { s: s2, lat };
    }
    return bestAlong < 6 ? best : null;
  }

  /**
   * Occlusion-test one framed sample in every `SAMPLE_STRIDE`. The march is the
   * expensive half of the sweep; the stride is a fixed count of framed samples,
   * so which ones get marched is deterministic and evenly spread over the run.
   * It subsamples the *test*, never the counting — `framed` stays exact.
   */
  const SAMPLE_STRIDE = 5;

  /**
   * How far the nearest *unoccluded* point of the rear cut has to sit from the
   * eye, in metres, for the menu tail to count as hiding it. See the test that
   * asserts it for where the number comes from and what it does not claim.
   */
  const CUT_MIN_DISTANCE = 650;

  interface CutExposure {
    /** Samples of the cut row that landed inside a shot's frustum. */
    framed: number;
    /** Of those, the ones actually marched against the terrain. */
    tested: number;
    /** Of those, the ones with no crest in the way. */
    seen: number;
    /** Distance to the nearest *unoccluded* sample; `Infinity` for none. */
    nearest: number;
  }

  /**
   * Sweep every shot from every start position and measure how exposed the
   * ribbon's rear cut is for a ribbon retaining `behind` chunks.
   *
   * The predecessor of this function kept one running minimum distance across
   * every start position and shot, and skipped the occlusion march for any
   * sample that could not beat it. `seen` was therefore a count of
   * record-minimum improvements — a quantity that grows roughly
   * logarithmically however much is actually visible — so `seen / framed` was
   * driven almost entirely by its denominator. The rates it reported (1.9e-5 at
   * twenty-two chunks) measured nothing, and the test built on them passed at
   * sixteen. Every framed sample is now counted unconditionally, `nearest` is
   * taken only from unoccluded samples, and the distance-ordering heuristic is
   * gone.
   */
  function measureCutExposure(behind: number): CutExposure {
    const path = new RoadPath(20260824);
    const frustum = new THREE.Frustum();
    const m = new THREE.Matrix4();
    const edge = new THREE.Vector3();
    let framed = 0;
    let tested = 0;
    let seen = 0;
    let nearest = Infinity;
    // Several start positions, not one. Whether the cut is framed at all swings
    // wildly with where on the road the sweep begins — at 4200 a ten-chunk tail
    // frames it zero times, while the live game at the same tail had the cut in
    // view in every framed sample. A single position is how the previous version
    // of this test passed vacuously.
    for (const startS of START_POSITIONS) {
      for (let i = 0; i < MENU_SHOTS.length; i++) {
        const c = camera();
        const car = new FakeCar(path, startS, 2.1, 30);
        const cam = new MenuCamera(c, path, pickShot(i));
        for (let f = 0; f < 300; f++) {
          car.advance(1 / 60);
          cam.update(car, 1 / 60);
          if (cam.shotId !== MENU_SHOTS[i].id) break;
          c.updateMatrixWorld(true);
          m.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
          frustum.setFromProjectionMatrix(m);
          // Where ChunkManager.update would have cut the ribbon this frame.
          const sCut = (Math.floor(car.s / CHUNK_LEN) - behind) * CHUNK_LEN;
          for (let lat = TER_COLS[0]; lat <= TER_COLS[TER_COLS.length - 1]; lat += 15) {
            path.point(sCut, lat, edge);
            edge.y = terrainMeshHeight(path, sCut, lat);
            if (!frustum.containsPoint(edge)) continue;
            framed++;
            if (framed % SAMPLE_STRIDE !== 0) continue;
            tested++;
            if (occlude(path, c.position, edge, sCut, car.s)) continue;
            seen++;
            nearest = Math.min(nearest, c.position.distanceTo(edge));
          }
        }
      }
    }
    return { framed, tested, seen, nearest };
  }

  /** The sweep is seeded and deterministic, so each tail is measured once. */
  const exposures = new Map<number, CutExposure>();
  function cutExposure(behind: number): CutExposure {
    let e = exposures.get(behind);
    if (!e) exposures.set(behind, (e = measureCutExposure(behind)));
    return e;
  }

  /**
   * Is `p` hidden from `eye` by the terrain between them?
   *
   * Marches the sight line against the height field. This is what the frustum
   * on its own cannot answer, and the difference is not a detail: `RoadPath`
   * doubles back on itself often enough that the rear cut is *framed* at almost
   * every tail length, at distances that wander between 244 and 558 m with no
   * relation to how long the tail is. Whether it can actually be seen is a
   * question about the crests in between.
   *
   * Steps of 12 m: fine enough to catch a crest, coarse enough that the sweep
   * stays inside the suite's time budget. This is a loose *upper* bound on
   * exposure, in several directions at once: it samples the height field rather
   * than the drawn mesh (which can miss a crest by ~2 m, §5.3), it knows
   * nothing of scenery or the far-land backdrop, and a march point that
   * projects outside the ribbon counts as clear. Erring toward "visible" is the
   * safe direction for a test asserting that the cut is kept at a distance, but
   * it does mean the counts below are not an exposure figure to quote.
   */
  function occlude(
    path: RoadPath,
    eye: THREE.Vector3,
    p: THREE.Vector3,
    sCut: number,
    carS: number,
  ): boolean {
    const march = new THREE.Vector3();
    const total = eye.distanceTo(p);
    for (let d = 24; d < total - 12; d += 12) {
      march.lerpVectors(eye, p, d / total);
      const hit = lateralOf(path, march, sCut, carS + 200);
      if (hit && terrainMeshHeight(path, hit.s, hit.lat) > march.y + 0.5) return true;
    }
    return false;
  }

  /**
   * The defect this pair of numbers exists for, and the control for the case
   * below. At the driving tail the cut is not merely framed but genuinely in
   * view — 88% of what it marches is unoccluded — close, with props
   * standing on its lip. Kept as a test rather than a comment so the sweep is
   * known to be able to see a boundary at all, and so the bar the next case
   * sets is known to be a bar some tail fails. A silent zero here would make
   * that case vacuous, which is how the first version of this pair passed while
   * the shipped tail left the cut on screen.
   */
  it('was in view, and close, at the driving tail', () => {
    const { tested, seen, nearest } = cutExposure(PLAY_BEHIND);
    expect(seen).toBeGreaterThan(0);
    expect(seen / tested).toBeGreaterThan(0.5);
    expect(nearest).toBeLessThan(400);
    expect(nearest).toBeLessThan(CUT_MIN_DISTANCE);
  });

  /**
   * And with the menu's tail, whatever is still exposed is far away.
   *
   * A floor on the nearest *unoccluded* cut — the one quantity in this sweep
   * that moves with the tail and that the haze argument in `MENU_BEHIND`'s
   * docblock actually rests on. Measured over the full sweep (`SAMPLE_STRIDE`
   * of 1; at the shipped stride of 5 every `nearest` below reproduces to within
   * two metres and every rate to within about a percent):
   *
   * | `MENU_BEHIND` | tail | framed | seen | rate | nearest visible |
   * |---|---|---|---|---|---|
   * | 3 (`PLAY_BEHIND`) | 180 m | 41312 | 35959 | 8.7e-1 | 169 m |
   * | 10 (was) | 600 m | 10458 | 9090 | 8.7e-1 | 460 m |
   * | 14 | 840 m | 15961 | 5885 | 3.7e-1 | 705 m |
   * | 16 | 960 m | 23430 | 4803 | 2.0e-1 | 737 m |
   * | 18 | 1080 m | 32829 | 8565 | 2.6e-1 | 765 m |
   * | 22 (now) | 1320 m | 51943 | 6378 | 1.2e-1 | 688 m |
   * | 26 | 1560 m | 52709 | 0 | 0 | — |
   *
   * Read that honestly. The distance separates 3 and 10 cleanly from everything
   * at 14 and above and nothing else: it is not monotonic, and 22 sits *nearer*
   * than 14, 16 and 18. The rate does not separate them either. By this
   * instrument — which over-reports besides, see `occlude` — every tail from 14
   * up is equivalent, and 650 m is the widest bar the data supports: below the
   * closest of them with a little margin, far above the 460 m of the tail that
   * shipped the defect. It is deliberately *not* reverse-engineered to make 22
   * the unique pass. Constructing a threshold that way is how the first version
   * of this test went wrong, and arithmetic alone would not have made it right.
   * What picks 22 out of 14..22 is the design argument in `MENU_BEHIND`'s
   * docblock, not this sweep.
   */
  it('keeps the cut at least CUT_MIN_DISTANCE away at the menu tail', () => {
    const { framed, nearest } = cutExposure(MENU_BEHIND);
    // The sweep has to have had the chance: a tail nothing frames would make
    // the distance below vacuous — that is how the first version of this pair
    // passed while the shipped tail left the cut on screen.
    expect(framed).toBeGreaterThan(1000);
    expect(nearest).toBeGreaterThanOrEqual(CUT_MIN_DISTANCE);
  });

  /**
   * `roadsideStatic` is the shot that reaches furthest forward, and its lead
   * is what sets how far back the boundary has to sit. A raise here without a
   * matching raise of `MENU_BEHIND` puts the cut back on screen.
   */
  it('clears the furthest vantage any shot may take', () => {
    const path = new RoadPath(7);
    const cam = new MenuCamera(camera(), path, pickShot(MENU_SHOTS.findIndex((s) => s.anchored)));
    const car = new FakeCar(path, 3000, 2.1, 60);
    cam.update(car, 1 / 60);
    expect(cam.camS - car.s).toBeLessThanOrEqual(MENU_MAX_LEAD);
  });
});
