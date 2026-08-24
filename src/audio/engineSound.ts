/**
 * Engine layer: a quiet, cozy hum — never racey.
 *
 * Brown noise through a heavy lowpass gives the body ("road rumble"), a low
 * sawtooth + sine pair gives a faint motor tone. Pitch and loudness scale
 * subtly with speed (idle ~55 Hz rising toward ~110 Hz). While drifting, a
 * faint bandpassed white-noise "shhh" tire layer fades in.
 */

import { clamp, loopingNoise } from './helpers';

export interface EngineLayer {
  /** Cheap per-frame update — only touches params when values actually move. */
  update(speedMph: number, drifting: boolean): void;
}

export function createEngineLayer(
  ctx: BaseAudioContext,
  out: AudioNode,
  buffers: { brown: AudioBuffer; white: AudioBuffer }
): EngineLayer {
  // --- rumble bed: brown noise -> heavy lowpass ----------------------------
  const bed = loopingNoise(ctx, buffers.brown, out);
  bed.filter.type = 'lowpass';
  bed.filter.frequency.value = 140;
  bed.filter.Q.value = 0.4;
  bed.gain.gain.value = 0.02;

  // --- motor tone: low saw + sine through a lowpass ------------------------
  const toneFilter = ctx.createBiquadFilter();
  toneFilter.type = 'lowpass';
  toneFilter.frequency.value = 220;
  toneFilter.Q.value = 0.5;
  const toneGain = ctx.createGain();
  toneGain.gain.value = 0.012;
  toneFilter.connect(toneGain);
  toneGain.connect(out);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = 55;
  const sawGain = ctx.createGain();
  sawGain.gain.value = 0.55;
  saw.connect(sawGain);
  sawGain.connect(toneFilter);
  saw.start();

  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 55;
  const subGain = ctx.createGain();
  subGain.gain.value = 1;
  sub.connect(subGain);
  subGain.connect(toneFilter);
  sub.start();

  // Very slow wobble on the motor pitch so the hum breathes a little.
  const wobble = ctx.createOscillator();
  wobble.type = 'sine';
  wobble.frequency.value = 0.11;
  const wobbleDepth = ctx.createGain();
  wobbleDepth.gain.value = 1.2; // Hz
  wobble.connect(wobbleDepth);
  wobbleDepth.connect(saw.frequency);
  wobbleDepth.connect(sub.frequency);
  wobble.start();

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
        const f = 55 + 55 * t;
        saw.frequency.setTargetAtTime(f, now, 0.35);
        sub.frequency.setTargetAtTime(f, now, 0.35);
        toneGain.gain.setTargetAtTime(0.008 + 0.014 * t, now, 0.5);
        toneFilter.frequency.setTargetAtTime(180 + 160 * t, now, 0.5);
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
