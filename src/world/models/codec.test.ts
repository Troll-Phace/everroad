import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CAR_BODY_TYPES } from '../../types';
import { SCENERY_KINDS } from '../biomes';
// The encoder is the build-time half of this format; importing it here is the
// point of the file — the two must agree byte for byte.
import {
  BUDGETS,
  CAR_BODY_TYPES as VALIDATOR_CAR_BODY_TYPES,
  SCENERY_KINDS as VALIDATOR_SCENERY_KINDS,
  encodeModel,
  modelBytes,
  validateModel,
} from '../../../scripts/lib/model-codec.mjs';
import { decodePart, modelTriangles, type EncodedModel } from './codec';
import { buildProtoFromModel } from './sceneryModel';
import { buildRigFromModel } from './carModel';

/** Unit box centred on (0, 0.5, 0): 8 vertices, 12 triangles. */
function boxPart(overrides: Record<string, unknown> = {}) {
  const positions: number[][] = [];
  for (const x of [-0.5, 0.5]) {
    for (const y of [0, 1]) {
      for (const z of [-0.5, 0.5]) positions.push([x, y, z]);
    }
  }
  // Index layout: x*4 + y*2 + z
  const quad = (a: number, b: number, c: number, d: number) => [
    [a, b, c],
    [a, c, d],
  ];
  const triangles = [
    ...quad(0, 1, 3, 2),
    ...quad(4, 6, 7, 5),
    ...quad(0, 2, 6, 4),
    ...quad(1, 5, 7, 3),
    ...quad(2, 3, 7, 6),
    ...quad(0, 4, 5, 1),
  ];
  return {
    name: 'box',
    role: 'static',
    slot: '#8fb54a',
    smooth: false,
    positions,
    triangles,
    ...overrides,
  };
}

function sceneryDoc(parts: unknown[] = [boxPart()]) {
  return {
    schema: 1,
    name: 'scenery.rock',
    profile: 'scenery',
    meta: { radius: 0.8, height: 1 },
    parts,
  };
}

function carDoc() {
  const wheels = (['fl', 'fr', 'rl', 'rr'] as const).map((suffix, i) =>
    boxPart({
      name: `wheel_${suffix}`,
      role: 'wheel',
      slot: 'tire',
      pivot: [i < 2 ? -0.8 : 0.8, 0.34, i % 2 === 0 ? 1.2 : -1.2],
    }),
  );
  return {
    schema: 1,
    name: 'car.compact',
    profile: 'car',
    meta: { bodyType: 'compact', wheelRadius: 0.34, scaleHint: 0.9 },
    parts: [boxPart({ name: 'chassis', slot: 'body' }), ...wheels],
  };
}

function encoded(doc: unknown): EncodedModel {
  validateModel(doc);
  return encodeModel(doc) as EncodedModel;
}

describe('encode/decode round trip', () => {
  it('recovers positions within the quantisation step', () => {
    const model = encoded(sceneryDoc());
    const part = decodePart(model.parts[0]);
    const source = boxPart();

    expect(part.vertexCount).toBe(source.triangles.length * 3);
    // Round-tripping through 16 bits over a 1 m span can only lose half a
    // step. Anything looser would not notice an off-by-one in the offset.
    const tolerance = 0.5 / 65535 + 1e-6;
    let worst = 0;
    source.triangles.forEach((tri, t) => {
      tri.forEach((srcIndex, corner) => {
        const dst = (t * 3 + corner) * 3;
        for (let a = 0; a < 3; a++) {
          worst = Math.max(
            worst,
            Math.abs(part.positions[dst + a] - source.positions[srcIndex][a]),
          );
        }
      });
    });
    expect(worst).toBeLessThan(tolerance);
  });

  it('derives unit normals, flat per triangle by default', () => {
    const part = decodePart(encoded(sceneryDoc()).parts[0]);
    for (let v = 0; v < part.vertexCount; v++) {
      const len = Math.hypot(part.normals[v * 3], part.normals[v * 3 + 1], part.normals[v * 3 + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
    for (let t = 0; t < part.vertexCount / 3; t++) {
      for (let a = 0; a < 3; a++) {
        expect(part.normals[(t * 3 + 1) * 3 + a]).toBeCloseTo(part.normals[t * 3 * 3 + a], 6);
        expect(part.normals[(t * 3 + 2) * 3 + a]).toBeCloseTo(part.normals[t * 3 * 3 + a], 6);
      }
    }
  });

  it('averages normals across shared vertices when smooth', () => {
    const flat = decodePart(encoded(sceneryDoc()).parts[0]);
    const smooth = decodePart(encoded(sceneryDoc([boxPart({ smooth: true })])).parts[0]);
    // A box corner's averaged normal points diagonally, never axis-aligned.
    const maxComponent = Math.max(
      Math.abs(smooth.normals[0]),
      Math.abs(smooth.normals[1]),
      Math.abs(smooth.normals[2]),
    );
    expect(maxComponent).toBeLessThan(0.95);
    expect(smooth.normals).not.toEqual(flat.normals);
    for (let v = 0; v < smooth.vertexCount; v++) {
      const len = Math.hypot(
        smooth.normals[v * 3],
        smooth.normals[v * 3 + 1],
        smooth.normals[v * 3 + 2],
      );
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('round-trips shade and defaults it to 1', () => {
    const shade = Array.from({ length: 8 }, (_, i) => 0.72 + i * 0.05);
    const withShade = decodePart(encoded(sceneryDoc([boxPart({ shade })])).parts[0]);
    const plain = decodePart(encoded(sceneryDoc()).parts[0]);

    const source = boxPart();
    source.triangles.forEach((tri, t) => {
      tri.forEach((srcIndex, corner) => {
        expect(withShade.shade[t * 3 + corner]).toBeCloseTo(shade[srcIndex], 2);
      });
    });
    expect(Array.from(plain.shade)).toEqual(Array(plain.vertexCount).fill(1));
  });

  it('survives a degenerate axis', () => {
    const flatPart = boxPart({
      positions: [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 0, 1],
        [-1, 0, 1],
      ],
      triangles: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    });
    const part = decodePart(encoded(sceneryDoc([flatPart])).parts[0]);
    for (let v = 0; v < part.vertexCount; v++) expect(part.positions[v * 3 + 1]).toBe(0);
  });

  it('reports the byte cost it is budgeted against', () => {
    const model = encoded(sceneryDoc());
    // 8 verts * 6 + 12 tris * 6, no shade.
    expect(modelBytes(model)).toBe(8 * 6 + 12 * 6);
    expect(modelTriangles(model)).toBe(12);
    expect(modelBytes(model)).toBeLessThan(BUDGETS.maxBytes);
  });
});

describe('scenery assembly', () => {
  it('produces a Proto matching the procedural contract', () => {
    const proto = buildProtoFromModel(encoded(sceneryDoc()));
    expect(proto.vertexCount).toBe(36);
    expect(proto.pos.length).toBe(36 * 3);
    expect(proto.norm.length).toBe(36 * 3);
    expect(proto.baked.length).toBe(36 * 3);
    expect(proto.shade.length).toBe(36);
    expect(proto.mask.length).toBe(36);
    expect(proto.radius).toBe(0.8);
    expect(proto.height).toBe(1);
  });

  it('masks tinted parts and bakes literal colours', () => {
    const tinted = buildProtoFromModel(encoded(sceneryDoc([boxPart({ slot: 'tint' })])));
    expect(Array.from(tinted.mask)).toEqual(Array(36).fill(1));

    const baked = buildProtoFromModel(encoded(sceneryDoc()));
    expect(Array.from(baked.mask)).toEqual(Array(36).fill(0));
    const expected = new THREE.Color('#8fb54a');
    expect(baked.baked[0]).toBeCloseTo(expected.r, 5);
    expect(baked.baked[1]).toBeCloseTo(expected.g, 5);
    expect(baked.baked[2]).toBeCloseTo(expected.b, 5);
  });
});

describe('car assembly', () => {
  const style = { bodyType: 'compact', bodyColor: '#d98e73', accentColor: '#8a5a44', scale: 0.9 };

  it('reproduces the CarRig contract animateCar depends on', () => {
    const rig = buildRigFromModel(encoded(carDoc()), style as never);

    expect(rig.bodyType).toBe('compact');
    expect(rig.wheelRadius).toBeCloseTo(0.34 * 0.9, 6);
    expect(rig.group.scale.x).toBeCloseTo(0.9, 6);
    expect(rig.wheels).toHaveLength(4);

    for (const wheel of rig.wheels) {
      const group = wheel.userData.wheelGroup as THREE.Group;
      expect(group).toBeInstanceOf(THREE.Group);
      // animateCar indexes children[1] for the hub.
      expect(group.children.length).toBe(2);
      expect(group.children[1]).toBeDefined();
      expect(wheel.rotation.z).toBeCloseTo(Math.PI / 2, 6);
    }
  });

  it('places wheels at their pivots and keeps geometry per-rig', () => {
    const model = encoded(carDoc());
    const a = buildRigFromModel(model, style as never);
    const b = buildRigFromModel(model, style as never);

    const pivots = a.wheels.map((w) => (w.userData.wheelGroup as THREE.Group).position.x);
    expect(pivots.filter((x) => x < 0)).toHaveLength(2);
    expect(pivots.filter((x) => x > 0)).toHaveLength(2);

    const geoA = a.wheels[0].geometry.getAttribute('position');
    const geoB = b.wheels[0].geometry.getAttribute('position');
    expect(geoA.array).not.toBe(geoB.array);
  });

  it('leaves the authored orientation intact through the spin frame', () => {
    const model = encoded(carDoc());
    const wheelIndex = model.parts.findIndex((p) => p.name === 'wheel_fl');
    const authored = decodePart(model.parts[wheelIndex]);
    const tire = buildRigFromModel(model, style as never).wheels[0];

    // The mesh carries rotation.z = PI/2 so that its local Y is the axle; the
    // geometry is counter-rotated by the same amount. Applying the mesh's own
    // matrix to its geometry must therefore reproduce the authored vertices
    // exactly — if either half of that pair is dropped, the wheel sits 90 deg
    // out and this fails.
    tire.updateMatrix();
    const position = tire.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    let worst = 0;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(tire.matrix);
      worst = Math.max(
        worst,
        Math.abs(v.x - authored.positions[i * 3]),
        Math.abs(v.y - authored.positions[i * 3 + 1]),
        Math.abs(v.z - authored.positions[i * 3 + 2]),
      );
    }
    expect(worst).toBeLessThan(1e-6);

    // And local +Y really is the axle once the rig is in world space.
    tire.updateMatrixWorld(true);
    const axle = new THREE.Vector3(0, 1, 0).applyQuaternion(
      tire.getWorldQuaternion(new THREE.Quaternion()),
    );
    expect(Math.abs(axle.x)).toBeCloseTo(1, 5);
  });
});

describe('validation', () => {
  const bad = (doc: unknown, message: RegExp) => expect(() => validateModel(doc)).toThrow(message);

  it('rejects a wrong schema', () => bad({ ...sceneryDoc(), schema: 2 }, /schema/));
  it('rejects a name that is not a SceneryKind', () =>
    bad({ ...sceneryDoc(), name: 'scenery.gazebo' }, /SceneryKind/));
  it('rejects an out-of-range triangle index', () =>
    bad(sceneryDoc([boxPart({ triangles: [[0, 1, 99]] })]), /out of range/));
  it('rejects scenery buried below the origin', () =>
    bad(
      sceneryDoc([
        boxPart({
          positions: [
            [0, -1, 0],
            [1, -1, 0],
            [0, -1, 1],
          ],
          triangles: [[0, 1, 2]],
        }),
      ]),
      /below y=0/,
    ));
  it('rejects a non-static scenery role', () =>
    bad(sceneryDoc([boxPart({ role: 'wheel' })]), /role "static"/));
  it('rejects an unknown slot', () => bad(sceneryDoc([boxPart({ slot: 'chrome' })]), /slot/));
  it('rejects a car with the wrong wheel count', () => {
    const doc = carDoc();
    doc.parts = doc.parts.slice(0, 4);
    bad(doc, /0 or 4 wheel parts/);
  });
  it('rejects a hub with no matching wheel', () => {
    const doc = carDoc();
    doc.parts.push(boxPart({ name: 'hub_xx', role: 'hub', slot: 'hub' }) as never);
    bad(doc, /no matching wheel/);
  });
  it('rejects hover pads on a wheeled body', () => {
    const doc = carDoc();
    doc.parts.push(boxPart({ name: 'pad_a', role: 'hoverPad', slot: 'pad' }) as never);
    bad(doc, /only the hover body type/);
  });
  it('rejects a tri count over the profile budget', () => {
    const many = Array.from({ length: BUDGETS.scenery.maxTris + 1 }, () => [0, 1, 2]);
    bad(sceneryDoc([boxPart({ triangles: many })]), /exceeds the scenery budget/);
  });
  it('accepts a well-formed model of each profile', () => {
    expect(validateModel(sceneryDoc()).tris).toBe(12);
    expect(validateModel(carDoc()).tris).toBe(60);
  });
});

describe('validator stays in step with the game', () => {
  // The validator is plain JS and cannot import the TypeScript unions, so it
  // keeps its own copies. Without this, adding a SceneryKind would silently
  // make its recipe un-exportable with a misleading "not a SceneryKind".
  it('knows exactly the scenery kinds biomes.ts defines', () => {
    expect([...VALIDATOR_SCENERY_KINDS].sort()).toEqual([...SCENERY_KINDS].sort());
  });

  it('knows exactly the car body types types.ts defines', () => {
    expect([...VALIDATOR_CAR_BODY_TYPES].sort()).toEqual([...CAR_BODY_TYPES].sort());
  });
});
