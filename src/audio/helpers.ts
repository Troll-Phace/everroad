/**
 * Shared low-level Web Audio helpers for the Everroad audio module.
 * No imports from outside src/audio/ except '../types'.
 */

/** Random float in [a, b). */
export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Random element of a non-empty array. */
export function pick<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0];
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToFreq(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * Smoothly move an AudioParam to `target`, reaching ~95% in `sec` seconds.
 * Cancels pending automation without a click (uses cancelAndHoldAtTime when
 * available), then uses an exponential-approach setTargetAtTime.
 */
export function rampTo(param: AudioParam, target: number, sec: number, now: number): void {
  const anyParam = param as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
  try {
    if (typeof anyParam.cancelAndHoldAtTime === 'function') {
      anyParam.cancelAndHoldAtTime(now);
    } else {
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
    }
  } catch {
    /* older implementations: fall through, setTargetAtTime still works */
  }
  param.setTargetAtTime(target, now, Math.max(0.01, sec / 3));
}

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Build a looping noise buffer (a couple seconds is plenty for a loop). */
export function createNoiseBuffer(ctx: BaseAudioContext, kind: NoiseKind, seconds = 2): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
  } else {
    // Pink noise via Paul Kellet's economy filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.28;
    }
  }
  return buf;
}

/** Start a looping BufferSource through a filter+gain; returns the gain node's input chain pieces. */
export function loopingNoise(
  ctx: BaseAudioContext,
  buffer: AudioBuffer,
  dest: AudioNode
): { src: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  // Offset the loop start randomly so multiple loops of the same buffer decorrelate.
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(0, Math.random() * buffer.duration * 0.5);
  return { src, filter, gain };
}
