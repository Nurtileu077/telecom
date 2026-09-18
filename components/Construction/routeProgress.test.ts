import { describe, it, expect } from 'vitest';
import {
  pointAtDistanceM, routeLengthM, advanceAlong, routeForSection,
} from './routeProgress';
import type { PlanRoute } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';

/** Прямая линия по долготе: удобно считать в уме. */
const line: [number, number][] = [[51, 71], [51, 71.01], [51, 71.02]];

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Трасса', coords: line, lengthM: routeLengthM(line),
    source: 'тест', createdAt: now, updatedAt: now, ...over,
  };
}

describe('длина трассы', () => {
  it('складывается по отрезкам', () => {
    const total = routeLengthM(line);
    const half = routeLengthM([[51, 71], [51, 71.01]]);
    expect(total).toBeCloseTo(half * 2, 0);
  });

  it('одна точка — нулевая длина', () => {
    expect(routeLengthM([[51, 71]])).toBe(0);
  });
});

describe('точка на трассе', () => {
  it('ноль метров — начало линии', () => {
    const p = pointAtDistanceM(line, 0)!;
    expect(p.lat).toBe(51);
    expect(p.lon).toBe(71);
    expect(p.atEnd).toBe(false);
  });

  it('половина длины — середина', () => {
    const half = routeLengthM(line) / 2;
    const p = pointAtDistanceM(line, half)!;
    expect(p.lon).toBeCloseTo(71.01, 4);
  });

  it('больше длины — конец, а не за линией', () => {
    const p = pointAtDistanceM(line, 999999)!;
    expect(p.lon).toBeCloseTo(71.02, 6);
    expect(p.atEnd).toBe(true);
  });

  it('отрицательное расстояние — начало', () => {
    const p = pointAtDistanceM(line, -500)!;
    expect(p.lon).toBe(71);
  });

  it('пустая линия точки не даёт', () => {
    expect(pointAtDistanceM([], 100)).toBeNull();
  });

  it('линия из одной точки — она и есть', () => {
    const p = pointAtDistanceM([[51, 71]], 100)!;
    expect(p.atEnd).toBe(true);
    expect(p.lat).toBe(51);
  });
});

describe('продвижение за день', () => {
  it('считается от уже пройденного, а не с начала', () => {
    const total = routeLengthM(line);
    const a = advanceAlong(route(), total / 4, total / 4)!;
    const b = pointAtDistanceM(line, total / 2)!;
    expect(a.lon).toBeCloseTo(b.lon, 6);
  });

  it('дошли до конца — дальше не уезжаем', () => {
    const p = advanceAlong(route(), 100000, 50000)!;
    expect(p.atEnd).toBe(true);
    expect(p.lon).toBeCloseTo(71.02, 6);
  });

  it('нулевой день оставляет на месте', () => {
    const total = routeLengthM(line);
    const p = advanceAlong(route(), total / 2, 0)!;
    expect(p.lon).toBeCloseTo(71.01, 4);
  });
});

describe('какая трасса у участка', () => {
  it('из нескольких берём самую длинную — короткие это заезды', () => {
    const short = route({ id: 'short', lengthM: 400 });
    const long = route({ id: 'long', lengthM: 12000 });
    const hit = routeForSection([short, long], () => true);
    expect(hit?.id).toBe('long');
  });

  it('ничего не подошло — ничего и не возвращаем', () => {
    expect(routeForSection([route()], () => false)).toBeNull();
  });
});
