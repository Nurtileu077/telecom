import { describe, it, expect } from 'vitest';
import { densifyByFraction, updateWaypointAt, moveEndpointRigid } from './cableWaypoints';

describe('cableWaypoints', () => {
  const ab: [number, number][] = [[40, 68], [40.01, 68.01]];

  it('densifyByFraction only on 2-point line', () => {
    const d = densifyByFraction(ab, 0.25);
    expect(d.length).toBe(5);
  });

  it('does not densify OSRM polyline with many points', () => {
    const many: [number, number][] = [...ab, [40.005, 68.005], [40.008, 68.008]];
    expect(densifyByFraction(many).length).toBe(4);
  });

  it('updateWaypointAt moves point without extra vertices', () => {
    const d = densifyByFraction(ab, 0.25);
    const out = updateWaypointAt(d, 2, 40.005, 68.005);
    expect(out.length).toBe(d.length);
    expect(out[2][0]).toBeCloseTo(40.005, 4);
  });

  it('moveEndpointRigid shifts all points when dragging A', () => {
    const pts: [number, number][] = [[40, 68], [40.005, 68.005], [40.01, 68.01]];
    const out = moveEndpointRigid(pts, 0, 40.001, 68.001);
    expect(out[0]).toEqual([40.001, 68.001]);
    expect(out[1][0]).toBeCloseTo(40.006, 4);
    expect(out[2][0]).toBeCloseTo(40.011, 4);
  });

  it('moveEndpointRigid shifts all points when dragging B', () => {
    const pts: [number, number][] = [[40, 68], [40.005, 68.005], [40.01, 68.01]];
    const out = moveEndpointRigid(pts, 2, 40.02, 68.02);
    expect(out[2]).toEqual([40.02, 68.02]);
    expect(out[0][0]).toBeCloseTo(40.01, 4);
  });
});
