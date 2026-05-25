import { describe, it, expect } from 'vitest';
import { densifyByFraction, updateWaypointAt, moveEndpointRigid, collapseWaypoint } from './cableWaypoints';

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

describe('collapseWaypoint', () => {
  // длинная трасса: 6 вершин, видимые ручки = концы 0 и 5 (середина прорежена).
  const long: [number, number][] = [
    [40, 68], [40.002, 68], [40.004, 68], [40.006, 68], [40.008, 68], [40.01, 68],
  ];

  it('shortens the cable when dragging end A (drops hidden vertices, no rigid shift)', () => {
    // конец A (prevH=null, nextH=следующая видимая ручка = 5).
    const out = collapseWaypoint(long, null, 5, 40.005, 68);
    expect(out[0]).toEqual([40.005, 68]); // A встал куда перетащили
    expect(out[out.length - 1]).toEqual([40.01, 68]); // B на месте
    expect(out).toHaveLength(2); // спрятанные вершины между A и B схлопнулись
  });

  it('keeps the far end fixed when dragging end B', () => {
    const out = collapseWaypoint(long, 0, null, 40.003, 68);
    expect(out[0]).toEqual([40, 68]); // A на месте
    expect(out[out.length - 1]).toEqual([40.003, 68]); // B перетащен
    expect(out).toHaveLength(2);
  });

  it('mid handle collapses only its own span, keeps the rest', () => {
    // видимые ручки 0,2,5; тащим ручку idx=2 (prevH=0, nextH=5) вбок.
    const out = collapseWaypoint(long, 0, 5, 40.004, 68.005);
    expect(out[0]).toEqual([40, 68]);
    expect(out).toContainEqual([40.004, 68.005]);
    expect(out[out.length - 1]).toEqual([40.01, 68]);
    // span 1..4 схлопнут в одну точку → 0 + точка + 5 = 3 вершины.
    expect(out).toHaveLength(3);
  });

  it('behaves like a plain vertex move when handles are consecutive', () => {
    const pts: [number, number][] = [[40, 68], [40.005, 68], [40.01, 68]];
    const out = collapseWaypoint(pts, 0, 2, 40.005, 68.003);
    expect(out).toEqual([[40, 68], [40.005, 68.003], [40.01, 68]]);
  });
});
