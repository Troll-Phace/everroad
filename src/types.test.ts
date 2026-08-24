import { describe, it, expect } from 'vitest';
import { formatNumber, formatMiles, formatDuration } from './types';

describe('formatNumber', () => {
  it('shows whole coins below a thousand', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
  });

  it('keeps one decimal for small fractional values', () => {
    expect(formatNumber(4.25)).toBe('4.3');
  });

  it('compacts at each unit boundary', () => {
    expect(formatNumber(1000)).toBe('1.0K');
    expect(formatNumber(1_500_000)).toBe('1.5M');
    expect(formatNumber(2_000_000_000)).toBe('2.0B');
  });

  it('drops the decimal once the mantissa reaches three digits', () => {
    expect(formatNumber(150_000)).toBe('150K');
  });

  it('renders a non-finite total as infinity rather than NaN', () => {
    expect(formatNumber(Infinity)).toBe('∞');
  });

  it('promotes to the next unit when rounding would show a four-digit mantissa', () => {
    expect(formatNumber(999_949)).toBe('1.0M');
    expect(formatNumber(999_950)).toBe('1.0M');
    expect(formatNumber(999_999)).toBe('1.0M');
    expect(formatNumber(999_499)).toBe('999K');
  });

  it('crosses every suffix boundary cleanly', () => {
    expect(formatNumber(1e6)).toBe('1.0M');
    expect(formatNumber(1e9)).toBe('1.0B');
    expect(formatNumber(1e12)).toBe('1.0T');
    expect(formatNumber(1e15)).toBe('1.0Qa');
    expect(formatNumber(1e18)).toBe('1.0Qi');
    expect(formatNumber(1e21)).toBe('1.0Sx');
    expect(formatNumber(1e24)).toBe('1.0Sp');
  });

  it('falls back to exponent form past the last suffix', () => {
    expect(formatNumber(1e27)).toBe('1.0e27');
    expect(formatNumber(2.5e30)).toBe('2.5e30');
  });
});

describe('formatMiles', () => {
  it('keeps exact tenths below ten thousand miles', () => {
    expect(formatMiles(0)).toBe('0.0');
    expect(formatMiles(9999.94)).toBe('9999.9');
  });

  it('compacts once the odometer reaches ten thousand miles', () => {
    expect(formatMiles(10_000)).toBe('10.0K');
    expect(formatMiles(1_500_000)).toBe('1.5M');
  });
});

describe('formatDuration', () => {
  it('reports seconds under a minute', () => {
    expect(formatDuration(45)).toBe('45s');
  });

  it('steps up through minutes, hours, and days', () => {
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(8040)).toBe('2h 14m');
    expect(formatDuration(273_600)).toBe('3d 4h');
  });

  it('floors a negative offline gap to zero', () => {
    expect(formatDuration(-10)).toBe('0s');
  });
});
