import { describe, it, expect } from 'vitest';
import { formatNumber, formatDuration } from './types';

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
