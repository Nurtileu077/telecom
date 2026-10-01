import { describe, it, expect } from 'vitest';
import type { PlanRoute } from '@/types/construction';
import { measureShift, describeShiftMeasure, polylineM, SHIFT_SNAP_M } from './shiftMeasure';

/** Градусы на километр под Кокшетау: по широте и по долготе они разные. */
const KM_LAT = 1 / 111.195;
const KM_LON = KM_LAT / Math.cos((53 * Math.PI) / 180);

/** Трасса углом: километр на восток, потом километр на север. */
const ELBOW: [number, number][] = [
  [53, 69],
  [53, 69 + KM_LON],
  [53 + KM_LAT, 69 + KM_LON],
];

const route = (id: string, coords: [number, number][], name = id): PlanRoute => ({
  id, name, coords, lengthM: 0, source: 'test.kml', createdAt: '', updatedAt: '',
});

const at = (c: [number, number]) => ({ lat: c[0], lon: c[1] });

describe('measureShift', () => {
  it('на повороте под прямым углом берёт путь по трассе, а не прямую', () => {
    const r = measureShift([at(ELBOW[0]), at(ELBOW[2])], [route('a', ELBOW)])!;
    expect(r.mode).toBe('route');
    expect(r.meters).toBeGreaterThan(1990);
    expect(r.meters).toBeLessThan(2010);
    // Прямая на тех же двух кликах короче на 29 % — ровно то, что
    // раньше уходило в смену.
    expect(r.pointsM).toBeGreaterThan(1405);
    expect(r.pointsM).toBeLessThan(1425);
  });

  it('клик пальцем мимо линии всё равно прилипает к трассе', () => {
    const off = 30 * KM_LAT / 1000;
    const r = measureShift(
      [{ lat: 53 + off, lon: 69 }, { lat: 53 + KM_LAT, lon: 69 + KM_LON + off * 1.6 }],
      [route('a', ELBOW)],
    )!;
    expect(r.mode).toBe('route');
    expect(r.route!.missM).toBeGreaterThan(20);
    expect(r.route!.missM).toBeLessThan(SHIFT_SNAP_M);
    expect(r.meters).toBeGreaterThan(1990);
  });

  it('точки в поле без трассы считаются по прямой и называют причину', () => {
    const far = 2 * KM_LAT;
    const r = measureShift(
      [{ lat: 53 - far, lon: 69 }, { lat: 53 - far, lon: 69 + KM_LON }],
      [route('a', ELBOW)],
    )!;
    expect(r.mode).toBe('points');
    expect(r.route).toBeUndefined();
    expect(r.meters).toBeCloseTo(r.pointsM, 6);
    expect(r.why).toContain('не легли');
  });

  it('если одна точка на трассе, а другая в поле, — это не замер по трассе', () => {
    const r = measureShift(
      [at(ELBOW[0]), { lat: 53 - 2 * KM_LAT, lon: 69 }],
      [route('a', ELBOW)],
    )!;
    expect(r.mode).toBe('points');
  });

  it('без трасс на карте так и пишет', () => {
    const r = measureShift([at(ELBOW[0]), at(ELBOW[2])], [])!;
    expect(r.mode).toBe('points');
    expect(r.why).toBe('трасс на карте нет');
  });

  it('трасса участка важнее соседней, даже если соседняя ближе к кликам', () => {
    const shift = 60 * KM_LAT / 1000;
    const main = route('main', [[53, 69], [53, 69 + KM_LON]]);
    const branch = route('branch', [[53 + shift, 69], [53 + shift, 69 + KM_LON]]);
    // Клики почти на отводе, но в пределах допуска и от основной.
    const clicks = [{ lat: 53 + shift * 0.9, lon: 69 }, { lat: 53 + shift * 0.9, lon: 69 + KM_LON / 2 }];
    expect(measureShift(clicks, [main, branch])!.route!.id).toBe('branch');
    expect(measureShift(clicks, [main, branch], { preferRouteId: 'main' })!.route!.id).toBe('main');
  });

  it('промежуточная точка на той же трассе не меняет длину', () => {
    const two = measureShift([at(ELBOW[0]), at(ELBOW[2])], [route('a', ELBOW)])!;
    const three = measureShift([at(ELBOW[0]), at(ELBOW[1]), at(ELBOW[2])], [route('a', ELBOW)])!;
    expect(three.meters).toBeCloseTo(two.meters, 3);
  });

  it('ломаная из нескольких точек вне трассы складывает звенья, а не берёт прямую', () => {
    const far = 3 * KM_LAT;
    const pts = [
      { lat: 53 - far, lon: 69 },
      { lat: 53 - far, lon: 69 + KM_LON },
      { lat: 53 - far + KM_LAT, lon: 69 + KM_LON },
    ];
    const r = measureShift(pts, [route('a', ELBOW)])!;
    expect(r.mode).toBe('points');
    expect(r.meters).toBeGreaterThan(1990);
    expect(r.meters).toBeCloseTo(polylineM(pts), 6);
  });

  it('порядок кликов не важен', () => {
    const a = { lat: 53, lon: 69 + KM_LON * 0.2 };
    const b = { lat: 53 + KM_LAT * 0.7, lon: 69 + KM_LON };
    const there = measureShift([a, b], [route('a', ELBOW)])!;
    const back = measureShift([b, a], [route('a', ELBOW)])!;
    expect(back.meters).toBeCloseTo(there.meters, 6);
  });

  it('одна точка — ещё не замер', () => {
    expect(measureShift([at(ELBOW[0])], [route('a', ELBOW)])).toBeNull();
  });
});

describe('describeShiftMeasure', () => {
  it('называет трассу и показывает, сколько дала бы прямая', () => {
    const r = measureShift([at(ELBOW[0]), at(ELBOW[2])], [route('a', ELBOW, 'Шортанды — Камышенка')])!;
    const text = describeShiftMeasure(r);
    expect(text).toContain('по трассе «Шортанды — Камышенка»');
    expect(text).toMatch(/напрямую было бы 1 41\d м/);
  });

  it('вне трассы говорит, что посчитано по прямой и почему', () => {
    const r = measureShift([at(ELBOW[0]), at(ELBOW[2])], [])!;
    expect(describeShiftMeasure(r)).toBe('по прямой: трасс на карте нет');
  });

  it('если человек сам выбрал по точкам, подпись это признаёт', () => {
    const r = measureShift(
      [at(ELBOW[0]), at(ELBOW[1]), at(ELBOW[2])], [route('a', ELBOW)],
    )!;
    expect(describeShiftMeasure(r, 'points')).toBe('по ломаной из 3 точек — вы выбрали не по трассе');
  });
});
