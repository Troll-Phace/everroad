/**
 * Engine layer: a quiet, non-tonal bed — never racey.
 *
 * Brown noise through a heavy lowpass gives the body ("road rumble") that
 * swells subtly with speed. There is deliberately NO pitched motor tone —
 * a hum that rises with speed proved annoying on long cruises. While
 * drifting, a faint bandpassed white-noise "shhh" tire layer fades in.
 */

import { clamp, loopingNoise } from './helpers';

export interface EngineLayer {
  /** Cheap per-frame update — only touches params when values actually move. */
  update(speedMph: number, drifting: boolean): void;
}

export function createEngineLayer(
  ctx: BaseAudioContext,
  out: AudioNode,
  buffers: { brown: AudioBuffer; white: AudioBuffer },
): EngineLayer {
  // --- rumble bed: brown noise -> heavy lowpass ----------------------------
  const bed = loopingNoise(ctx, buffers.brown, out);
  bed.filter.type = 'lowpass';
  bed.filter.frequency.value = 140;
  bed.filter.Q.value = 0.4;
  bed.gain.gain.value = 0.02;

  // --- drift tires: white noise "shhh" -------------------------------------
  const drift = loopingNoise(ctx, buffers.white, out);
  drift.filter.type = 'bandpass';
  drift.filter.frequency.value = 1700;
  drift.filter.Q.value = 0.8;
  drift.gain.gain.value = 0;

  let lastSpeed = -1;
  let lastDrift = false;

  return {
    update(speedMph: number, drifting: boolean): void {
      const now = ctx.currentTime;
      if (Math.abs(speedMph - lastSpeed) > 0.4) {
        lastSpeed = speedMph;
        const t = clamp(speedMph / 120, 0, 1);
        bed.gain.gain.setTargetAtTime(0.015 + 0.03 * t, now, 0.5);
        bed.filter.frequency.setTargetAtTime(120 + 220 * t, now, 0.5);
      }
      if (drifting !== lastDrift) {
        lastDrift = drifting;
        // Quick-ish in, gentle out.
        drift.gain.gain.setTargetAtTime(drifting ? 0.035 : 0, now, drifting ? 0.12 : 0.35);
      }
    },
  };
}
