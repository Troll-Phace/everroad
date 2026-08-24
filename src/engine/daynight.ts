import * as THREE from 'three';
import type { TimePhase } from '../types';

/**
 * Day/night cycle. timeOfDay runs 0..1; phases have hand-tuned spans so the
 * golden hours feel long and night doesn't overstay its welcome.
 *
 *   dawn   [0.00, 0.11)   ~60s
 *   day    [0.11, 0.55)   ~240s
 *   sunset [0.55, 0.72)   ~92s
 *   night  [0.72, 1.00)   ~152s
 */
const CYCLE_SEC = 545;

const SPANS: Array<{ phase: TimePhase; start: number; end: number }> = [
  { phase: 'dawn', start: 0.0, end: 0.11 },
  { phase: 'day', start: 0.11, end: 0.55 },
  { phase: 'sunset', start: 0.55, end: 0.72 },
  { phase: 'night', start: 0.72, end: 1.0 },
];

export interface SunSnapshot {
  phase: TimePhase;
  /** 0..1 progress within the current phase. */
  phaseT: number;
  /** Sun elevation in radians (negative = below horizon). */
  elevation: number;
  /** Sun azimuth in radians (slowly precesses so sunsets land in new places). */
  azimuth: number;
  /** Unit direction TO the sun. */
  sunDir: THREE.Vector3;
  /** 0..1 how "golden" the light is (peaks at sunset/dawn). */
  golden: number;
  /** 0..1 darkness of night (1 = deep night). */
  nightness: number;
}

export class DayNight {
  timeOfDay = 0.2; // start at dawn's end -> morning
  private azimuthBase = Math.PI * 0.35;
  readonly snap: SunSnapshot = {
    phase: 'day',
    phaseT: 0,
    elevation: 0.5,
    azimuth: 0,
    sunDir: new THREE.Vector3(0, 1, 0),
    golden: 0,
    nightness: 0,
  };

  constructor(startTime = 0.2) {
    this.timeOfDay = startTime;
  }

  /**
   * Re-seed the clock without rebuilding the cycle. Attract mode draws a fresh
   * (flattering) hour every time the menu is entered — see main.ts.
   */
  setTimeOfDay(t: number): void {
    this.timeOfDay = ((t % 1) + 1) % 1;
  }

  update(dt: number): SunSnapshot {
    this.timeOfDay = (this.timeOfDay + dt / CYCLE_SEC) % 1;
    // Azimuth precesses a full turn every ~7 cycles so scenery lighting varies.
    this.azimuthBase += (dt / CYCLE_SEC) * Math.PI * 0.29;

    const t = this.timeOfDay;
    const span = SPANS.find((s) => t >= s.start && t < s.end) ?? SPANS[0];
    const phaseT = (t - span.start) / (span.end - span.start);
    const s = this.snap;
    s.phase = span.phase;
    s.phaseT = phaseT;

    // Elevation: continuous over the cycle. Sun rises through dawn, arcs in day,
    // sinks through sunset, stays below horizon at night.
    switch (span.phase) {
      case 'dawn':
        s.elevation = THREE.MathUtils.lerp(-0.12, 0.18, easeInOut(phaseT));
        break;
      case 'day':
        s.elevation = 0.18 + Math.sin(phaseT * Math.PI) * 0.72;
        break;
      case 'sunset':
        s.elevation = THREE.MathUtils.lerp(0.18, -0.14, easeInOut(phaseT));
        break;
      case 'night':
        s.elevation = -0.14 - Math.sin(phaseT * Math.PI) * 0.5;
        break;
    }

    // Sun sweeps ~140 degrees of azimuth across the daylight portion.
    const dayFrac = daylightProgress(t);
    s.azimuth = this.azimuthBase + THREE.MathUtils.lerp(-1.2, 1.2, dayFrac);

    s.sunDir
      .set(
        Math.cos(s.elevation) * Math.sin(s.azimuth),
        Math.sin(s.elevation),
        Math.cos(s.elevation) * Math.cos(s.azimuth),
      )
      .normalize();

    // Golden factor peaks when the sun is just above the horizon.
    const el = s.elevation;
    s.golden = THREE.MathUtils.clamp(1 - Math.abs(el - 0.05) / 0.22, 0, 1);
    s.nightness = THREE.MathUtils.clamp(-el / 0.35, 0, 1);
    return s;
  }
}

function easeInOut(x: number): number {
  return x * x * (3 - 2 * x);
}

/** 0 at dawn start -> 1 at sunset end, clamped/frozen at night. */
function daylightProgress(t: number): number {
  const start = 0.0;
  const end = 0.72;
  if (t >= start && t <= end) return (t - start) / (end - start);
  return t > end ? 1 : 0;
}
