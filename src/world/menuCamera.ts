import * as THREE from 'three';
import type { RoadPath } from './roadPath';
import { terrainMeshHeight } from './chunks';

/**
 * Attract-mode cinematography (docs/ARCHITECTURE.md §6.4).
 *
 * `MenuCamera` is a shot director for the footage behind the main menu. It
 * drives the *same* `THREE.PerspectiveCamera` that `ChaseCamera` owns — PostFX
 * captures one camera reference at construction (`world/postfx.ts`), so a
 * second camera would never be rendered. `main.ts` hands the frame to whichever
 * rig matches `runtime.appMode`.
 *
 * Every shot is a small config: a duration window, a focal length, and a
 * `frame()` that places the rig from the shot's own progress. Shots cut (never
 * cross-fade) and never repeat back to back. Within a shot the rig always
 * moves — dolly, crane, orbit or pan — so the menu never looks like a
 * screenshot; `roadsideStatic` is the deliberate exception and pans instead.
 *
 * **Shots are composed in the road frame**, as an `s` offset along the curve, a
 * lateral offset in metres, and a height above the road surface — never as a
 * world position. Three things fall out of that: the camera follows the road's
 * own elevation instead of floating at a fixed height over rolling ground; the
 * terrain under the eye can be queried directly (see `clearanceLift`); and a
 * latched vantage survives the floating-origin rebase for free, because road
 * coordinates do not move when the world does (§5.2).
 *
 * Randomness comes from `Math.random()` by default: this is presentation, and
 * nothing about it needs to be reproducible. Tests inject their own generator.
 *
 * Frame-loop contract (§14): `update()` allocates nothing in steady state, and
 * all smoothing is `THREE.MathUtils.damp` so it is frame-rate independent.
 */

/**
 * The slice of the `Vehicle` a shot reads. Structural on purpose so the
 * director can be exercised without building a car or a renderer; `Vehicle`
 * satisfies it as-is.
 */
export interface CinematicTarget {
  readonly root: { readonly position: THREE.Vector3 };
  /** Path distance of the car along the road curve, in metres. */
  readonly s: number;
  /** Lateral offset from the centreline, positive to the traveller's right. */
  readonly lateral: number;
  /** True world yaw of the car (never `root.rotation.y` — see §6.4). */
  readonly yaw: number;
  readonly speedMps: number;
}

export type MenuShotId =
  | 'lowChase'
  | 'droneFlyby'
  | 'trackingCar'
  | 'craneReveal'
  | 'overtake'
  | 'roadsideStatic'
  | 'heroLowFront'
  | 'orbit';

/** Scratch the director refreshes each frame and hands to the active shot. */
export interface ShotRig {
  /** The road curve, for shots that need to interrogate the ground. */
  path: RoadPath;
  /** Car's path distance this frame. */
  s: number;
  /** Car's lateral offset this frame. */
  lat: number;
  /** Car's world position this frame — look targets are world-space. */
  car: THREE.Vector3;
  /** Car forward unit vector this frame. */
  forward: THREE.Vector3;
  /** Where the shot wants the eye: path distance along the curve. */
  camS: number;
  /** Where the shot wants the eye: lateral offset in metres. */
  camLat: number;
  /** Where the shot wants the eye: metres above the road surface there. */
  camH: number;
  /** What the shot wants the camera to look at, in world space. */
  look: THREE.Vector3;
  /** Road-frame vantage latched at the cut. Anchored shots only. */
  anchorS: number;
  anchorLat: number;
  anchorH: number;
  /** -1 or +1: which side of the road this take was rolled onto. */
  side: number;
  /** One uniform 0..1 draw per shot, for variation inside the take. */
  roll: number;
}

export interface MenuShot {
  id: MenuShotId;
  /** Shortest this take runs, in seconds. */
  minSec: number;
  /** Longest this take runs, in seconds. */
  maxSec: number;
  /** Vertical field of view in degrees — the shot's "focal length". */
  fov: number;
  /**
   * True when the shot latches a fixed vantage at the cut rather than riding
   * with the car. The vantage is stored in road-frame coordinates, so unlike a
   * world position it needs no re-anchoring when the scene rebases (§5.2).
   */
  anchored: boolean;
  /** Latch the vantage at the cut. */
  begin?(rig: ShotRig, target: CinematicTarget): void;
  /**
   * Place the rig for progress `u` (0 at the cut, 1 at the outgoing frame).
   * Writes `rig.camS`/`camLat`/`camH` and `rig.look`. Must not allocate.
   */
  frame(rig: ShotRig, target: CinematicTarget, u: number): void;
}

const lerp = THREE.MathUtils.lerp;

/** Scratch for the vantage probe in `roadsideStatic.begin`. Hoisted per §14. */
const anchorEye = new THREE.Vector3();

/** Smoothstep, for eases that should not start or stop abruptly. */
function ease(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * Put the eye `ds` metres along the road from the car, `dlat` metres to its
 * side, `h` metres above the road surface at that point.
 */
function place(rig: ShotRig, ds: number, dlat: number, h: number): void {
  rig.camS = rig.s + ds;
  rig.camLat = rig.lat + dlat;
  rig.camH = h;
}

/** Aim the rig at the car, `h` metres above it, `lead` metres along its heading. */
function aim(rig: ShotRig, lead: number, h: number): void {
  rig.look.copy(rig.car).addScaledVector(rig.forward, lead);
  rig.look.y += h;
}

/**
 * True when the drawn terrain between two road-frame points rises above the
 * straight line joining them — i.e. a hill stands between the camera and its
 * subject. Sampled coarsely; this only has to reject an obviously blocked
 * vantage, not survey the landscape.
 */
function sightBlocked(
  path: RoadPath,
  aS: number,
  aLat: number,
  aY: number,
  bS: number,
  bLat: number,
  bY: number,
): boolean {
  const STEPS = 9;
  for (let i = 1; i < STEPS; i++) {
    const t = i / STEPS;
    // terrainMeshHeight shares one module-scope sample; read the number out
    // before the next call rather than holding on to anything.
    const ground = terrainMeshHeight(path, lerp(aS, bS, t), lerp(aLat, bLat, t));
    if (ground > lerp(aY, bY, t) + 0.5) return true;
  }
  return false;
}

/**
 * Furthest ahead of the car any shot may stand, metres — `roadsideStatic`'s
 * clamp, and the only place a menu eye gets far enough forward for the road
 * behind the car to matter at range.
 */
export const MENU_MAX_LEAD = 260;

/**
 * How far **back along the road** the ribbon has to reach before the menu may
 * show it, metres. `chunks.MENU_BEHIND` is sized to clear this; the test suite
 * checks the pair rather than trusting the comment.
 *
 * Note what this is not. It is not a distance from the eye, and the two are
 * not interchangeable: `RoadPath` winds hard enough to double back on itself,
 * so a cut 600 m back along the arc is routinely 250-350 m away in a straight
 * line, and pushing the tail further can bring the cut *nearer* rather than
 * further as the road loops around. Sizing this against a euclidean distance
 * looks reasonable and measures nothing.
 *
 * What actually hides the cut is the land in between. Sampling the live attract
 * mode — the cut row raycast against the chunk meshes every frame, so a sample
 * counts only when it is genuinely unoccluded rather than merely inside the
 * frustum — the cut is directly visible in 19% of framed samples at 600 m of
 * tail and in **none** at 1320 m. Those two rows are single runs of very
 * unequal length, so read the shape and not the last decimal (§5.3); the
 * offline sweep in `menuCamera.test.ts` cannot separate 1320 m from 840 m at
 * all. What both agree on is that a rolling height field over a winding road
 * nearly always has a crest in the way at this range, and that the terrain, not
 * the haze, is the mechanism — at the distances where anything is still exposed
 * the haze has barely started (see `chunks.MENU_BEHIND`).
 *
 * 1320 m is `AHEAD * CHUNK_LEN`, and that is not a coincidence worth losing:
 * the ribbon's forward cut is hidden at exactly the same distance, by the same
 * haze, met by the same `farLand.ts` backdrop. One number covers both ends of
 * the world.
 */
export const MENU_SAFE_DISTANCE = 1320;

/**
 * The shot list. Durations sit inside 7–11 s so the menu keeps cutting without
 * feeling like a slideshow, and the focal lengths deliberately range from a
 * wide 62° chase to a 26° telephoto roadside so successive takes do not read
 * as the same lens moved around.
 */
export const MENU_SHOTS: MenuShot[] = [
  {
    // Low and tight behind the rear bumper, dollying back as the take runs.
    id: 'lowChase',
    minSec: 7,
    maxSec: 10,
    fov: 62,
    anchored: false,
    frame(rig, _target, u) {
      const sway = Math.sin(u * Math.PI * 1.3 + rig.roll * Math.PI * 2) * 1.7 * rig.side;
      place(rig, lerp(-6.2, -10.4, ease(u)), sway, lerp(1.0, 1.85, u));
      aim(rig, 8, 1.1);
    },
  },
  {
    // Drone: high and wide off one flank, sweeping from ahead of the car to
    // well behind it while it stays locked on the roof.
    id: 'droneFlyby',
    minSec: 8,
    maxSec: 11,
    fov: 46,
    anchored: false,
    frame(rig, _target, u) {
      place(rig, lerp(58, -44, ease(u)), rig.side * lerp(29, 12, u), lerp(17.5, 8.5, ease(u)));
      aim(rig, 0, 1.0);
    },
  },
  {
    // Camera car: road level, running alongside, sliding from just behind the
    // rear wheel to just ahead of the nose.
    id: 'trackingCar',
    minSec: 7,
    maxSec: 10,
    fov: 38,
    anchored: false,
    frame(rig, _target, u) {
      place(rig, lerp(-7.5, 7.5, ease(u)), rig.side * lerp(12.8, 9.4, u), lerp(1.45, 2.15, u));
      aim(rig, 0, 0.9);
    },
  },
  {
    // Crane reveal: starts low ahead of the car and rises away from it, the
    // look point drifting past the roof so the landscape opens up underneath.
    id: 'craneReveal',
    minSec: 8,
    maxSec: 11,
    fov: 54,
    anchored: false,
    frame(rig, _target, u) {
      const e = ease(u);
      place(rig, lerp(26, 7, e), rig.side * lerp(1.5, 9, e), lerp(0.85, 27, e));
      aim(rig, lerp(0, -42, u * u), lerp(1.2, 5.2, e));
    },
  },
  {
    // Overtake: far behind at road level, closing on the car and lifting over
    // it in the last third of the take.
    id: 'overtake',
    minSec: 8,
    maxSec: 11,
    fov: 56,
    anchored: false,
    frame(rig, _target, u) {
      place(rig, lerp(-48, 16, ease(u)), rig.side * lerp(3.6, 1.1, u), lerp(0.95, 9.0, u * u));
      aim(rig, 0, 1.0);
    },
  },
  {
    // Roadside static: a fixed vantage the car drives past, long lens. The
    // rig itself barely moves (the deliberate exception to "always moving") —
    // the motion is the pan as the car approaches and passes.
    id: 'roadsideStatic',
    minSec: 7,
    maxSec: 9,
    fov: 26,
    anchored: true,
    begin(rig, target) {
      // Stand far enough down the road that the car needs most of the take to
      // reach the vantage, so the shot always cuts while the car is still
      // reading as a car rather than a speck. Scales with speed for the same
      // reason: a 120 mph super covers ground four times faster than a hatch.
      const lead = THREE.MathUtils.clamp(target.speedMps * 5.4, 95, MENU_MAX_LEAD);
      const carY = rig.car.y;
      // A vantage on the far side of a rise gets the clearance lift but still
      // watches the car through a hill, so try a few and take the first with a
      // clear sight line. Bounded: a blocked landscape just uses the last.
      for (let attempt = 0; attempt < 4; attempt++) {
        const spread = 1 - attempt * 0.22;
        rig.anchorS = rig.s + lead * spread;
        rig.anchorLat = rig.lat + rig.side * (13 + rig.roll * 9);
        rig.anchorH = 2.3 + rig.roll * 4.5 + attempt * 1.6;
        // Probe the eye `frame()` will actually place: heights are measured
        // from the road surface at (camS, camLat), not from the terrain. The
        // clearance lift only ever raises it, so testing the unlifted eye is
        // the conservative reading of the same vantage.
        const eyeY = rig.path.point(rig.anchorS, rig.anchorLat, anchorEye).y + rig.anchorH;
        if (!sightBlocked(rig.path, rig.anchorS, rig.anchorLat, eyeY, rig.s, rig.lat, carY)) {
          break;
        }
      }
    },
    frame(rig, _target, u) {
      rig.camS = rig.anchorS;
      // A breath of handheld drift, well under a metre, so the frame is not
      // mathematically dead.
      rig.camLat = rig.anchorLat + Math.sin(u * Math.PI) * 0.5 * rig.side;
      rig.camH = rig.anchorH + Math.sin(u * Math.PI * 2 + rig.roll * 6) * 0.16;
      aim(rig, 0, 0.9);
    },
  },
  {
    // Hero low front: nose-height, just off the bumper, looking back at the
    // car as it bears down on the lens.
    id: 'heroLowFront',
    minSec: 7,
    maxSec: 9,
    fov: 34,
    anchored: false,
    frame(rig, _target, u) {
      place(rig, lerp(15.5, 9.5, ease(u)), rig.side * lerp(3.4, 1.5, u), lerp(0.65, 1.0, u));
      aim(rig, 0, 0.75);
    },
  },
  {
    // Orbit: a slow arc around the car, tightening and rising as it goes.
    id: 'orbit',
    minSec: 8,
    maxSec: 11,
    fov: 50,
    anchored: false,
    frame(rig, _target, u) {
      const ang = rig.roll * Math.PI * 2 + rig.side * lerp(0, 2.4, ease(u));
      const radius = lerp(13.5, 10.2, u);
      place(rig, Math.cos(ang) * radius, Math.sin(ang) * radius, lerp(2.6, 4.8, u));
      aim(rig, 0, 1.0);
    },
  },
];

/**
 * Minimum metres between the camera eye and the drawn terrain beneath it.
 *
 * Protects against the eye burying itself inside a hill: the terrain is a
 * rolling height field, so a height measured off the road surface is not a
 * height above the *ground* once a shot swings out into the fields. The margin
 * covers the 0.3 m near clip plane (world/camera.ts) plus the gap between the
 * probes below and the faceted surface actually drawn between terrain rows.
 */
export const MIN_TERRAIN_CLEARANCE = 1.2;

/**
 * Distances in metres along the sight line from the eye toward the car at
 * which the ground is probed. Clamping against a single sample under the eye
 * still clips when a crest rises *between* the camera and its subject, so the
 * eye clears the highest ground in that neighbourhood rather than only its own.
 */
const CLEARANCE_PROBES = [0, 2.5, 6, 11];

/**
 * Rate at which the terrain lift eases back off, per second. The lift is
 * applied in full the instant it is needed — clipping is never acceptable —
 * and only its release is damped, so cresting a ridge does not drop the camera
 * back with a visible snap.
 */
const LIFT_RELEASE_DAMP = 2.2;

/** Look-target damping rate — pans trail the car by a touch rather than locking. */
const LOOK_DAMP = 6;
/** FOV damping rate, used only for the tail of a cut's focal-length change. */
const FOV_DAMP = 5;

/** Scratch: the road-frame eye resolved to world space. Hoisted per §14. */
const worldPos = new THREE.Vector3();

export class MenuCamera {
  private shotIndex = -1;
  private elapsed = 0;
  private duration = 0;
  /** True on the frame right after a cut: the rig snaps rather than damping. */
  private fresh = true;
  /** Metres the eye is currently being held above its shot's intended height. */
  private lift = 0;
  private readonly look = new THREE.Vector3();
  private readonly rig: ShotRig;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private path: RoadPath,
    /** Injectable for tests; presentation randomness needs no determinism. */
    private rand: () => number = Math.random,
  ) {
    this.rig = {
      path,
      s: 0,
      lat: 0,
      car: new THREE.Vector3(),
      forward: new THREE.Vector3(0, 0, 1),
      camS: 0,
      camLat: 0,
      camH: 0,
      look: new THREE.Vector3(),
      anchorS: 0,
      anchorLat: 0,
      anchorH: 0,
      side: 1,
      roll: 0,
    };
  }

  /** Id of the take on screen, or null before the first cut. */
  get shotId(): MenuShotId | null {
    return this.shotIndex < 0 ? null : MENU_SHOTS[this.shotIndex].id;
  }

  /** Length of the current take in seconds (0 before the first cut). */
  get shotDuration(): number {
    return this.duration;
  }

  /** Seconds into the current take. */
  get shotElapsed(): number {
    return this.elapsed;
  }

  /** Path distance of the eye this frame, for the terrain-clearance contract. */
  get camS(): number {
    return this.rig.camS;
  }

  /** Lateral offset of the eye this frame. */
  get camLat(): number {
    return this.rig.camLat;
  }

  /** Drop the current take so the next `update()` cuts to a fresh one. */
  reset(): void {
    this.shotIndex = -1;
    this.elapsed = 0;
    this.duration = 0;
    this.fresh = true;
    this.lift = 0;
  }

  update(target: CinematicTarget, dt: number): void {
    const rig = this.rig;
    rig.s = target.s;
    rig.lat = target.lateral;
    rig.car.copy(target.root.position);
    const yaw = target.yaw;
    rig.forward.set(Math.sin(yaw), 0, Math.cos(yaw));

    this.elapsed += dt;
    if (this.shotIndex < 0 || this.elapsed >= this.duration) this.cut(target);

    const shot = MENU_SHOTS[this.shotIndex];
    const u = this.duration > 0 ? THREE.MathUtils.clamp(this.elapsed / this.duration, 0, 1) : 0;
    shot.frame(rig, target, u);

    // Road frame -> world. The shot's height is measured from the road surface
    // at its own (s, lat), which already follows the terrain longitudinally.
    this.path.point(rig.camS, rig.camLat, worldPos);
    worldPos.y += rig.camH;

    // Keep the eye out of the dirt. Applied to the final position rather than
    // to a damped target, so the clearance below holds exactly, every frame.
    const needed = this.clearanceLift(worldPos.y);
    this.lift = this.fresh
      ? needed
      : Math.max(needed, THREE.MathUtils.damp(this.lift, needed, LIFT_RELEASE_DAMP, dt));
    worldPos.y += this.lift;

    if (this.fresh) {
      // A cut is a cut: no easing in from wherever the last take ended.
      this.fresh = false;
      this.look.copy(rig.look);
      this.camera.fov = shot.fov;
    } else {
      this.look.x = THREE.MathUtils.damp(this.look.x, rig.look.x, LOOK_DAMP, dt);
      this.look.y = THREE.MathUtils.damp(this.look.y, rig.look.y, LOOK_DAMP, dt);
      this.look.z = THREE.MathUtils.damp(this.look.z, rig.look.z, LOOK_DAMP, dt);
      this.camera.fov = THREE.MathUtils.damp(this.camera.fov, shot.fov, FOV_DAMP, dt);
    }

    this.camera.position.copy(worldPos);
    this.camera.lookAt(this.look);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Floating-origin rebase (§5.2). The eye is re-derived from road coordinates
   * every frame and so needs nothing; only the damped world-space look target
   * has to travel with the scene.
   */
  shiftOrigin(dx: number, dz: number): void {
    this.look.x += dx;
    this.look.z += dz;
  }

  /**
   * Metres the eye must rise to keep `MIN_TERRAIN_CLEARANCE` over the highest
   * ground between it and the car. Zero whenever the shot already clears.
   */
  private clearanceLift(eyeY: number): number {
    const rig = this.rig;
    let ds = rig.s - rig.camS;
    let dlat = rig.lat - rig.camLat;
    const len = Math.hypot(ds, dlat);
    if (len > 1e-4) {
      ds /= len;
      dlat /= len;
    } else {
      ds = 0;
      dlat = 0;
    }
    let highest = -Infinity;
    for (const probe of CLEARANCE_PROBES) {
      const d = Math.min(probe, len);
      // terrainMeshHeight writes into module-scope scratch and is not
      // reentrant: take the number here, never a reference to the sample.
      const ground = terrainMeshHeight(this.path, rig.camS + ds * d, rig.camLat + dlat * d);
      if (ground > highest) highest = ground;
    }
    return Math.max(0, highest + MIN_TERRAIN_CLEARANCE - eyeY);
  }

  /** Cut to a different shot, rolling its duration and per-take variation. */
  private cut(target: CinematicTarget): void {
    const n = MENU_SHOTS.length;
    let next: number;
    if (this.shotIndex < 0) {
      next = Math.min(n - 1, Math.floor(this.rand() * n));
    } else {
      // Draw from the n-1 shots that are not the current one, so the same
      // angle never runs twice in a row and the draw stays uniform.
      const pick = Math.min(n - 2, Math.floor(this.rand() * (n - 1)));
      next = pick >= this.shotIndex ? pick + 1 : pick;
    }
    this.shotIndex = next;
    const shot = MENU_SHOTS[next];
    this.duration = shot.minSec + this.rand() * (shot.maxSec - shot.minSec);
    this.elapsed = 0;
    this.fresh = true;
    this.rig.side = this.rand() < 0.5 ? -1 : 1;
    this.rig.roll = this.rand();
    shot.begin?.(this.rig, target);
  }
}
