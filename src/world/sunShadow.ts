import * as THREE from 'three';
import type { SunSnapshot } from '../engine/daynight';

/**
 * The sun's shadow rig: one `DirectionalLight` plus the ortho shadow camera
 * that follows the car.
 *
 * The rig deliberately decouples the *shadow* sun from the *sky* sun. The sky
 * needs a very low sun through dawn and sunset — that is where the god rays,
 * the horizon gradient and the whole golden-hour look come from — but shadow
 * length is `cot(elevation)`, so a 10 degree sun throws a shadow ~5.7x the
 * caster's height. Those read as smeared streaks that clip through everything
 * downhill of them. So `daynight.ts` keeps owning the real sun for `sky.ts`
 * and the god-ray source, and this module takes the same azimuth with the
 * elevation clamped up to `MIN_ELEVATION`. Shadows then stay at or under
 * ~2.4x the caster height at every time of day while the sunset still looks
 * like a sunset.
 *
 * Consequence worth knowing: a `DirectionalLight` has exactly one direction,
 * so the clamp also raises the *diffuse* direction near the horizon. Light at
 * dawn/sunset rakes across surfaces a little less than the sky implies. That
 * is the trade for a single shadow-casting light, which the perf budget
 * requires.
 */

/**
 * Half-width of the shadow ortho box, metres. 120 m across 2048 texels is a
 * 5.9 cm texel — the density the rig shipped with, kept as a floor.
 */
const HALF_EXTENT = 60;

/** Shadow map resolution. Capped at 2048 by the perf budget (§14). */
const MAP_SIZE = 2048;

/**
 * How far ahead of the car, along its heading, the ortho box is centred (m).
 * The chase camera sits ~10 m behind the car and looks ~7 m past it, so a box
 * centred on the car spends half its coverage behind the viewer. Biasing it
 * forward puts the texels where the player is actually looking while still
 * leaving ~25 m of coverage behind the car for the shadow it drives out of.
 */
const FORWARD_BIAS = 34;

/**
 * Floor on the shadow sun's elevation, radians (~23 deg). `cot(0.40) = 2.37`,
 * so no caster ever throws a shadow longer than ~2.4x its own height. Tuned by
 * eye: lower reads as melodramatic smearing, higher flattens dawn into noon.
 */
const MIN_ELEVATION = 0.4;

/**
 * Vertical slack added to the shadow camera's depth range, metres. Covers
 * terrain relief across the box plus the tallest scenery (~15 m trees).
 */
const VERT_SLACK = 40;

/** Sun elevation (rad) below which shadows are fully off — the sun has set. */
const FADE_LO = 0.02;

/** Sun elevation (rad) above which shadows are at full strength. */
const FADE_HI = 0.16;

/**
 * Shadow-map lookup offset along the receiver's normal, in WORLD UNITS. Three
 * texels' worth of ground (~3 cm) is enough to kill acne here because terrain
 * and road only *receive* — nothing in the world self-shadows — and anything
 * larger visibly detaches shadows from their casters at low sun.
 */
const NORMAL_BIAS = 0.03;

/**
 * Constant depth bias, in shadow-map depth units. The camera's depth range is
 * fixed (see `FAR`), so this is a stable ~3.6 cm of world depth.
 */
const DEPTH_BIAS = -0.0001;

/**
 * Half the shadow camera's depth range, metres. Derived, not tuned: at the
 * shallowest allowed elevation the ortho box's ground footprint runs
 * `HALF_EXTENT * cot(MIN_ELEVATION)` either side of centre along the light.
 */
const HALF_DEPTH = HALF_EXTENT / Math.tan(MIN_ELEVATION) + VERT_SLACK;

/** Shadow camera near plane, metres. Doubles as the margin on `HALF_DEPTH`. */
const NEAR = 8;

/** Distance from the box centre to the light, metres. */
const LIGHT_DISTANCE = HALF_DEPTH + NEAR;

/** Shadow camera far plane, metres. Brackets the box and nothing more. */
const FAR = 2 * HALF_DEPTH + NEAR;

/** World size of one shadow texel, metres. Used to snap the box to its grid. */
const TEXEL = (2 * HALF_EXTENT) / MAP_SIZE;

/**
 * The shadow sun's elevation for a given true sun elevation (radians).
 * Clamped up to `MIN_ELEVATION`; see the module comment for why. The clamp is
 * a `max`, so it is continuous across the horizon — the direction never jumps
 * when shadows fade back in at dawn.
 */
export function shadowElevation(elevation: number): number {
  return Math.max(elevation, MIN_ELEVATION);
}

/**
 * Shadow opacity for a given true sun elevation (radians): 0 once the sun is
 * below the horizon, ramping to 1 as it clears `FADE_HI`. Without this the
 * light keeps casting from below the terrain all night, which projects
 * incoherent shadows upward through everything.
 */
export function shadowStrength(elevation: number): number {
  return THREE.MathUtils.smoothstep(elevation, FADE_LO, FADE_HI);
}

/**
 * Unit direction TO the shadow sun for an azimuth/elevation pair (radians).
 * Same convention as `SunSnapshot.sunDir`.
 */
export function shadowDirection(
  azimuth: number,
  elevation: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  return out
    .set(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth),
    )
    .normalize();
}

/** Quantise `v` onto a grid of `step`, keeping the nearest gridline. */
function snapTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

export class SunShadow {
  /** The scene's only shadow-casting light. Colour/intensity live in main.ts. */
  readonly light: THREE.DirectionalLight;

  private readonly dir = new THREE.Vector3();
  private readonly centre = new THREE.Vector3();
  private readonly axisX = new THREE.Vector3();
  private readonly axisY = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(scene: THREE.Scene, color: THREE.ColorRepresentation, intensity: number) {
    this.light = new THREE.DirectionalLight(color, intensity);
    // Set once and never toggled -- see the note in update().
    this.light.castShadow = true;
    const shadow = this.light.shadow;
    shadow.mapSize.set(MAP_SIZE, MAP_SIZE);
    shadow.camera.left = -HALF_EXTENT;
    shadow.camera.right = HALF_EXTENT;
    shadow.camera.top = HALF_EXTENT;
    shadow.camera.bottom = -HALF_EXTENT;
    shadow.camera.near = NEAR;
    shadow.camera.far = FAR;
    shadow.bias = DEPTH_BIAS;
    shadow.normalBias = NORMAL_BIAS;
    // The box is a fixed size, so this is the only projection rebuild needed —
    // three's own updateMatrices() never calls it.
    shadow.camera.updateProjectionMatrix();
    scene.add(this.light);
    scene.add(this.light.target);
  }

  /**
   * Re-aim the rig for this frame. `carPos` and `carYaw` must be read after
   * the floating-origin rebase (§5.2) — the rig caches nothing across frames
   * except the snap grid, which a rebase is free to shift.
   */
  update(sun: SunSnapshot, carPos: THREE.Vector3, carYaw: number): void {
    const strength = shadowStrength(sun.elevation);
    // `castShadow` stays true for the life of the rig and night is handled by
    // fading `shadow.intensity` to 0 instead. Toggling it would be cheaper at
    // night -- the shadow pass would be skipped outright -- but flipping it
    // changes `lights.directionalShadowMap.length`, which three bakes into
    // every shader as NUM_DIR_LIGHT_SHADOWS and folds into the program cache
    // key. The old variant's usedTimes hits 0 and is deleted, so each flip
    // recompiles every shadow-receiving material in the scene: a hitch on the
    // one frame the sun crosses the horizon, twice per 545 s cycle. A steady
    // wasted pass beats a periodic frame dip (§14).
    this.light.shadow.intensity = strength;

    // Aimed every frame even while not casting: this is also the diffuse
    // direction, and it must not freeze overnight and snap back at dawn.
    shadowDirection(sun.azimuth, shadowElevation(sun.elevation), this.dir);

    // Centre the box ahead of the car along its heading (camera.ts uses the
    // same yaw convention: forward is (sin y, 0, cos y)).
    this.centre.set(
      carPos.x + Math.sin(carYaw) * FORWARD_BIAS,
      carPos.y,
      carPos.z + Math.cos(carYaw) * FORWARD_BIAS,
    );

    // Snap the centre to the shadow map's own texel grid. Without this the box
    // slides continuously with the car and every shadow edge crawls a texel at
    // a time as the map re-rasterises — the "swimming" past the car.
    // Basis matches THREE.Camera.lookAt: z = dir, x = up x z, y = z x x.
    // dir.y is >= sin(MIN_ELEVATION), so the cross product is never degenerate.
    this.axisX.crossVectors(this.up, this.dir).normalize();
    this.axisY.crossVectors(this.dir, this.axisX);
    const cx = snapTo(this.centre.dot(this.axisX), TEXEL);
    const cy = snapTo(this.centre.dot(this.axisY), TEXEL);
    // Depth is snapped too: sliding along the light axis would not move the
    // rasterised footprint, but it would re-quantise every depth in the map
    // each frame and make the constant bias shimmer.
    const cz = snapTo(this.centre.dot(this.dir), TEXEL);
    this.centre
      .set(0, 0, 0)
      .addScaledVector(this.axisX, cx)
      .addScaledVector(this.axisY, cy)
      .addScaledVector(this.dir, cz);

    this.light.target.position.copy(this.centre);
    this.light.position.copy(this.centre).addScaledVector(this.dir, LIGHT_DISTANCE);
    // The target is a scene child; its matrix is stale until the render walks
    // the graph, and shadow.updateMatrices() reads matrixWorld directly.
    this.light.target.updateMatrixWorld();
  }
}
