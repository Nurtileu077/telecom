import { describe, it, expect } from 'vitest';
import type { Cable, CableType } from '@/types/network';
import { overlayCoRouted, densify, despike } from './Consolidation';
import { haversineM } from './KMeans';

// --- геометрические помощники для синтетических трасс ---
const REF_LAT = 43.0;
const M_LAT = 1 / 111320;
const mLon = (lat: number) => 1 / (111320 * Math.cos((lat * Math.PI) / 180));

function trunk(
  from: [number, number],
  to: [number, number],
  type: CableType,
  id: string,
): Cable {
  return {
    id,
    type,
    fibers: 12,
    fromId: `${id}-A`,
    toId: `${id}-B`,
    coords: [from, to],
    lengthM: haversineM(from[0], from[1], to[0], to[1]),
    routedByOSRM: true,
  };
}

// север-южная магистраль длиной L метров со сдвигом по долготе на offsetM метров.
function northSouth(lengthM: number, lonOffsetM: number, id: string, type: CableType = 'ОК-12'): Cable {
  const lon = 68.0 + lonOffsetM * mLon(REF_LAT);
  return trunk([REF_LAT, lon], [REF_LAT + lengthM * M_LAT, lon], type, id);
}

// сколько вершин полилинии B совпадают (в пределах epsM) с какой-либо вершиной A.
function coincidentCount(a: [number, number][], b: [number, number][], epsM = 1): number {
  let n = 0;
  for (const p of b) {
    if (a.some((q) => haversineM(p[0], p[1], q[0], q[1]) <= epsM)) n++;
  }
  return n;
}

// самый «острый разворот» на полилинии: минимальный косинус угла между
// соседними сегментами. Близко к -1 → трасса разворачивается назад (шип/треугольник).
function minTurnCos(coords: [number, number][]): number {
  const ky = 111320;
  let min = 1;
  for (let i = 1; i < coords.length - 1; i++) {
    const a = coords[i - 1], b = coords[i], c = coords[i + 1];
    const kx = Math.cos((b[0] * Math.PI) / 180) * 111320;
    const v1x = (b[1] - a[1]) * kx, v1y = (b[0] - a[0]) * ky;
    const v2x = (c[1] - b[1]) * kx, v2y = (c[0] - b[0]) * ky;
    const m1 = Math.hypot(v1x, v1y), m2 = Math.hypot(v2x, v2y);
    if (m1 === 0 || m2 === 0) continue;
    min = Math.min(min, (v1x * v2x + v1y * v2y) / (m1 * m2));
  }
  return min;
}

describe('densify', () => {
  it('inserts vertices along a 2-point line at the given step', () => {
    const a = northSouth(100, 0, 'd').coords;
    const out = densify(a, 10);
    // ~10 шагов по 10 м на 100 м линии + конец.
    expect(out.length).toBeGreaterThanOrEqual(10);
    expect(out[0]).toEqual(a[0]);
    expect(out[out.length - 1]).toEqual(a[1]);
  });

  it('returns input unchanged for <2 points', () => {
    expect(densify([[43, 68]], 10)).toHaveLength(1);
  });
});

describe('despike', () => {
  it('removes a vertex that reverses the path (triangle spike)', () => {
    // прямая на север со «шипом» назад в середине.
    const pts: [number, number][] = [
      [43.0, 68.0],
      [43.001, 68.0],
      [43.0005, 68.0], // шип: возврат назад
      [43.002, 68.0],
    ];
    const out = despike(pts);
    expect(minTurnCos(out)).toBeGreaterThan(-0.7);
    expect(out.length).toBeLessThan(pts.length);
  });

  it('keeps a normal 90° corner', () => {
    const pts: [number, number][] = [
      [43.0, 68.0],
      [43.001, 68.0],
      [43.001, 68.001],
    ];
    expect(despike(pts)).toHaveLength(3);
  });
});

describe('overlayCoRouted', () => {
  it('preserves exact endpoints of every cable', () => {
    const a = northSouth(300, 0, 'a');
    const b = northSouth(300, 12, 'b');
    const [oa, ob] = overlayCoRouted([a, b]);
    expect(oa.coords[0]).toEqual(a.coords[0]);
    expect(oa.coords[oa.coords.length - 1]).toEqual(a.coords[a.coords.length - 1]);
    expect(ob.coords[0]).toEqual(b.coords[0]);
    expect(ob.coords[ob.coords.length - 1]).toEqual(b.coords[b.coords.length - 1]);
  });

  it('merges two co-routed parallel trunks onto shared vertices', () => {
    const a = northSouth(300, 0, 'a');
    const b = northSouth(300, 12, 'b'); // сдвиг 12 м < радиус слияния 18 м
    // до слияния общих вершин нет.
    expect(coincidentCount(a.coords, b.coords)).toBe(0);
    const [oa, ob] = overlayCoRouted([a, b]);
    // после — тело трассы ложится на общие узлы.
    expect(coincidentCount(oa.coords, ob.coords)).toBeGreaterThanOrEqual(10);
  });

  it('does NOT introduce triangles/self-reversals (regression guard)', () => {
    const a = northSouth(300, 0, 'a');
    const b = northSouth(300, 12, 'b');
    for (const c of overlayCoRouted([a, b])) {
      expect(minTurnCos(c.coords)).toBeGreaterThan(-0.7);
    }
  });

  it('does NOT merge adjacent streets (≥40 m apart)', () => {
    const a = northSouth(300, 0, 'a');
    const b = northSouth(300, 45, 'b'); // соседняя улица: сдвиг 45 м > радиус 18 м
    const [oa, ob] = overlayCoRouted([a, b]);
    expect(coincidentCount(oa.coords, ob.coords)).toBe(0);
  });

  it('leaves ОК-4 drops untouched', () => {
    const drop = northSouth(40, 0, 'drop', 'ОК-4');
    const [out] = overlayCoRouted([drop]);
    expect(out.coords).toEqual(drop.coords);
    expect(out.lengthM).toBe(drop.lengthM);
  });

  it('protects near-equipment vertices from being pulled to a neighbour', () => {
    // короткая магистраль рядом с длинной: приконцевые вершины не должны
    // притягиваться к соседней нитке (корень прежней регрессии ОК-8 у боксов).
    const long = northSouth(300, 0, 'long');
    const b = northSouth(300, 12, 'b');
    const [, ob] = overlayCoRouted([long, b]);
    const bLon = b.coords[0][1];
    // первая вершина после старта B (в зоне EDGE_GUARD) остаётся на линии B,
    // а не сдвигается к долготе long.
    const near = ob.coords[1];
    const distFromB = haversineM(near[0], bLon, near[0], near[1]);
    expect(distFromB).toBeLessThan(3);
  });
});
