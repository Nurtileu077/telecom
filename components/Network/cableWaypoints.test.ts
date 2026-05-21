import { describe, it, expect } from 'vitest';
import { densifyByFraction, updateWaypointAt } from './cableWaypoints';

describe('cableWaypoints', () => {
  const ab: [number, number][] = [[40, 68], [40.01, 68.01]];

  it('densifyByFraction only on 2-point line', () => {
    const d = densifyByFraction(ab, 0.25);
    expect(d.length).toBe(5);
  });

  it('does not densify OSRM polyline with many points', () => {
    const many = [...ab, [40.005, 68.005], [40.008, 68.008]];
    expect(densifyByFraction(many).length).toBe(4);
  });

  it('updateWaypointAt moves point without extra vertices', () => {
    const d = densifyByFraction(ab, 0.25);
    const out = updateWaypointAt(d, 2, 40.005, 68.005);
    expect(out.length).toBe(d.length);
    expect(out[2][0]).toBeCloseTo(40.005, 4);
  });
});
