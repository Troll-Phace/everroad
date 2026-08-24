import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FarLand,
  FAR_LAND_INNER_ANGLE_DEG,
  FAR_LAND_INNER_RADIUS,
  FAR_LAND_OUTER_RADIUS,
  FAR_LAND_RIDGE_ANGLE_DEG,
  FAR_LAND_RIDGE_NOISE_DEG,
  FAR_LAND_RINGS,
  FAR_LAND_SEGMENTS,
  buildFarLandGeometry,
  farLandAngle,
  farLandHeight,
  farLandRadius,
} from './farLand';
import { CHUNK_LEN, TER_COLS } from './chunks';
import { BIOMES, BIOME_LEN, BLEND_LEN, biomeAt, blendColor } from './biomes';

const AZIMUTHS = 720;
const azimuth = (j: number): number => (j / AZIMUTHS) * Math.PI * 2;
const deg = (rad: number): number => (rad * 180) / Math.PI;

describe('far land placement', () => {
  it('keeps its inner rim inside the terrain ribbon on every side', () => {
    // The rim is only invisible because real terrain is always drawn over it.
    // The ribbon reaches TER_COLS laterally and BEHIND (3) * CHUNK_LEN behind
    // the car; the rim has to fit inside the smaller of those.
    const lateral = Math.min(Math.abs(TER_COLS[0]), Math.abs(TER_COLS[TER_COLS.length - 1]));
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(lateral);
    expect(FAR_LAND_INNER_RADIUS).toBeLessThan(3 * CHUNK_LEN);
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
    for (let j = 0; j < AZIMUTHS; j++) {
      const az = azimuth(j);
      let prev = -Infinity;
      for (let i = 0; i <= 400; i++) {
        const angle = farLandAngle(i / 400, az);
        expect(angle).toBeGreaterThan(prev);
        prev = angle;
      }
    }
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
    const sample = biomeAt(s);
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
