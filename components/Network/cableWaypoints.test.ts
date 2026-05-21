import { describe, it, expect } from 'vitest';
import { densifyByFraction, pointAtFraction, insertSmoothPointsNearIndex } from './cableWaypoints';

describe('cableWaypoints', () => {
  const ab: [number, number][] = [[40, 68], [40.01, 68.01]];

  it('densifyByFraction adds 25% marks on A-B line', () => {
    const d = densifyByFraction(ab, 0.25);
    expect(d.length).toBeGreaterThanOrEqual(5);
    expect(d[0][0]).toBeCloseTo(40, 4);
    expect(d[d.length - 1][0]).toBeCloseTo(40.01, 4);
  });

  it('pointAtFraction mid is between ends', () => {
    const m = pointAtFraction(ab, 0.5);
    expect(m[0]).toBeGreaterThan(40);
    expect(m[0]).toBeLessThan(40.01);
  });

  it('insertSmoothPointsNearIndex adds points on long segment', () => {
    const long: [number, number][] = [[40, 68], [40.05, 68.05]];
    const dense = densifyByFraction(long, 0.25);
    const mid = Math.floor(dense.length / 2);
    const out = insertSmoothPointsNearIndex(dense, mid);
    expect(out.length).toBeGreaterThan(dense.length);
  });
});
