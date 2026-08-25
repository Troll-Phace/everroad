import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FarLand,
  FAR_LAND_INNER_ANGLE_DEG,
  FAR_LAND_INNER_RADIUS,
  FAR_LAND_OUTER_RADIUS,
  FAR_LAND_RIDGE_ANGLE_DEG,
  FAR_LAND_RIDGE_NOISE_DEG,
  FAR_LAND_HAZE_RAMP_T,
  FAR_LAND_HAZE_SCALE,
  FAR_LAND_RINGS,
  FAR_LAND_SEGMENTS,
  buildFarLandGeometry,
  farLandAngle,
  farLandBaseAngle,
  farLandHazeDepth,
  farLandHazeScale,
  farLandHeight,
  farLandRadius,
} from './farLand';
import { AHEAD, CHUNK_LEN, PLAY_BEHIND, TER_COLS } from './chunks';
import { BIOMES, BIOME_LEN, BLEND_LEN, biomeAt, blendColor, createBiomeSample } from './biomes';

const AZIMUTHS = 720;
const azimuth = (j: number): number => (j / AZIMUTHS) * Math.PI * 2;
const deg = (rad: number): number => (rad * 180) / Math.PI;

describe('far land placement', () => {
  it('keeps its inner rim inside the terrain ribbon on every side', () => {
    // The rim is only invisible because real terrain is always drawn over it.
    // The ribbon reaches TER_COLS laterally and PLAY_BEHIND * CHUNK_LEN behind
    // the car — the shorter of the two tails, and so the one that binds; the
    // rim has to fit inside the smaller of those.
    const lateral = Math.min(Math.abs(TER_COLS[0]), Math.abs(TER_COLS[TER_COLS.length - 1]));
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(lateral);
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(PLAY_BEHIND * CHUNK_LEN);
  });

  it('stays inside the sky dome and the camera far plane', () => {
    // Sky's dome is a 6000 m sphere (sky.ts) and ChaseCamera's far plane is
    // 9000 m; a vertex past either would be clipped or poke through the sky.
    const furthest = Math.hypot(FAR_LAND_OUTER_RADIUS, farLandHeight(1, 0));
    expect(furthest).toBeLessThan(6000);
  });

  it('spans exactly the configured radii', () => {
    expect(farLandRadius(0)).toBeCloseTo(FAR_LAND_INNER_RADIUS, 6);
    expect(farLandRadius(1)).toBeCloseTo(FAR_LAND_OUTER_RADIUS, 6);
  });
});

describe('far land profile', () => {
  it('rises monotonically in elevation at every azimuth', () => {
    // This is what keeps the fan from overlapping itself as seen from the
    // camera at its centre, and — with the surface being continuous — what
    // makes its angular coverage gapless.
    // 720 azimuths x 401 samples. The comparison is plain JS and only the
    // first breach is handed to `expect`: asserting inside the loop meant
    // ~289,000 matcher calls, which cost seconds of the suite's budget and
    // eventually tipped this test over the 5s default once another test file
    // was added to run alongside it. The coverage is identical.
    let breach: { azimuth: number; sample: number } | null = null;
    outer: for (let j = 0; j < AZIMUTHS; j++) {
      const az = azimuth(j);
      let prev = -Infinity;
      for (let i = 0; i <= 400; i++) {
        const angle = farLandAngle(i / 400, az);
        if (!(angle > prev)) {
          breach = { azimuth: j, sample: i };
          break outer;
        }
        prev = angle;
      }
    }
    expect(breach).toBeNull();
  });

  it('starts well below the land silhouette so nothing shows under the rim', () => {
    // The lowest terrain silhouette measured across the repro is 1.6° above
    // the eye; the rim has to sit under every such value, and does so by
    // sitting below the eye line entirely.
    for (let j = 0; j < AZIMUTHS; j++) {
      expect(deg(farLandAngle(0, azimuth(j)))).toBeCloseTo(FAR_LAND_INNER_ANGLE_DEG, 6);
    }
    expect(FAR_LAND_INNER_ANGLE_DEG).toBeLessThan(-5);
  });

  it('never dips below the ridge floor, at any azimuth', () => {
    // The whole point of the one-sided wander. A symmetric ±wander bottoms out
    // at 5.3°, under the 6.06° worst gap measured, and whether a gap survives
    // then depends on which azimuth the dip lands on. Densely sampled, because
    // the floor is only violated on a fraction of the circle.
    let lowest = Infinity;
    for (let j = 0; j < 20000; j++) {
      lowest = Math.min(lowest, deg(farLandAngle(1, (j / 20000) * Math.PI * 2)));
    }
    expect(lowest).toBeGreaterThanOrEqual(FAR_LAND_RIDGE_ANGLE_DEG - 1e-9);
    // ...and the floor itself has to clear the highest sky gap measured on
    // unfolded road, which is 6.64° at the road's tightest bends (R ~88-92 m).
    expect(lowest).toBeGreaterThan(6.64);
  });

  it('wanders upward only, within the configured band', () => {
    let lowest = Infinity;
    let highest = -Infinity;
    for (let j = 0; j < AZIMUTHS; j++) {
      const ridge = deg(farLandAngle(1, azimuth(j)));
      lowest = Math.min(lowest, ridge);
      highest = Math.max(highest, ridge);
    }
    expect(highest).toBeLessThan(FAR_LAND_RIDGE_ANGLE_DEG + FAR_LAND_RIDGE_NOISE_DEG + 1e-6);
    // A constant-elevation cone projects to a straight line and reads as a
    // lid, so the wander has to survive being made one-sided.
    expect(highest - lowest).toBeGreaterThan(0.7);
    expect(highest - lowest).toBeLessThanOrEqual(FAR_LAND_RIDGE_NOISE_DEG + 1e-6);
    // Folding the wander upward makes the profile monotonic for any amplitude,
    // so nothing else stops it growing into a mountain range. This is the
    // brief's other constraint: the backdrop has to stay a horizon.
    expect(highest).toBeLessThan(10);
  });

  it('joins the ridge angle to a matching height', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      for (const az of [0, 1.3, 2.9, 5.5]) {
        expect(Math.atan2(farLandHeight(t, az), farLandRadius(t))).toBeCloseTo(
          farLandAngle(t, az),
          10,
        );
      }
    }
  });
});

/**
 * Fog transmittance at `d` metres for a given `FogExp2` density — the fraction
 * of a surface's own contrast that survives the haze. three computes the fog
 * factor as `1 - exp(-(density * depth)^2)`, so this is its complement.
 */
function transmittance(d: number, density: number): number {
  return Math.exp(-Math.pow(d * density, 2));
}

describe('far land aerial perspective', () => {
  /** The base density in main.ts, times the thinnest `mist` any biome asks. */
  const THINNEST = 0.0014 * 0.9;

  it('leaves the buried rim fogging on its own true distance', () => {
    // The rim sits a few tens of metres from the eye. Where the ribbon narrows
    // on the inside of a tight bend and it shows through, a rim already carrying
    // kilometres of haze would be a saturated smudge against near ground.
    expect(farLandHazeScale(0)).toBeCloseTo(1, 12);
    expect(farLandHazeDepth(0)).toBeCloseTo(FAR_LAND_INNER_RADIUS, 9);
  });

  it('reaches full scale by the first ring a horizon-grazing ray can meet', () => {
    expect(farLandHazeScale(FAR_LAND_HAZE_RAMP_T)).toBeCloseTo(FAR_LAND_HAZE_SCALE, 9);
    expect(farLandHazeScale(1)).toBeCloseTo(FAR_LAND_HAZE_SCALE, 9);
  });

  it('rises monotonically, so no ring is clearer than one nearer the eye', () => {
    // A dip would put a crisp ring beyond a hazy one and read as a hole in the
    // backdrop. Both the scale and the depth it produces have to be monotone —
    // the radius is already exponential, so only the scale can break it.
    let prevScale = -Infinity;
    let prevDepth = -Infinity;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const scale = farLandHazeScale(t);
      const depth = farLandHazeDepth(t);
      expect(scale).toBeGreaterThanOrEqual(prevScale);
      expect(depth).toBeGreaterThan(prevDepth);
      prevScale = scale;
      prevDepth = depth;
    }
  });

  it('never fogs the fan as though it were nearer than it is', () => {
    // Scaling below 1 would make the backdrop crisper than its own geometry,
    // which is the one direction that cannot be justified as perspective.
    for (let i = 0; i <= 200; i++) {
      const t = i / 200;
      expect(farLandHazeScale(t)).toBeGreaterThanOrEqual(1);
      expect(farLandHazeDepth(t)).toBeGreaterThanOrEqual(farLandRadius(t) - 1e-9);
    }
  });

  it('is never crisper than the ribbon\u2019s far cut anywhere along the join', () => {
    // The join: a sight line grazing the horizon from a camera ~5 m over the
    // road leaves the ribbon at `AHEAD * CHUNK_LEN` and meets the fan somewhere
    // in [-1.1, +0.7] degrees of elevation, the spread being road elevation
    // over 1320 m tilting it. The fan may imply *more* distance than the cut —
    // that is just more recession — but never less, or a vivid backdrop sits on
    // a pale strip of terrain. Asserted on depth rather than on a fog factor
    // because the density cancels: this then holds in every biome, hour and
    // weather rather than at one tuned value.
    const cut = AHEAD * CHUNK_LEN;
    for (let deg = -1.1; deg <= 0.7001; deg += 0.05) {
      let t = 1;
      for (let i = 0; i <= 4000; i++) {
        const u = i / 4000;
        if ((farLandBaseAngle(u) * 180) / Math.PI >= deg) {
          t = u;
          break;
        }
      }
      expect(farLandHazeDepth(t)).toBeGreaterThanOrEqual(cut);
    }
  });

  it('does not over-haze the join to buy that margin', () => {
    // The far end of the join band pays for covering the near end. Keeping it
    // inside 1.5x the cut is what stops "never crisper" being satisfied by
    // simply saturating the entire backdrop, which would flatten the ridge back
    // into the lid this module exists to avoid.
    let t = 1;
    for (let i = 0; i <= 4000; i++) {
      const u = i / 4000;
      if ((farLandBaseAngle(u) * 180) / Math.PI >= 0.7) {
        t = u;
        break;
      }
    }
    expect(farLandHazeDepth(t)).toBeLessThan(1.5 * AHEAD * CHUNK_LEN);
  });

  it('finishes its ramp before the first ring the join can reach', () => {
    // `FAR_LAND_HAZE_SCALE` is derived at full scale, so a ramp still climbing
    // at the lowest join ring (t = 0.2564) would leave the guarantee above
    // resting on a value the fan never actually reaches there.
    expect(FAR_LAND_HAZE_RAMP_T).toBeLessThan(0.2564);
    expect(farLandHazeScale(0.2564)).toBeCloseTo(FAR_LAND_HAZE_SCALE, 9);
  });

  it('is saturated by the ridge, so the silhouette is haze and not a hillside', () => {
    // The ridge is the backdrop's top edge. If its own colour still showed
    // there it would read as a solid green cone rather than distant air.
    expect(transmittance(farLandHazeDepth(1), THINNEST)).toBeLessThan(1e-6);
  });

  it('carries the scale into the geometry, one value per ring', () => {
    const geo = buildFarLandGeometry();
    const haze = geo.getAttribute('aHaze');
    expect(haze.count).toBe(FAR_LAND_RINGS * FAR_LAND_SEGMENTS);
    expect(haze.itemSize).toBe(1);
    for (let i = 0; i < FAR_LAND_RINGS; i++) {
      const expected = farLandHazeScale(i / (FAR_LAND_RINGS - 1));
      for (let j = 0; j < FAR_LAND_SEGMENTS; j++) {
        // Constant around the azimuth: haze is a function of distance only, and
        // a per-azimuth wobble would read as blotches on the horizon.
        expect(haze.getX(i * FAR_LAND_SEGMENTS + j)).toBeCloseTo(expected, 6);
      }
    }
    geo.dispose();
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

  it('wraps the azimuth seam without a crack', () => {
    // The noise is sampled at (cos az, sin az), so the last column and the
    // first are the same point and the fan closes exactly.
    for (const t of [0, 0.5, 1]) {
      expect(farLandHeight(t, 0)).toBeCloseTo(farLandHeight(t, Math.PI * 2), 9);
    }
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

  it('points its normals at the sky like flat land', () => {
    const geo = buildFarLandGeometry();
    const n = geo.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      expect(n.getY(i)).toBeCloseTo(1, 6);
      expect(n.getX(i)).toBeCloseTo(0, 6);
      expect(n.getZ(i)).toBeCloseTo(0, 6);
    }
    geo.dispose();
  });
});

describe('FarLand', () => {
  function rig(): { land: FarLand; scene: THREE.Scene } {
    const scene = new THREE.Scene();
    return { land: new FarLand(scene), scene };
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

  it('follows the camera exactly, wherever the floating origin has put it', () => {
    const { land } = rig();
    // Post-rebase coordinates are just different numbers; nothing is cached.
    for (const p of [new THREE.Vector3(3, 4, 5), new THREE.Vector3(-1900, -37, 2044)]) {
      land.update(p, 1000);
      expect(land.mesh.position.x).toBe(p.x);
      expect(land.mesh.position.y).toBe(p.y);
      expect(land.mesh.position.z).toBe(p.z);
    }
  });

  it('takes the biome ground tone the terrain ribbon is built from', () => {
    const { land } = rig();
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    const expected = new THREE.Color();
    // Mid-biome and mid-crossfade — the ring must not read grey in one biome
    // and match in the next.
    const midBlend = BIOME_LEN - BLEND_LEN / 2;
    for (const s of [500, BIOME_LEN + 900, midBlend, midBlend + BIOME_LEN]) {
      land.update(new THREE.Vector3(), s);
      blendColor(s, (b) => b.ground, expected);
      expect(mat.color.getHex()).toBe(expected.getHex());
    }
  });

  it('lands between the two biomes it is crossfading, not on either', () => {
    const { land } = rig();
    const mat = land.mesh.material as THREE.MeshToonMaterial;
    const s = BIOME_LEN - BLEND_LEN / 2;
    // Its own scratch, not a shared one: this sample is held across the
    // `land.update` below, which samples biomes again through `blendColor`.
    const sample = biomeAt(s, createBiomeSample());
    expect(sample.blend).toBeGreaterThan(0.1);
    expect(sample.blend).toBeLessThan(0.9);
    land.update(new THREE.Vector3(), s);
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
    const { land } = rig();
    const geo = land.mesh.geometry;
    const posArray = geo.getAttribute('position').array;
    const mat = land.mesh.material;
    const pos = land.mesh.position;
    const color = (mat as THREE.MeshToonMaterial).color;
    const camera = new THREE.Vector3();
    for (let i = 0; i < 600; i++) {
      camera.set(i, i * 0.1, -i);
      land.update(camera, i * 7);
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
