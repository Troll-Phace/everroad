/**
 * EverRoad model encoder + validator.
 *
 * Turns a `.evr.json` intermediate (the Blender exporter's output) into the
 * compact, quantised form that `src/world/models/generated.ts` carries.
 *
 * The decoder lives in `src/world/models/codec.ts` and must stay byte-compatible
 * with this file; `src/world/models/codec.test.ts` round-trips the two against
 * each other so drift fails CI rather than shipping a mangled mesh.
 *
 * Binary layout, per part, little-endian:
 *
 *   Int16  positions[vertexCount * 3]   quantised into the part's bbox
 *   Uint16 indices  [triCount * 3]
 *   Uint8  shade    [vertexCount]       present only when hasShade
 *
 * Normals are not stored — the decoder derives them from triangle winding,
 * flat or smoothed per the part's `smooth` flag.
 */

export const SCHEMA = 1;

export const CAR_BODY_TYPES = [
  'compact',
  'sedan',
  'wagon',
  'pickup',
  'van',
  'classic',
  'sports',
  'muscle',
  'super',
  'hover',
];

export const SCENERY_KINDS = [
  'oak',
  'maple',
  'pine',
  'poplar',
  'cherryTree',
  'rock',
  'flowers',
  'grassTuft',
  'hay',
  'fence',
  'windmill',
  'sunflowerPatch',
  'lavenderRow',
  'reeds',
];

export const SCENERY_SLOTS = ['tint'];
export const CAR_SLOTS = ['body', 'accent', 'glass', 'tire', 'hub', 'head', 'tail', 'pad', 'glow'];
export const ROLES = ['static', 'wheel', 'hub', 'hoverPad', 'glow'];
export const WHEEL_SUFFIXES = ['fl', 'fr', 'rl', 'rr'];

/**
 * Budgets. `warn` is an eyebrow raise; `max` fails the build.
 *
 * Scenery is the tight one: `chunks.ts` CPU-bakes every placement into a
 * merged geometry, so ~45 placements per chunk multiply whatever a proto
 * costs. The heaviest procedural proto (sunflowerPatch) is 1232 tris and the
 * median tree is 264 — a handcrafted replacement should land near the latter.
 * Only one car is on screen at a time, so its budget is far looser.
 */
export const BUDGETS = {
  scenery: { warnTris: 500, maxTris: 1400 },
  car: { warnTris: 3000, maxTris: 6000 },
  /** Decoded bytes, per model and across every model in the bundle. */
  warnBytes: 40_000,
  maxBytes: 150_000,
  maxTotalBytes: 120_000,
};

const HEX = /^#[0-9a-f]{6}$/;

class ModelError extends Error {}

function fail(name, message) {
  throw new ModelError(`${name}: ${message}`);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Throw unless `doc` is a well-formed intermediate for its profile. */
export function validateModel(doc, source = '<model>') {
  if (!doc || typeof doc !== 'object') fail(source, 'not an object');
  if (doc.schema !== SCHEMA) fail(source, `unsupported schema ${doc.schema} (expected ${SCHEMA})`);
  if (typeof doc.name !== 'string') fail(source, 'missing name');

  const profile = doc.profile;
  if (profile !== 'scenery' && profile !== 'car') fail(doc.name, `unknown profile ${profile}`);

  const [prefix, key, ...rest] = doc.name.split('.');
  if (prefix !== profile || !key || rest.length) {
    fail(doc.name, `name must be "${profile}.<key>"`);
  }
  if (profile === 'scenery' && !SCENERY_KINDS.includes(key)) {
    fail(doc.name, `"${key}" is not a SceneryKind`);
  }
  if (profile === 'car' && !CAR_BODY_TYPES.includes(key)) {
    fail(doc.name, `"${key}" is not a CarBodyType`);
  }

  if (!Array.isArray(doc.parts) || doc.parts.length === 0) fail(doc.name, 'has no parts');

  const slots = profile === 'scenery' ? SCENERY_SLOTS : CAR_SLOTS;
  const seen = new Set();
  let tris = 0;
  let minY = Infinity;

  for (const part of doc.parts) {
    const where = `${doc.name} part "${part?.name}"`;
    if (!part || typeof part.name !== 'string') fail(doc.name, 'a part has no name');
    if (seen.has(part.name)) fail(doc.name, `duplicate part name "${part.name}"`);
    seen.add(part.name);

    if (!ROLES.includes(part.role)) fail(where, `unknown role "${part.role}"`);
    if (profile === 'scenery' && part.role !== 'static') {
      fail(where, `scenery parts must be role "static", got "${part.role}"`);
    }
    if (!slots.includes(part.slot) && !HEX.test(part.slot)) {
      fail(where, `slot "${part.slot}" is neither a ${profile} slot nor a #rrggbb colour`);
    }

    const positions = part.positions;
    const triangles = part.triangles;
    if (!Array.isArray(positions) || positions.length === 0) fail(where, 'has no positions');
    if (!Array.isArray(triangles) || triangles.length === 0) fail(where, 'has no triangles');
    if (positions.length > 65536) {
      fail(where, `${positions.length} vertices exceeds the 65536 Uint16 index ceiling`);
    }
    for (const p of positions) {
      if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) {
        fail(where, 'a position is not a finite [x, y, z]');
      }
      if (p[1] < minY) minY = p[1];
    }
    for (const t of triangles) {
      if (!Array.isArray(t) || t.length !== 3) fail(where, 'a triangle is not a 3-tuple');
      for (const i of t) {
        if (!Number.isInteger(i) || i < 0 || i >= positions.length) {
          fail(where, `triangle index ${i} is out of range`);
        }
      }
    }
    if (part.shade !== undefined) {
      if (!Array.isArray(part.shade) || part.shade.length !== positions.length) {
        fail(where, 'shade must carry one value per vertex');
      }
      if (!part.shade.every((v) => Number.isFinite(v) && v >= 0 && v <= 2)) {
        fail(where, 'shade values must be finite and within [0, 2]');
      }
    }
    if (part.pivot !== undefined) {
      if (
        !Array.isArray(part.pivot) ||
        part.pivot.length !== 3 ||
        !part.pivot.every(Number.isFinite)
      ) {
        fail(where, 'pivot must be a finite [x, y, z]');
      }
    }
    tris += triangles.length;
  }

  if (profile === 'scenery') {
    validateSceneryMeta(doc, minY);
  } else {
    validateCarMeta(doc);
  }

  const budget = BUDGETS[profile];
  if (tris > budget.maxTris) {
    fail(doc.name, `${tris} triangles exceeds the ${profile} budget of ${budget.maxTris}`);
  }
  return { tris, warnings: warningsFor(doc, tris, budget) };
}

function warningsFor(doc, tris, budget) {
  const warnings = [];
  if (tris > budget.warnTris) {
    warnings.push(`${tris} triangles is above the ${budget.warnTris} comfort line`);
  }
  return warnings;
}

function validateSceneryMeta(doc, minY) {
  const meta = doc.meta ?? {};
  for (const key of ['radius', 'height']) {
    if (!Number.isFinite(meta[key]) || meta[key] <= 0) {
      fail(doc.name, `meta.${key} must be a positive number (chunks.ts needs it)`);
    }
  }
  // chunks.ts sinks placements 0.12 m into the terrain and expects the proto
  // to sit on y=0; a model floating or buried is an authoring mistake.
  if (minY < -0.06) {
    fail(doc.name, `sits ${(-minY).toFixed(3)} m below y=0 — scenery bases at the origin`);
  }
}

function validateCarMeta(doc) {
  const meta = doc.meta ?? {};
  const key = doc.name.split('.')[1];
  if (meta.bodyType !== key) fail(doc.name, `meta.bodyType "${meta.bodyType}" must match the name`);
  if (!Number.isFinite(meta.wheelRadius) || meta.wheelRadius < 0) {
    fail(doc.name, 'meta.wheelRadius must be a non-negative number');
  }

  const wheels = doc.parts.filter((p) => p.role === 'wheel');
  const hubs = doc.parts.filter((p) => p.role === 'hub');
  const pads = doc.parts.filter((p) => p.role === 'hoverPad');

  if (wheels.length !== 0 && wheels.length !== 4) {
    fail(doc.name, `expected 0 or 4 wheel parts, found ${wheels.length}`);
  }
  if (wheels.length === 4) {
    const suffixes = wheels.map((w) => w.name.split('_').pop());
    for (const s of WHEEL_SUFFIXES) {
      if (!suffixes.includes(s)) fail(doc.name, `missing wheel "*_${s}" (need ${WHEEL_SUFFIXES})`);
    }
    if (meta.wheelRadius <= 0) fail(doc.name, 'a wheeled car needs a positive meta.wheelRadius');
    // animateCar spins a wheel at speedMps / meta.wheelRadius, so a tyre resized
    // in the recipe without touching evr.car(wheel_radius=...) desynchronises the
    // roll from the ground and still passes every other gate. Measure the tyre
    // rather than trusting the declaration: wheel positions are pivot-relative
    // and the axle is X, so the radius is the reach in Y/Z.
    for (const wheel of wheels) {
      let measured = 0;
      for (const p of wheel.positions) {
        measured = Math.max(measured, Math.abs(p[1]), Math.abs(p[2]));
      }
      if (Math.abs(measured - meta.wheelRadius) > 0.005) {
        fail(
          doc.name,
          `wheel "${wheel.name}" measures ${measured.toFixed(3)} m but meta.wheelRadius ` +
            `is ${meta.wheelRadius} — wheel spin would not match ground speed`,
        );
      }
    }
  }
  for (const hub of hubs) {
    const suffix = hub.name.split('_').pop();
    if (!wheels.some((w) => w.name.split('_').pop() === suffix)) {
      fail(doc.name, `hub "${hub.name}" has no matching wheel "*_${suffix}"`);
    }
  }
  if (key === 'hover') {
    if (wheels.length) fail(doc.name, 'hover bodies must not have wheel parts');
    if (!pads.length) fail(doc.name, 'hover bodies need at least one hoverPad part');
  } else if (pads.length) {
    fail(doc.name, 'only the hover body type may carry hoverPad parts');
  }
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const POS_RANGE = 65535;
const SHADE_SCALE = 2;

function quantize(value, min, span) {
  if (span <= 0) return 0;
  const t = (value - min) / span;
  const q = Math.round(Math.min(1, Math.max(0, t)) * POS_RANGE) - 32768;
  return Math.min(32767, Math.max(-32768, q));
}

/** Encode one validated intermediate. Returns the shape `generated.ts` holds. */
export function encodeModel(doc) {
  const parts = doc.parts.map((part) => encodePart(part));
  return {
    name: doc.name,
    profile: doc.profile,
    meta: doc.meta,
    parts,
  };
}

function encodePart(part) {
  const positions = part.positions;
  const triangles = part.triangles;
  const vertexCount = positions.length;
  const triCount = triangles.length;
  const hasShade = Array.isArray(part.shade);

  const raw = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let a = 0; a < 3; a++) {
      if (p[a] < raw[a]) raw[a] = p[a];
      if (p[a] > raw[a + 3]) raw[a + 3] = p[a];
    }
  }
  // Quantise against the rounded bbox — it is what ships, and what the decoder
  // dequantises against. Rounding after quantising would offset every vertex.
  const bbox = raw.map((v) => Number(v.toFixed(5)));

  const bytes = vertexCount * 6 + triCount * 6 + (hasShade ? vertexCount : 0);
  const buffer = new ArrayBuffer(bytes);
  const pos = new Int16Array(buffer, 0, vertexCount * 3);
  const idx = new Uint16Array(buffer, vertexCount * 6, triCount * 3);

  for (let v = 0; v < vertexCount; v++) {
    for (let a = 0; a < 3; a++) {
      pos[v * 3 + a] = quantize(positions[v][a], bbox[a], bbox[a + 3] - bbox[a]);
    }
  }
  for (let t = 0; t < triCount; t++) {
    idx[t * 3] = triangles[t][0];
    idx[t * 3 + 1] = triangles[t][1];
    idx[t * 3 + 2] = triangles[t][2];
  }
  if (hasShade) {
    const shade = new Uint8Array(buffer, vertexCount * 6 + triCount * 6, vertexCount);
    for (let v = 0; v < vertexCount; v++) {
      const t = Math.min(1, Math.max(0, part.shade[v] / SHADE_SCALE));
      shade[v] = Math.round(t * 255);
    }
  }

  const encoded = {
    name: part.name,
    role: part.role,
    slot: part.slot,
    smooth: Boolean(part.smooth),
    vertexCount,
    triCount,
    bbox,
    hasShade,
    data: base64(new Uint8Array(buffer)),
  };
  if (part.pivot) encoded.pivot = part.pivot.map((v) => Number(v.toFixed(5)));
  return encoded;
}

function base64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

/** Decoded byte count of an encoded model — what the budget is measured in. */
export function modelBytes(encoded) {
  return encoded.parts.reduce(
    (sum, p) => sum + p.vertexCount * 6 + p.triCount * 6 + (p.hasShade ? p.vertexCount : 0),
    0,
  );
}
