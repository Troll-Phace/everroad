import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FarLand,
  FAR_LAND_ANCHOR_DAMP,
  FAR_LAND_CUT_DISTANCE,
  FAR_LAND_GAP_ANGLE_DEG,
  FAR_LAND_INNER_RADIUS,
  FAR_LAND_MAX_EYE,
  FAR_LAND_OUTER_RADIUS,
  FAR_LAND_RIDGE_HEIGHT,
  FAR_LAND_RIDGE_RELIEF,
  FAR_LAND_RIM_DROP,
  FAR_LAND_RINGS,
  FAR_LAND_SEGMENTS,
  buildFarLandGeometry,
  farLandElevation,
  farLandHeight,
  farLandHeightAt,
  farLandNormal,
  farLandRadius,
} from './farLand';
import { CHUNK_LEN, PLAY_BEHIND, TER_COLS, terrainHeight, terrainMeshHeight } from './chunks';
import { FOLD_LIMIT, RoadPath } from './roadPath';
import { BIOMES, BIOME_LEN, BLEND_LEN, biomeAt, blendColor, createBiomeSample } from './biomes';

const AZIMUTHS = 720;
const azimuth = (j: number): number => (j / AZIMUTHS) * Math.PI * 2;
const deg = (rad: number): number => (rad * 180) / Math.PI;

/**
 * Eye heights above the ground anchor that the profile has to hold for. The
 * menu director's shots run from `heroLowFront` at 0.65 m to `craneReveal` at
 * 27 m over the road surface, and the ground under the eye can sit either side
 * of that surface out in the fields — see `FAR_LAND_MAX_EYE`.
 */
const EYES = [0, 0.65, 1.6, 5, 12, 17, 27, 40, FAR_LAND_MAX_EYE];

/** Radius at which azimuth `az` crosses `want` degrees of elevation, metres. */
function crossing(az: number, want: number, eye: number): number {
  let lo = FAR_LAND_INNER_RADIUS;
  let hi = FAR_LAND_OUTER_RADIUS;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (deg(Math.atan2(farLandHeightAt(mid, az) - eye, mid)) < want) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fog transmittance at `d` metres for a given `FogExp2` density — the fraction
 * of a surface's own contrast that survives the haze. three computes the fog
 * factor as `1 - exp(-(density * depth)^2)`, so this is its complement.
 */
function transmittance(d: number, density: number): number {
  return Math.exp(-Math.pow(d * density, 2));
}

describe('far land placement', () => {
  it('keeps its rim inside the ribbon even where a bend compresses it', () => {
    // The rim is only invisible because real terrain is always drawn over it,
    // and the ribbon is narrowest on the inside of the tightest bend, where
    // `foldSafeLateral` asymptotes at FOLD_LIMIT of the local radius. The
    // analytic minimum radius is the sum of `RoadPath.curvature`'s four sine
    // amplitudes inverted — solved for, not sampled.
    const minRadius = 1 / (0.0042 + 0.0035 + 0.0028 + 0.0009);
    expect(minRadius).toBeCloseTo(87.7, 1);
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(FOLD_LIMIT * minRadius);
    // ...and inside the rear tail, the shorter of the two in play.
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(PLAY_BEHIND * CHUNK_LEN);
  });

  it('stays inside the sky dome and the camera far plane', () => {
    // Sky's dome is a 6000 m sphere (sky.ts) and ChaseCamera's far plane is
    // 9000 m; a vertex past either would be clipped or poke through the sky.
    let furthest = 0;
    for (let j = 0; j < AZIMUTHS; j++) {
      furthest = Math.max(
        furthest,
        Math.hypot(FAR_LAND_OUTER_RADIUS, farLandHeight(1, azimuth(j))),
      );
    }
    expect(furthest).toBeLessThan(6000);
  });

  it('spans exactly the configured radii', () => {
    expect(farLandRadius(0)).toBeCloseTo(FAR_LAND_INNER_RADIUS, 6);
    expect(farLandRadius(1)).toBeCloseTo(FAR_LAND_OUTER_RADIUS, 6);
  });
});

describe('far land profile', () => {
  it('sits its rim just under the sampled ground, at every azimuth', () => {
    // Under, not on: a metre of error in the ground sample must not be able to
    // lift the rim above real terrain.
    for (let j = 0; j < AZIMUTHS; j++) {
      expect(farLandHeight(0, azimuth(j))).toBeCloseTo(-FAR_LAND_RIM_DROP, 9);
    }
    expect(FAR_LAND_RIM_DROP).toBeGreaterThan(0);
  });

  it('hangs its rim steeply enough that nothing escapes underneath it', () => {
    // The rim is where the backdrop stops and the ribbon has to take over, so
    // any ray that passes *under* it must meet real terrain before it runs out
    // of ribbon. It is not enough for the rim to be near: the terrain falls
    // away from the road fast enough to outrun a shallow ray for a long way,
    // and the failure is a band of sky two rows deep running the whole width of
    // the frame at the rim's own elevation (13,692 px of it, measured).
    // Marched against the height field the ribbon is built from, out to the
    // ribbon's *compressed* reach on the inside of the tightest bend.
    const path = new RoadPath(1337);
    const reach = FOLD_LIMIT / (0.0042 + 0.0035 + 0.0028 + 0.0009);
    let escapes = 0;
    for (let s = 0; s < 40000; s += 971) {
      for (const lat0 of [-29, 0, 29]) {
        const h0 = terrainHeight(path, s, lat0);
        for (const eye of [0.65, 1.6, 5, 27]) {
          // The shallowest ray that can slip beneath the rim.
          const slope = (FAR_LAND_RIM_DROP + eye) / FAR_LAND_INNER_RADIUS;
          for (const dir of [1, -1]) {
            let hit = false;
            for (let r = 0.5; r <= reach; r += 0.5) {
              if (eye - slope * r <= terrainHeight(path, s, lat0 + dir * r) - h0) {
                hit = true;
                break;
              }
            }
            if (!hit) escapes++;
          }
        }
      }
    }
    expect(escapes).toBe(0);
  });

  it('is still hugging the ground where the ribbon hands over', () => {
    // The ribbon draws out to TER_COLS, so anything the fan does inside that
    // radius is buried. What must not happen is the fan climbing into view
    // *at* the hand-over: the ribbon's own far field rises there, and a
    // backdrop already above ground at 165 m would be a wall standing on the
    // ribbon's edge rather than land continuing past it.
    const edge = Math.max(...TER_COLS.map(Math.abs));
    for (let j = 0; j < AZIMUTHS; j++) {
      expect(farLandHeightAt(edge, azimuth(j))).toBeLessThanOrEqual(0);
    }
  });

  it('rises monotonically in elevation, at every azimuth and every eye height', () => {
    // This is what keeps the fan from overlapping itself as seen from the
    // camera at its centre, and — with the surface being continuous — what
    // makes its angular coverage gapless. It has to hold for the whole range
    // of eye heights a shot can take, not for one of them: elevation is
    // `(A + b)/R - (b + eye)/r` per cone, so a *lower* eye is the harder case
    // and sweeping to zero covers every rig.
    // The comparison is plain JS and only the first breach is handed to
    // `expect`: asserting inside the loop meant hundreds of thousands of
    // matcher calls, which cost seconds of the suite's budget. The coverage is
    // identical.
    let breach: { eye: number; azimuth: number; sample: number } | null = null;
    outer: for (const eye of EYES) {
      for (let j = 0; j < AZIMUTHS; j++) {
        const az = azimuth(j);
        let prev = -Infinity;
        for (let i = 0; i <= 300; i++) {
          const e = farLandElevation(i / 300, az, eye);
          if (!(e > prev)) {
            breach = { eye, azimuth: j, sample: i };
            break outer;
          }
          prev = e;
        }
      }
    }
    expect(breach).toBeNull();
  });

  it('starts below the eye line so nothing shows under the rim', () => {
    // The lowest terrain silhouette measured across the repro positions is
    // 1.66° above the eye; the rim has to sit under every such value, and does
    // so by sitting below the eye line entirely — for every eye height, since
    // the rim is below the ground the eye is standing on.
    for (const eye of EYES) {
      for (let j = 0; j < AZIMUTHS; j += 8) {
        expect(deg(farLandElevation(0, azimuth(j), eye))).toBeLessThan(0);
      }
    }
  });

  it('clears the highest sky gap from every eye height a shot can take', () => {
    // The fan closes every gap below its silhouette and none above it, so this
    // is the guarantee. `FAR_LAND_RIDGE_HEIGHT` is a height rather than an
    // angle precisely so this can be asserted across the eye range instead of
    // at the one height it was measured from.
    let lowest = Infinity;
    for (const eye of EYES) {
      for (let j = 0; j < 4000; j++) {
        lowest = Math.min(lowest, deg(farLandElevation(1, (j / 4000) * Math.PI * 2, eye)));
      }
    }
    expect(lowest).toBeGreaterThan(FAR_LAND_GAP_ANGLE_DEG);
    // The measured worst case on unfolded road is the ribbon-edge silhouette
    // at s ~99.1 km (R 91.3 m), 6.63° from a 1.6 m eye.
    expect(lowest).toBeGreaterThan(6.63);
  });

  it('holds that guarantee well past the eye range it is swept to', () => {
    // `atan((H - e) / R) >= 7.6°` needs `H >= e + 533.6`, so the built ridge
    // covers eyes up to 116 m. The margin over `FAR_LAND_MAX_EYE` is free —
    // the ridge is fully fogged at any density the game asks for.
    const covered = FAR_LAND_RIDGE_HEIGHT - FAR_LAND_OUTER_RADIUS * Math.tan((7.6 * Math.PI) / 180);
    expect(covered).toBeGreaterThan(FAR_LAND_MAX_EYE * 1.5);
    for (let j = 0; j < 2000; j++) {
      expect(deg(farLandElevation(1, (j / 2000) * Math.PI * 2, covered))).toBeGreaterThanOrEqual(
        7.6 - 1e-6,
      );
    }
  });

  it('wanders its silhouette upward only, and stays a horizon', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let j = 0; j < AZIMUTHS; j++) {
      const ridge = farLandHeight(1, azimuth(j));
      lowest = Math.min(lowest, ridge);
      highest = Math.max(highest, ridge);
    }
    expect(lowest).toBeGreaterThanOrEqual(FAR_LAND_RIDGE_HEIGHT - 1e-9);
    expect(highest).toBeLessThanOrEqual(FAR_LAND_RIDGE_HEIGHT + FAR_LAND_RIDGE_RELIEF + 1e-6);
    // A constant-height crest projects to a straight line and reads as a lid,
    // so the wander has to survive being made one-sided...
    expect(highest - lowest).toBeGreaterThan(FAR_LAND_RIDGE_RELIEF * 0.6);
    // ...and the backdrop still has to read as a horizon rather than as a
    // mountain range standing over the road.
    expect(deg(farLandElevation(1, 0, 0))).toBeLessThan(12);
    for (let j = 0; j < AZIMUTHS; j++) {
      expect(deg(farLandElevation(1, azimuth(j), 0))).toBeLessThan(12);
    }
  });

  it('breaks the horizon at a different distance in every direction', () => {
    // The relief that matters is not the silhouette's — it is *which distance*
    // sits at a given elevation, because that is what the haze turns into
    // layers. A cone would answer the same radius at every azimuth and read as
    // a lid whatever its edge did.
    let near = Infinity;
    let far = 0;
    for (let j = 0; j < AZIMUTHS; j++) {
      const r = crossing(azimuth(j), 2, 1.6);
      near = Math.min(near, r);
      far = Math.max(far, r);
    }
    expect(far / near).toBeGreaterThan(2);
  });

  it('carries a crease where the spur crosses under the range', () => {
    // Two cones, so the surface has a kink at the radius where the lower one
    // gives way — a crest line running around the eye rather than radiating
    // from it. Detected as a jump in radial slope; if the spur were dropped or
    // sunk past the range everywhere, this would flatten out.
    let creased = 0;
    for (let j = 0; j < AZIMUTHS; j++) {
      const az = azimuth(j);
      let prevSlope = 0;
      let jump = 0;
      for (let i = 1; i <= 200; i++) {
        const r0 = farLandRadius((i - 1) / 200);
        const r1 = farLandRadius(i / 200);
        const slope = (farLandHeightAt(r1, az) - farLandHeightAt(r0, az)) / (r1 - r0);
        if (i > 1) jump = Math.max(jump, slope - prevSlope);
        prevSlope = slope;
      }
      if (jump > 0.01) creased++;
    }
    expect(creased).toBeGreaterThan(AZIMUTHS / 2);
  });

  it('closes the azimuth seam exactly', () => {
    // The noise is sampled at (cos az, sin az), so the last column and the
    // first are the same point and the fan closes with no crack.
    for (const t of [0, 0.35, 0.7, 1]) {
      expect(farLandHeight(t, 0)).toBeCloseTo(farLandHeight(t, Math.PI * 2), 9);
    }
  });
});

describe('far land aerial perspective', () => {
  /** The base density in main.ts, times the thinnest `mist` any biome asks. */
  const THINNEST = 0.0014 * 0.9;
  /** The base density in main.ts at `mist: 1`. */
  const BASE = 0.0014;

  it('fogs on its own true distance, with no scale factor left to tune', () => {
    // The geometry is at the distance it depicts, so `scene.fog` is the whole
    // story and there is no per-vertex haze attribute to keep in step with it.
    // A reintroduced `aHaze` would be a sign the profile stopped being honest.
    const geo = buildFarLandGeometry();
    expect(geo.getAttribute('aHaze')).toBeUndefined();
    geo.dispose();
  });

  it('keeps real land colour at the foot of the visible band', () => {
    // The defect this profile replaces: every visible ring fogged as though it
    // were at least 1327 m away, so the whole band sat between 96% and 100%
    // hazed and read as one flat slab. Grounded, the band's foot is a few
    // hundred metres out in the directions where the land rises soonest.
    let best = 0;
    for (let j = 0; j < AZIMUTHS; j++) {
      best = Math.max(best, transmittance(crossing(azimuth(j), 2, 1.6), BASE));
    }
    expect(best).toBeGreaterThan(0.35);
  });

  it('grades from land to air across the band rather than saturating at once', () => {
    // Averaged over azimuth so this is a statement about the whole horizon and
    // not about one lucky direction: the elevation a low eye reads just above
    // a near crest has to keep some contrast, and the ridge must have none.
    let sum = 0;
    for (let j = 0; j < AZIMUTHS; j++) sum += transmittance(crossing(azimuth(j), 2, 1.6), BASE);
    expect(sum / AZIMUTHS).toBeGreaterThan(0.2);
    let sum6 = 0;
    for (let j = 0; j < AZIMUTHS; j++) sum6 += transmittance(crossing(azimuth(j), 6, 1.6), BASE);
    expect(sum6).toBeLessThan(sum);
  });

  it('is saturated by the ridge, so the silhouette is haze and not a hillside', () => {
    // The ridge is the backdrop's top edge. If its own colour still showed
    // there it would read as a solid green cone rather than distant air.
    expect(transmittance(FAR_LAND_OUTER_RADIUS, THINNEST)).toBeLessThan(1e-6);
  });

  it('cannot show anything nearer than the ribbon reaches', () => {
    // The old failure the haze scale existed to prevent was a crisp backdrop
    // sitting on a pale strip of terrain. The geometry answers it now: the fan
    // is under the ground out to the ribbon's lateral edge and only climbs
    // into view past it, so the nearest fan pixel anywhere is further away
    // than the ribbon's own hand-over.
    const edge = Math.max(...TER_COLS.map(Math.abs));
    let nearest = Infinity;
    for (let j = 0; j < AZIMUTHS; j++) nearest = Math.min(nearest, crossing(azimuth(j), 0, 0));
    expect(nearest).toBeGreaterThan(edge);
  });
});

describe('far land geometry', () => {
  it('is one indexed grid of the configured size', () => {
    const geo = buildFarLandGeometry();
    const pos = geo.getAttribute('position');
    expect(pos.count).toBe(FAR_LAND_RINGS * FAR_LAND_SEGMENTS);
    expect(geo.getIndex()?.count).toBe((FAR_LAND_RINGS - 1) * FAR_LAND_SEGMENTS * 6);
    expect(geo.getAttribute('color').count).toBe(pos.count);
    geo.dispose();
  });

  it('emits the outermost ring first so painter order matches depth order', () => {
    // The mesh writes no depth; from the camera at the fan's centre, depth
    // order is radius order, so the far rings have to be drawn first.
    const geo = buildFarLandGeometry();
    const idx = geo.getIndex();
    if (!idx) throw new Error('expected an indexed geometry');
    const ringOf = (v: number): number => Math.floor(v / FAR_LAND_SEGMENTS);
    // Each quad names its inner ring first, so the leading vertex of the
    // first quad is the second-outermost ring and of the last quad the rim.
    const first = ringOf(idx.getX(0));
    const last = ringOf(idx.getX(idx.count - 6));
    expect(first).toBeGreaterThan(last);
    expect(first).toBe(FAR_LAND_RINGS - 2);
    expect(last).toBe(0);
    geo.dispose();
  });

  it('carries the height field into the vertices', () => {
    const geo = buildFarLandGeometry();
    const pos = geo.getAttribute('position');
    for (const i of [0, 37, 511, 1200, pos.count - 1]) {
      const ring = Math.floor(i / FAR_LAND_SEGMENTS);
      const seg = i % FAR_LAND_SEGMENTS;
      const t = ring / (FAR_LAND_RINGS - 1);
      const az = (seg / FAR_LAND_SEGMENTS) * Math.PI * 2;
      expect(pos.getX(i)).toBeCloseTo(Math.sin(az) * farLandRadius(t), 3);
      expect(pos.getZ(i)).toBeCloseTo(Math.cos(az) * farLandRadius(t), 3);
      expect(pos.getY(i)).toBeCloseTo(farLandHeight(t, az), 3);
    }
    geo.dispose();
  });

  it('shades off the surface, with normals that stay near vertical', () => {
    // Real normals, so the creases and the open slopes read differently under
    // the toon ramp — but leaned back toward vertical, because the ramp is
    // four flat stops and a steep normal paints a hard line across the sky.
    const geo = buildFarLandGeometry();
    const n = geo.getAttribute('normal');
    let tilted = 0;
    for (let i = 0; i < n.count; i++) {
      expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
      expect(n.getY(i)).toBeGreaterThan(0.9);
      if (Math.hypot(n.getX(i), n.getZ(i)) > 0.01) tilted++;
    }
    // ...and they are not all straight up, or there would be no shading at all.
    expect(tilted).toBeGreaterThan(n.count * 0.2);
    geo.dispose();
  });

  it('varies its vertex tint in radius as well as azimuth', () => {
    const geo = buildFarLandGeometry();
    const col = geo.getAttribute('color');
    const ringSpread = (ring: number): number => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let j = 0; j < FAR_LAND_SEGMENTS; j++) {
        const v = col.getX(ring * FAR_LAND_SEGMENTS + j);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return hi - lo;
    };
    expect(ringSpread(2)).toBeGreaterThan(0.02);
    expect(ringSpread(FAR_LAND_RINGS - 2)).toBeGreaterThan(0.02);
    // Radial variation too: one column through the rings must not be flat.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < FAR_LAND_RINGS; i++) {
      const v = col.getX(i * FAR_LAND_SEGMENTS + 9);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(hi - lo).toBeGreaterThan(0.02);
    geo.dispose();
  });

  it('normals agree with the height field it was built from', () => {
    const n = new THREE.Vector3();
    for (const t of [0.2, 0.55, 0.8]) {
      for (const az of [0.4, 2.2, 4.9]) {
        farLandNormal(t, az, n);
        const r = farLandRadius(t);
        // A step outward along the radius must move with the surface: the
        // normal is perpendicular to it, so their dot product is ~0.
        const dr = 4;
        const tangent = new THREE.Vector3(
          Math.sin(az) * dr,
          farLandHeightAt(r + dr, az) - farLandHeightAt(r, az),
          Math.cos(az) * dr,
        );
        expect(Math.abs(n.dot(tangent.normalize()))).toBeLessThan(0.2);
      }
    }
  });
});

describe('FarLand', () => {
  function rig(): { land: FarLand; scene: THREE.Scene; path: RoadPath } {
    const scene = new THREE.Scene();
    return { land: new FarLand(scene), scene, path: new RoadPath(1337) };
  }

  it('is added to the scene, and is ordered so it covers sky but not the sun', () => {
    const { land, scene } = rig();
    expect(scene.children).toContain(land.mesh);
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    // No depth writes, and ordered after the sky dome (-10) but before the sun
    // and moon discs (-9). Ahead of the sun matters: on `quality: 'low'` there
    // is no GodRaysEffect to make the disc transparent, so a fan drawn after
    // it would paint it out at golden hour.
    expect(mat.depthWrite).toBe(false);
    expect(land.mesh.renderOrder).toBeLessThan(-9);
    expect(land.mesh.renderOrder).toBeGreaterThan(-10);
    // Both faces: the ridge is above the eye and shows its underside.
    expect(mat.side).toBe(THREE.DoubleSide);
  });

  it('stands on the ground under the camera, not on the camera', () => {
    const { land, path } = rig();
    // The eye is 30 m up and 40 m off the centreline; the fan belongs on the
    // land beneath it, which is neither.
    const camPos = new THREE.Vector3(12, 30, -8);
    land.update(path, camPos, 900, 40, 0.016);
    expect(land.mesh.position.y).toBeCloseTo(terrainMeshHeight(path, 900, 40), 6);
    expect(land.mesh.position.y).not.toBeCloseTo(camPos.y, 1);
    // ...and follows the camera in the plane, wherever the floating origin has
    // put it. Post-rebase coordinates are just different numbers.
    expect(land.mesh.position.x).toBe(camPos.x);
    expect(land.mesh.position.z).toBe(camPos.z);
    land.update(path, new THREE.Vector3(-1900, 12, 2044), 900, 40, 0.016);
    expect(land.mesh.position.x).toBe(-1900);
    expect(land.mesh.position.z).toBe(2044);
  });

  it('samples the ground under the camera rather than under the car', () => {
    // In attract mode the director stands as much as MENU_MAX_LEAD = 260 m
    // down the road from the car, over land of its own height.
    const { land, path } = rig();
    const carS = 2000;
    const camS = carS + 260;
    land.update(path, new THREE.Vector3(), camS, 0, 0.016);
    expect(land.mesh.position.y).toBeCloseTo(terrainMeshHeight(path, camS, 0), 6);
    expect(terrainMeshHeight(path, camS, 0)).not.toBeCloseTo(terrainMeshHeight(path, carS, 0), 1);
  });

  it('damps the anchor along a slope', () => {
    const { land, path } = rig();
    land.update(path, new THREE.Vector3(), 500, 0, 0.016);
    const settled = land.mesh.position.y;
    // A neighbouring sample is a slope: the anchor eases toward it rather than
    // stepping, so a menu eye crossing terrain facets does not jitter the
    // horizon.
    const near = terrainMeshHeight(path, 506, 0);
    land.update(path, new THREE.Vector3(), 506, 0, 0.016);
    const damped = land.mesh.position.y;
    expect(damped).not.toBeCloseTo(near, 6);
    expect(Math.abs(damped - settled)).toBeLessThan(Math.abs(near - settled) + 1e-9);
    expect(damped).toBeCloseTo(THREE.MathUtils.damp(settled, near, FAR_LAND_ANCHOR_DAMP, 0.016), 6);
  });

  it('snaps across a cut the median shot change actually makes', () => {
    // The case that matters, and the one a height threshold got wrong. The
    // median `roadsideStatic` cut moves the vantage 268 m — from just behind
    // the car to MENU_MAX_LEAD ahead and out to the shoulder — while moving
    // the *ground* only a few metres, well under any height threshold worth
    // having. Damping that slides the horizon for most of a second, on the one
    // shot whose rig is deliberately static.
    const path = new RoadPath(1337);
    let checked = 0;
    for (let carS = 2000; carS < 40000; carS += 971) {
      const land = new FarLand(new THREE.Scene());
      // Settle on the outgoing vantage: just behind the car, in lane.
      for (let i = 0; i < 240; i++) {
        land.update(path, new THREE.Vector3(), carS - 8, 2.1, 0.016);
      }
      const before = land.mesh.position.y;
      // Cut to the incoming one.
      const cutS = carS + 260;
      const cutLat = 19.1;
      const target = terrainMeshHeight(path, cutS, cutLat);
      land.update(path, new THREE.Vector3(), cutS, cutLat, 0.016);
      expect(land.mesh.position.y).toBeCloseTo(target, 6);
      // ...and this is a cut the ground height alone would have missed: it is
      // the vantage that jumps, not necessarily what it lands on.
      if (Math.abs(target - before) < FAR_LAND_CUT_DISTANCE) checked++;
      land.dispose();
    }
    // Most of them, in fact — which is why the height was the wrong quantity.
    expect(checked).toBeGreaterThan(20);
  });

  it('re-anchors when the world is re-seeded under it', () => {
    // `RoadPath.reset` re-bases the curve, so the height the anchor is holding
    // is measured in a world that no longer exists. Nothing about the vantage
    // has to change for that to be true, so `update` cannot infer it.
    const { land } = rig();
    const path = new RoadPath(1337);
    for (let i = 0; i < 240; i++) land.update(path, new THREE.Vector3(), 4000, 0, 0.016);
    path.reset(4000);
    const target = terrainMeshHeight(path, 4000, 0);
    // Same vantage, different world: damping would ease across the re-base.
    land.update(path, new THREE.Vector3(), 4000, 0, 0.016);
    expect(land.mesh.position.y).not.toBeCloseTo(target, 3);
    land.reanchor();
    land.update(path, new THREE.Vector3(), 4000, 0, 0.016);
    expect(land.mesh.position.y).toBeCloseTo(target, 6);
  });

  it('takes the biome ground tone the terrain ribbon is built from', () => {
    const { land, path } = rig();
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    const expected = new THREE.Color();
    // Mid-biome and mid-crossfade — the ring must not read grey in one biome
    // and match in the next.
    const midBlend = BIOME_LEN - BLEND_LEN / 2;
    for (const s of [500, BIOME_LEN + 900, midBlend, midBlend + BIOME_LEN]) {
      land.update(path, new THREE.Vector3(), s, 0, 0.016);
      blendColor(s, (b) => b.ground, expected);
      expect(mat.color.getHex()).toBe(expected.getHex());
    }
  });

  it('lands between the two biomes it is crossfading, not on either', () => {
    const { land, path } = rig();
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    const s = BIOME_LEN - BLEND_LEN / 2;
    // Its own scratch, not a shared one: this sample is held across the
    // `land.update` below, which samples biomes again through `blendColor`.
    const sample = biomeAt(s, createBiomeSample());
    expect(sample.blend).toBeGreaterThan(0.1);
    expect(sample.blend).toBeLessThan(0.9);
    land.update(path, new THREE.Vector3(), s, 0, 0.016);
    const from = new THREE.Color(BIOMES[sample.weights[0].id].ground);
    const to = new THREE.Color(BIOMES[sample.weights[1].id].ground);
    expect(mat.color.getHex()).not.toBe(from.getHex());
    expect(mat.color.getHex()).not.toBe(to.getHex());
    expect(mat.color.r).toBeGreaterThan(Math.min(from.r, to.r) - 1e-6);
    expect(mat.color.r).toBeLessThan(Math.max(from.r, to.r) + 1e-6);
  });

  it('releases its scene slot and its GPU buffers on dispose', () => {
    const { land, scene } = rig();
    const geo = land.mesh.geometry;
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    let geoDisposed = false;
    let matDisposed = false;
    geo.addEventListener('dispose', () => {
      geoDisposed = true;
    });
    mat.addEventListener('dispose', () => {
      matDisposed = true;
    });
    land.dispose();
    expect(scene.children).not.toContain(land.mesh);
    expect(geoDisposed).toBe(true);
    expect(matDisposed).toBe(true);
  });

  it('builds nothing per frame', () => {
    const { land, path } = rig();
    const geo = land.mesh.geometry;
    const posArray = geo.getAttribute('position').array;
    const mat = land.mesh.material;
    const pos = land.mesh.position;
    const color = (mat as THREE.MeshToonMaterial).color;
    const camera = new THREE.Vector3();
    for (let i = 0; i < 600; i++) {
      camera.set(i, i * 0.1, -i);
      land.update(path, camera, i * 7, (i % 40) - 20, 0.016);
    }
    // Same geometry, same buffer, same material, same Vector3 and Color being
    // written through: update mutates in place and never rebuilds. This proves
    // object identity only — it does NOT prove update allocates nothing, and
    // it does not, because the biome blend it calls allocates per call.
    expect(land.mesh.geometry).toBe(geo);
    expect(geo.getAttribute('position').array).toBe(posArray);
    expect(land.mesh.material).toBe(mat);
    expect(land.mesh.position).toBe(pos);
    expect((land.mesh.material as THREE.MeshToonMaterial).color).toBe(color);
  });
});
