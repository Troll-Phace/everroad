import { describe, it, expect, afterEach, vi } from 'vitest';
import { createNoiseBuffer, pick, rand, type NoiseKind, type RandomFn } from './helpers';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A generator that hands back a fixed script of draws, then repeats the last. */
function scripted(...values: number[]): RandomFn {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

/** Constant generator plus a call counter, for "who consumes the randomness". */
function constant(value: number): RandomFn & { calls: number } {
  const fn = (() => {
    fn.calls += 1;
    return value;
  }) as RandomFn & { calls: number };
  fn.calls = 0;
  return fn;
}

/** Seeded LCG — the deterministic stand-in for Math.random the rules ask for. */
function lcg(seed: number): RandomFn {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * The smallest thing createNoiseBuffer can work against: a sample rate and a
 * createBuffer that hands back Float32 channel data. Mocking the real Web Audio
 * graph costs more than it returns (rules/testing.md), and the noise math is
 * the only part of this function worth pinning.
 */
class FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new RangeError(`no channel ${channel}`);
    return data;
  }
}

function fakeCtx(sampleRate = 1000): BaseAudioContext {
  return {
    sampleRate,
    createBuffer: (channels: number, length: number, rate: number) =>
      new FakeAudioBuffer(channels, length, rate),
  } as unknown as BaseAudioContext;
}

const KINDS: NoiseKind[] = ['white', 'pink', 'brown'];

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// rand
// ---------------------------------------------------------------------------

describe('rand', () => {
  it('returns the low bound when the generator yields 0', () => {
    expect(rand(2, 10, () => 0)).toBe(2);
  });

  it('maps the middle of the generator range to the middle of the interval', () => {
    expect(rand(2, 10, () => 0.5)).toBe(6);
    expect(rand(2, 10, () => 0.25)).toBe(4);
  });

  it('stays strictly below the high bound at the top of the generator range', () => {
    // The generator is [0, 1), so the interval is [a, b) — b itself is never hit.
    const top = rand(2, 10, () => 0.9999999999);
    expect(top).toBeLessThan(10);
    expect(top).toBeCloseTo(10, 8);
  });

  it('handles a descending range and a zero-width one', () => {
    expect(rand(10, 2, () => 0.25)).toBe(8);
    expect(rand(5, 5, () => 0.75)).toBe(5);
  });

  it('draws exactly once per call', () => {
    const gen = constant(0.5);
    rand(0, 1, gen);
    rand(0, 1, gen);
    expect(gen.calls).toBe(2);
  });

  it('defaults to Math.random when no generator is injected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    expect(rand(0, 8)).toBe(2);
    expect(Math.random).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// pick
// ---------------------------------------------------------------------------

describe('pick', () => {
  const four = ['a', 'b', 'c', 'd'] as const;

  it('returns the first element at 0 and the last just below 1', () => {
    expect(pick(four, () => 0)).toBe('a');
    expect(pick(four, () => 0.999)).toBe('d');
  });

  it('splits the generator range into equal buckets, on the low edge of each', () => {
    expect(pick(four, () => 0.2499)).toBe('a');
    expect(pick(four, () => 0.25)).toBe('b');
    expect(pick(four, () => 0.5)).toBe('c');
    expect(pick(four, () => 0.7499)).toBe('c');
    expect(pick(four, () => 0.75)).toBe('d');
  });

  it('always returns the only element of a one-item array', () => {
    for (const draw of [0, 0.5, 0.999]) expect(pick(['only'], () => draw)).toBe('only');
  });

  it('stays inside the array across a seeded run', () => {
    const random = lcg(1234);
    for (let i = 0; i < 500; i++) expect(four).toContain(pick(four, random));
  });

  it('walks a scripted generator element by element', () => {
    const random = scripted(0, 0.3, 0.6, 0.99);
    expect([
      pick(four, random),
      pick(four, random),
      pick(four, random),
      pick(four, random),
    ]).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns undefined for an empty array — the contract is a non-empty one', () => {
    expect(pick([], () => 0)).toBeUndefined();
  });

  it('defaults to Math.random when no generator is injected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(pick(four)).toBe('c');
    expect(Math.random).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// createNoiseBuffer
// ---------------------------------------------------------------------------

describe('createNoiseBuffer', () => {
  it('builds a mono buffer of sampleRate x seconds frames at the context rate', () => {
    const buf = createNoiseBuffer(fakeCtx(1000), 'white', 0.25, () => 0.5);
    expect(buf.numberOfChannels).toBe(1);
    expect(buf.length).toBe(250);
    expect(buf.sampleRate).toBe(1000);
    expect(buf.getChannelData(0)).toHaveLength(250);
  });

  it('floors a fractional frame count and never builds an empty buffer', () => {
    // A zero- or negative-length buffer is what Web Audio throws on, so the
    // floor is clamped to a single frame.
    expect(createNoiseBuffer(fakeCtx(1000), 'white', 0.2505, () => 0.5).length).toBe(250);
    expect(createNoiseBuffer(fakeCtx(1000), 'white', 0, () => 0.5).length).toBe(1);
    expect(createNoiseBuffer(fakeCtx(1000), 'white', -5, () => 0.5).length).toBe(1);
  });

  it.each(KINDS)('draws exactly one %s sample per frame from the injected generator', (kind) => {
    const gen = constant(0.5);
    const buf = createNoiseBuffer(fakeCtx(1000), kind, 0.05, gen);
    expect(buf.length).toBe(50);
    expect(gen.calls).toBe(50);
  });

  it.each(KINDS)('emits silence for %s when every draw sits at the midpoint', (kind) => {
    // Every kind maps a draw through (r * 2 - 1), so a constant 0.5 is a zero
    // excitation and each filter settles at exactly 0.
    const data = createNoiseBuffer(fakeCtx(1000), kind, 0.02, () => 0.5).getChannelData(0);
    expect([...data]).toEqual(new Array(20).fill(0));
  });

  it('maps a constant draw straight through for white noise', () => {
    const data = createNoiseBuffer(fakeCtx(1000), 'white', 0.01, () => 0.75).getChannelData(0);
    expect([...data]).toEqual(new Array(10).fill(0.5));
    const low = createNoiseBuffer(fakeCtx(1000), 'white', 0.01, () => 0).getChannelData(0);
    expect([...low]).toEqual(new Array(10).fill(-1));
  });

  it('integrates brown noise toward its ceiling instead of jumping to it', () => {
    // last = (last + 0.02w) / 1.02, scaled x3.5: a step response, not a copy.
    const data = createNoiseBuffer(fakeCtx(1000), 'brown', 0.02, () => 1).getChannelData(0);
    expect(data[0]).toBeCloseTo((0.02 / 1.02) * 3.5, 6);
    for (let i = 1; i < data.length; i++) expect(data[i]).toBeGreaterThan(data[i - 1]!);
    expect(data[data.length - 1]!).toBeLessThan(3.5);
  });

  it('sums the three Kellet poles for pink noise', () => {
    const data = createNoiseBuffer(fakeCtx(1000), 'pink', 0.01, () => 1).getChannelData(0);
    expect(data[0]).toBeCloseTo((0.099046 + 0.2965164 + 1.0526913 + 0.1848) * 0.28, 6);
    expect(data[1]!).toBeGreaterThan(data[0]!);
  });

  it.each(KINDS)('is reproducible for %s: one seed, one buffer', (kind) => {
    const a = createNoiseBuffer(fakeCtx(1000), kind, 0.1, lcg(99));
    const b = createNoiseBuffer(fakeCtx(1000), kind, 0.1, lcg(99));
    const c = createNoiseBuffer(fakeCtx(1000), kind, 0.1, lcg(100));
    expect([...a.getChannelData(0)]).toEqual([...b.getChannelData(0)]);
    expect([...a.getChannelData(0)]).not.toEqual([...c.getChannelData(0)]);
  });

  it('keeps a seeded white buffer inside the [-1, 1) sample range', () => {
    const data = createNoiseBuffer(fakeCtx(1000), 'white', 1, lcg(7)).getChannelData(0);
    for (const sample of data) {
      expect(sample).toBeGreaterThanOrEqual(-1);
      expect(sample).toBeLessThan(1);
    }
  });

  it('defaults to Math.random when no generator is injected', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const data = createNoiseBuffer(fakeCtx(1000), 'white', 0.01).getChannelData(0);
    expect(Math.random).toHaveBeenCalledTimes(10);
    expect([...data]).toEqual(new Array(10).fill(0.5));
  });
});
