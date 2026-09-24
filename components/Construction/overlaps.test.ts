import { describe, it, expect } from 'vitest';
import { findOverlaps, sampleRoute, nearby, type OverlapRoute } from './overlaps';
import { routeLengthM } from './routeProgress';

/** Прямая на восток длиной примерно 3,3 км. */
const A: [number, number][] = [[53, 69], [53, 69.05]];
/** Та же линия, сдвинутая на несколько метров: это дубль. */
const A_SHIFTED: [number, number][] = [[53.00003, 69], [53.00003, 69.05]];
/** Совсем другая линия. */
const B: [number, number][] = [[52, 69], [52, 69.05]];

describe('sampleRoute', () => {
  it('расставляет точки с шагом и доходит до конца', () => {
    const pts = sampleRoute(A, 500);
    const total = routeLengthM(A);
    expect(pts.length).toBe(Math.floor(total / 500) + 1);
    expect(pts[0].lon).toBeCloseTo(69, 6);
  });

  it('из одной точки расставлять нечего', () => {
    expect(sampleRoute([[53, 69]], 100)).toEqual([]);
    expect(sampleRoute(A, 0)).toEqual([]);
  });
});

describe('findOverlaps', () => {
  it('находит линию, нарисованную дважды', () => {
    const pairs = findOverlaps([
      { id: 'a', name: 'Проект', coords: A },
      { id: 'b', name: 'Правка', coords: A_SHIFTED },
    ]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].share).toBeGreaterThan(0.8);
    expect(pairs[0].sharedM).toBeGreaterThan(2500);
  });

  it('разные трассы дублями не считает', () => {
    expect(findOverlaps([
      { id: 'a', name: 'Первая', coords: A },
      { id: 'b', name: 'Вторая', coords: B },
    ])).toEqual([]);
  });

  it('пересечение на перекрёстке — не дубль', () => {
    // Линия поперёк: общая только точка пересечения.
    const cross: [number, number][] = [[52.99, 69.025], [53.01, 69.025]];
    expect(findOverlaps([
      { id: 'a', name: 'Вдоль', coords: A },
      { id: 'b', name: 'Поперёк', coords: cross },
    ])).toEqual([]);
  });

  it('пара сообщается один раз, а не с двух сторон', () => {
    const pairs = findOverlaps([
      { id: 'b', name: 'Правка', coords: A_SHIFTED },
      { id: 'a', name: 'Проект', coords: A },
    ]);
    expect(pairs).toHaveLength(1);
  });

  it('длинные дубли идут первыми', () => {
    const shortDup: [number, number][] = [[53.2, 69], [53.2, 69.01]];
    const pairs = findOverlaps([
      { id: 'a', name: 'A', coords: A },
      { id: 'a2', name: 'A2', coords: A_SHIFTED },
      { id: 'c', name: 'C', coords: shortDup },
      { id: 'c2', name: 'C2', coords: [[53.20003, 69], [53.20003, 69.01]] },
    ], { minSharedM: 100 });
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(pairs[0].sharedM).toBeGreaterThanOrEqual(pairs[1].sharedM);
  });

  it('одна трасса сама с собой не пересекается', () => {
    expect(findOverlaps([{ id: 'a', name: 'A', coords: A }])).toEqual([]);
  });
});

describe('nearby', () => {
  const items = [
    { id: '1', label: 'Муфта 1', kind: 'mufta', lat: 53.0005, lon: 69 },
    { id: '2', label: 'ККС 2', kind: 'kks', lat: 53.01, lon: 69 },
    { id: '3', label: 'Далеко', kind: 'mufta', lat: 54, lon: 70 },
  ];

  it('ближайшее — первым', () => {
    const hits = nearby({ lat: 53, lon: 69 }, items);
    expect(hits[0].label).toBe('Муфта 1');
    expect(hits[0].distanceM).toBeLessThan(100);
  });

  it('за радиусом не показываем', () => {
    const hits = nearby({ lat: 53, lon: 69 }, items, 2000);
    expect(hits.map((h) => h.id)).not.toContain('3');
  });

  it('больше запрошенного не отдаёт', () => {
    expect(nearby({ lat: 53, lon: 69 }, items, 500_000, 2)).toHaveLength(2);
  });

  it('вокруг пусто — пустой ответ', () => {
    expect(nearby({ lat: 40, lon: 60 }, items)).toEqual([]);
  });
});

/**
 * Границы сетки не должны влиять на ответ. Раньше точка сравнивалась
 * только со своей клеткой, и две линии, идущие вдоль границы, теряли до
 * половины совпадений: дубль либо недосчитывался, либо не находился.
 */
describe('дубль находится независимо от того, куда легли клетки', () => {
  /** Прямая на восток от заданной точки. */
  function line(id: string, lat: number, lon0: number, lon1: number): OverlapRoute {
    return { id, name: id, coords: [[lat, lon0], [lat, lon1]] };
  }

  it('совпадающие линии дают почти всю свою длину', () => {
    const a = line('a', 52, 71, 71.05);
    const b = line('b', 52, 71, 71.05);
    const [pair] = findOverlaps([a, b], { stepM: 40, toleranceM: 25 });
    expect(pair).toBeTruthy();
    expect(pair.share).toBeGreaterThan(0.9);
  });

  it('ответ не зависит от сдвига линий по карте', () => {
    const shares: number[] = [];
    // Сдвигаем пару по долготе мелким шагом: на каждом сдвиге линии
    // ложатся на сетку клеток иначе.
    for (let k = 0; k < 12; k += 1) {
      const lon = 71 + k * 0.00037;
      const [pair] = findOverlaps(
        [line('a', 52, lon, lon + 0.05), line('b', 52, lon, lon + 0.05)],
        { stepM: 40, toleranceM: 25 },
      );
      shares.push(pair?.share ?? 0);
    }
    expect(Math.min(...shares)).toBeGreaterThan(0.9);
  });

  it('то же при сдвиге по широте', () => {
    const shares: number[] = [];
    for (let k = 0; k < 12; k += 1) {
      const lat = 52 + k * 0.00023;
      const [pair] = findOverlaps(
        [line('a', lat, 71, 71.05), line('b', lat, 71, 71.05)],
        { stepM: 40, toleranceM: 25 },
      );
      shares.push(pair?.share ?? 0);
    }
    expect(Math.min(...shares)).toBeGreaterThan(0.9);
  });

  it('линии в стороне друг от друга дублем не считаются', () => {
    // 0,01° широты ≈ 1,1 км — это разные трассы.
    const pairs = findOverlaps(
      [line('a', 52, 71, 71.05), line('b', 52.01, 71, 71.05)],
      { stepM: 40, toleranceM: 25 },
    );
    expect(pairs).toHaveLength(0);
  });

  it('общий кусок не длиннее того, что видит каждая линия', () => {
    // Вторая линия короче: общий кусок мерится по ней, а не по первой.
    const [pair] = findOverlaps(
      [line('a', 52, 71, 71.05), line('b', 52, 71, 71.015)],
      { stepM: 40, toleranceM: 25, minSharedM: 100 },
    );
    expect(pair).toBeTruthy();
    expect(pair.sharedM).toBeLessThanOrEqual(1100);
    expect(pair.sharedM).toBeGreaterThan(900);
  });
});
