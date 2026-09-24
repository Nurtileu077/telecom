import { describe, it, expect } from 'vitest';
import {
  routeSegments, sliceByDistance, segmentTotals, kksPoints, METHOD_COLOR,
} from './routeSegments';
import { routeLengthM } from './routeProgress';
import type { PlanRoute, DailyWorkEntry } from '@/types/construction';

const now = '2026-09-18T00:00:00.000Z';
/** Прямая линия на восток: по ней легко проверять расстояния. */
const line: [number, number][] = [[51, 71], [51, 71.05], [51, 71.1]];
const TOTAL = routeLengthM(line);

function route(over: Partial<PlanRoute> = {}): PlanRoute {
  return {
    id: 'r1', name: 'Еленовка Школа', uchastok: 'Еленовка',
    coords: line, lengthM: TOTAL,
    source: 'тест', createdAt: now, updatedAt: now, ...over,
  };
}

function day(date: string, byMethod: DailyWorkEntry['byMethod']): DailyWorkEntry {
  return {
    kind: 'ground', id: `g${date}${Math.random()}`, date, smu: '',
    oblast: 'Акмолинская область', uchastok: 'Еленовка', kato: '191',
    byMethod, materials: {},
    createdAt: now, updatedAt: now,
  };
}

describe('кусок ломаной', () => {
  it('начинается и заканчивается там, где просили', () => {
    const part = sliceByDistance(line, 0, TOTAL / 2);
    expect(part[0]).toEqual([51, 71]);
    expect(part[part.length - 1][1]).toBeCloseTo(71.05, 4);
  });

  it('сохраняет промежуточные вершины — иначе кусок спрямится', () => {
    const part = sliceByDistance(line, 0, TOTAL);
    expect(part.length).toBeGreaterThanOrEqual(3);
  });

  it('пустой кусок, когда конец не дальше начала', () => {
    expect(sliceByDistance(line, 100, 100)).toEqual([]);
    expect(sliceByDistance(line, 500, 100)).toEqual([]);
  });

  it('линия из одной точки куска не даёт', () => {
    expect(sliceByDistance([[51, 71]], 0, 100)).toEqual([]);
  });
});

describe('отрезки по способам', () => {
  it('дни ложатся вдоль линии по порядку', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'кабелеукладчик': 1000 }),
      day('2026-09-11', { 'бар': 500 }),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0].method).toBe('кабелеукладчик');
    expect(segs[0].fromM).toBe(0);
    expect(segs[0].toM).toBe(1000);
    expect(segs[1].method).toBe('бар');
    expect(segs[1].fromM).toBe(1000);
  });

  it('соседние дни одним способом склеиваются в один отрезок', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'кабелеукладчик': 800 }),
      day('2026-09-11', { 'кабелеукладчик': 700 }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].meters).toBe(1500);
    expect(segs[0].dates).toEqual(['2026-09-10', '2026-09-11']);
  });

  it('несколько способов за день делят дневной кусок', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'кабелеукладчик': 600, 'вручную': 400 }),
    ]);
    expect(segs.map((s) => s.method)).toEqual(['кабелеукладчик', 'вручную']);
    expect(segs[0].toM).toBe(600);
    expect(segs[1].fromM).toBe(600);
    expect(segs[1].toM).toBe(1000);
  });

  it('дни без метров отрезков не создают', () => {
    expect(routeSegments(route(), [day('2026-09-10', {})])).toHaveLength(0);
  });

  it('за конец трассы не вылезаем — геометрии там нет', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'кабелеукладчик': Math.round(TOTAL * 3) }),
    ]);
    // Кусок обрезается концом линии, но сам отрезок остаётся видимым.
    const last = segs[segs.length - 1].coords.at(-1)!;
    expect(last[1]).toBeCloseTo(71.1, 4);
  });

  it('порядок дней важнее порядка записей в журнале', () => {
    const segs = routeSegments(route(), [
      day('2026-09-12', { 'бар': 300 }),
      day('2026-09-10', { 'кабелеукладчик': 500 }),
    ]);
    expect(segs[0].method).toBe('кабелеукладчик');
  });
});

describe('сводка и ККС', () => {
  it('складывает метры по способам, больший сверху', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'кабелеукладчик': 400 }),
      day('2026-09-11', { 'бар': 900 }),
    ]);
    const totals = segmentTotals(segs);
    expect(totals[0].method).toBe('бар');
    expect(totals[0].meters).toBe(900);
    expect(totals[0].color).toBe(METHOD_COLOR['бар']);
  });

  it('ККС — конец куска по существующей канализации', () => {
    const segs = routeSegments(route(), [
      day('2026-09-10', { 'сущ_канализация': 700 }),
      day('2026-09-11', { 'бар': 300 }),
    ]);
    const pts = kksPoints(segs);
    expect(pts).toHaveLength(1);
    expect(pts[0].atM).toBe(700);
  });

  it('без колодцев отметок ККС нет', () => {
    const segs = routeSegments(route(), [day('2026-09-10', { 'бар': 300 })]);
    expect(kksPoints(segs)).toHaveLength(0);
  });
});

/**
 * На трассе из KML вершин тысячи, а кусков за ней — по куску на каждый
 * способ каждой смены. Пересчёт длины от начала на каждой вершине
 * превращал перерисовку карты в секунды ожидания.
 */
describe('резка длинной трассы не квадратична', () => {
  /** Прямая на восток из n вершин, примерно 11 км. */
  function long(n: number): [number, number][] {
    return Array.from({ length: n }, (_, i) => [52, 71 + (i * 0.1) / (n - 1)] as [number, number]);
  }

  it('кусок длинной трассы остаётся правильным', () => {
    const coords = long(2000);
    const piece = sliceByDistance(coords, 1000, 3000);
    expect(routeLengthM(piece)).toBeCloseTo(2000, 0);
    expect(piece.length).toBeGreaterThan(100);
  });

  it('вчетверо больше вершин — не вшестнадцатеро дольше', () => {
    const time = (n: number) => {
      const coords = long(n);
      const t = performance.now();
      for (let k = 0; k < 20; k += 1) sliceByDistance(coords, 1000, 3000);
      return performance.now() - t;
    };
    time(500); // прогрев
    const small = Math.max(time(1000), 0.5);
    const big = time(4000);
    // При квадратичном росте это было бы около шестнадцати.
    expect(big / small).toBeLessThan(8);
  });

  it('куски подряд дают всю трассу без потерь', () => {
    const coords = long(500);
    const total = routeLengthM(coords);
    const a = sliceByDistance(coords, 0, total / 2);
    const b = sliceByDistance(coords, total / 2, total);
    expect(routeLengthM(a) + routeLengthM(b)).toBeCloseTo(total, 0);
  });
});
