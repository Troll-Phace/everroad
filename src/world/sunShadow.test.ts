import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SunShadow, shadowDirection, shadowElevation, shadowStrength } from './sunShadow';
import { DayNight } from '../engine/daynight';
import type { SunSnapshot } from '../engine/daynight';

function snapshot(elevation: number, azimuth = 0.4): SunSnapshot {
  return {
    phase: 'day',
    phaseT: 0.5,
    elevation,
    azimuth,
    sunDir: shadowDirection(azimuth, elevation, new THREE.Vector3()),
    golden: 0,
    nightness: 0,
  };
}

function rig(): SunShadow {
  return new SunShadow(new THREE.Scene(), '#ffffff', 1.6);
}

/** Horizontal distance a caster of height `h` throws its shadow. */
function shadowLength(elevation: number, h: number): number {
  return h / Math.tan(shadowElevation(elevation));
}

describe('shadowElevation', () => {
  it('clamps a low sun up to the floor so shadows stay short', () => {
    // The sky's dawn/sunset sun sits at 0.18 rad; untouched that is cot(0.18)
    // = 5.5x the caster height.
    expect(shadowElevation(0.18)).toBeGreaterThan(0.18);
    expect(shadowLength(0.18, 10)).toBeLessThan(25);
  });

  it('never lets a shadow exceed ~2.4x the caster height, at any hour', () => {
    const day = new DayNight(0);
    let worst = 0;
    // One full cycle at 60 fps-ish steps.
    for (let i = 0; i < 6000; i++) {
      const snap = day.update(545 / 6000);
      worst = Math.max(worst, shadowLength(snap.elevation, 1));
    }
    expect(worst).toBeLessThanOrEqual(2.4);
  });

  it('passes a high sun through unchanged', () => {
    expect(shadowElevation(0.9)).toBeCloseTo(0.9, 10);
  });

  it('is continuous across the horizon', () => {
    expect(shadowElevation(-0.001)).toBeCloseTo(shadowElevation(0.001), 10);
  });
});

describe('shadowStrength', () => {
  it('is zero once the sun is at or below the horizon', () => {
    expect(shadowStrength(0)).toBe(0);
    expect(shadowStrength(-0.5)).toBe(0);
  });

  it('reaches full strength for a risen sun', () => {
    expect(shadowStrength(0.18)).toBe(1);
    expect(shadowStrength(0.9)).toBe(1);
  });

  it('ramps monotonically and without a step across the fade', () => {
    let prev = -1;
    for (let e = -0.05; e <= 0.25; e += 0.002) {
      const v = shadowStrength(e);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(Math.abs(v - Math.max(prev, 0))).toBeLessThan(0.05);
      prev = v;
    }
  });
});

describe('shadowDirection', () => {
  it('matches the day/night sun convention when the elevation is unclamped', () => {
    const day = new DayNight(0.3);
    const snap = day.update(0.016);
    const dir = shadowDirection(snap.azimuth, snap.elevation, new THREE.Vector3());
    expect(dir.distanceTo(snap.sunDir)).toBeLessThan(1e-9);
  });

  it('returns a unit vector', () => {
    expect(shadowDirection(2.1, 0.55, new THREE.Vector3()).length()).toBeCloseTo(1, 10);
  });
});

describe('SunShadow.update', () => {
  it('parks the light on the sunward side of the box, inside the depth range', () => {
    const s = rig();
    const car = new THREE.Vector3(12, 0.4, -30);
    s.update(snapshot(0.5), car, 0.7);

    const toLight = s.light.position.clone().sub(s.light.target.position);
    // Light sits along the shadow direction from the box centre.
    expect(toLight.clone().normalize().y).toBeCloseTo(Math.sin(0.5), 6);
    const cam = s.light.shadow.camera;
    expect(toLight.length()).toBeGreaterThan(cam.near);
    expect(toLight.length()).toBeLessThan(cam.far);
    // The whole box fits between the planes.
    expect(cam.far - cam.near).toBeGreaterThan(2 * (toLight.length() - cam.near) - 1e-6);
  });

  it('keeps the ortho box tight enough to hold the shipped texel density', () => {
    const cam = rig().light.shadow.camera;
    const map = rig().light.shadow.mapSize;
    expect(map.x).toBeLessThanOrEqual(2048);
    expect((cam.right - cam.left) / map.x).toBeLessThanOrEqual(120 / 2048 + 1e-9);
  });

  it('biases coverage ahead of the car while still covering behind it', () => {
    const s = rig();
    const car = new THREE.Vector3(0, 0, 0);
    const yaw = 0; // forward is +Z
    s.update(snapshot(0.6), car, yaw);
    const centre = s.light.target.position;
    const ahead = centre.z - car.z;
    const half = s.light.shadow.camera.right;
    expect(ahead).toBeGreaterThan(20);
    expect(ahead).toBeLessThan(half - 20); // >= 20 m of coverage still behind
  });

  it('follows the car heading rather than a world axis', () => {
    const s = rig();
    const car = new THREE.Vector3(0, 0, 0);
    s.update(snapshot(0.6), car, Math.PI / 2); // forward is +X
    expect(s.light.target.position.x).toBeGreaterThan(20);
    expect(Math.abs(s.light.target.position.z)).toBeLessThan(1);
  });

  it('fades shadows out below the horizon rather than popping', () => {
    const s = rig();
    const car = new THREE.Vector3();
    s.update(snapshot(-0.3), car, 0);
    expect(s.light.shadow.intensity).toBe(0);

    s.update(snapshot(0.09), car, 0);
    expect(s.light.shadow.intensity).toBeGreaterThan(0);
    expect(s.light.shadow.intensity).toBeLessThan(1);

    s.update(snapshot(0.4), car, 0);
    expect(s.light.shadow.intensity).toBe(1);
  });

  it('never toggles castShadow, at any point in the cycle', () => {
    // `castShadow` is set once and left alone: three bakes the shadow-caster
    // count into every shader as NUM_DIR_LIGHT_SHADOWS and folds it into the
    // program cache key, so flipping it evicts and recompiles every
    // shadow-receiving material — a hitch at dusk and again at dawn. Night is
    // paid for with a wasted shadow pass instead, and re-introducing the
    // toggle is the regression this pins.
    const s = rig();
    expect(s.light.castShadow).toBe(true);
    const day = new DayNight(0);
    const car = new THREE.Vector3();
    let dimmest = Infinity;
    let brightest = -Infinity;
    for (let i = 0; i < 3000; i++) {
      s.update(day.update(545 / 3000), car, 0.2);
      expect(s.light.castShadow).toBe(true);
      dimmest = Math.min(dimmest, s.light.shadow.intensity);
      brightest = Math.max(brightest, s.light.shadow.intensity);
    }
    // The sweep is only meaningful if it crossed the whole fade.
    expect(dimmest).toBe(0);
    expect(brightest).toBe(1);
  });

  it('keeps aiming the light while it is not casting, so dawn does not snap', () => {
    const s = rig();
    s.update(snapshot(-0.4, 1.0), new THREE.Vector3(), 0);
    const night = s.light.position.clone().sub(s.light.target.position).normalize();
    // Below the horizon the clamp pins elevation to the floor, same as dawn.
    s.update(snapshot(0.0001, 1.0), new THREE.Vector3(), 0);
    const dawn = s.light.position.clone().sub(s.light.target.position).normalize();
    expect(night.distanceTo(dawn)).toBeLessThan(1e-6);
  });

  it('snaps the box to the texel grid so sub-texel motion does not move it', () => {
    const s = rig();
    const snap = snapshot(0.6);
    const texel = 120 / 2048;
    s.update(snap, new THREE.Vector3(0, 0, 0), 0);
    const a = s.light.target.position.clone();
    s.update(snap, new THREE.Vector3(0, 0, texel * 0.1), 0);
    const b = s.light.target.position.clone();
    expect(a.distanceTo(b)).toBeLessThan(1e-9);
  });

  it('never lets the snapped box drift more than a texel off the car', () => {
    const s = rig();
    const snap = snapshot(0.6);
    const texel = 120 / 2048;
    for (let i = 0; i < 400; i++) {
      const z = i * 0.37;
      s.update(snap, new THREE.Vector3(0, 0, z), 0);
      const drift = Math.hypot(s.light.target.position.x - 0, s.light.target.position.z - (z + 34));
      expect(drift).toBeLessThan(texel);
    }
  });

  it('re-derives placement from the car each frame, surviving an origin rebase', () => {
    const s = rig();
    const snap = snapshot(0.6);
    s.update(snap, new THREE.Vector3(2050, 0, 4), 0.3);
    const before = s.light.position.clone().sub(s.light.target.position);
    // A rebase subtracts the offset from every position; the rig is handed the
    // shifted car in the same frame and must produce the same relative rig.
    s.update(snap, new THREE.Vector3(0, 0, 4), 0.3);
    const after = s.light.position.clone().sub(s.light.target.position);
    expect(before.distanceTo(after)).toBeLessThan(1e-6);
    expect(s.light.target.position.length()).toBeLessThan(100);
  });
});

describe('SunShadow bias', () => {
  /** World size of one shadow-map texel on the ground, read off the rig. */
  function groundTexel(s: SunShadow): number {
    const cam = s.light.shadow.camera;
    return (cam.right - cam.left) / s.light.shadow.mapSize.x;
  }

  /**
   * WHY THIS BOUND EXISTS. `DirectionalLightShadow.normalBias` is measured in
   * WORLD UNITS: three.js displaces every shadow-map lookup that many metres
   * along the receiver's surface normal before comparing depths. This rig
   * originally shipped `normalBias = 2.2`, which moved each lookup 2.2 m
   * sideways across the ground — shadows detached from their casters, walked
   * off their receivers entirely and slid around as the sun turned. Every
   * other test in this file passed throughout, because the aiming, the box and
   * the fade were all correct; only the sampling offset was wrong. So the
   * magnitude is pinned here, and pinned against the ground the map can
   * actually resolve rather than against a bare number: one texel is the ortho
   * box width over the shadow map size (~5.9 cm as shipped), so a bias worth
   * several texels of ground is displacing the lookup further than the map's
   * own resolution — a metres-scale value is the bug, not a tuning choice.
   */
  it('offsets shadow lookups by a fraction of a ground texel, never by metres', () => {
    const s = rig();
    const texel = groundTexel(s);
    expect(texel).toBeGreaterThan(0);
    // Positive: the offset has to push the lookup out along the normal, away
    // from the receiver. Zero or negative reinstates the acne it exists to fix.
    expect(s.light.shadow.normalBias).toBeGreaterThan(0);
    expect(s.light.shadow.normalBias).toBeLessThanOrEqual(3 * texel);
  });

  /**
   * `shadow.bias` is in normalized shadow-map depth units, so its physical size
   * is the fraction times the camera's depth range — which is why it cannot be
   * judged as a bare number either. Converted to metres it buys a constant
   * depth offset, and the same reasoning as `normalBias` applies: more than a
   * few texels' worth and the shadow lifts visibly off its caster's contact
   * point (peter-panning). Negative is the sign that pushes the comparison
   * depth away from the light.
   */
  it('spends the constant depth bias on centimetres of world depth, not metres', () => {
    const s = rig();
    const cam = s.light.shadow.camera;
    const worldDepth = Math.abs(s.light.shadow.bias) * (cam.far - cam.near);
    expect(s.light.shadow.bias).toBeLessThan(0);
    expect(worldDepth).toBeLessThanOrEqual(3 * groundTexel(s));
  });
});
