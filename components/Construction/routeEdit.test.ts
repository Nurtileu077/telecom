import { describe, it, expect } from 'vitest';
import { splitRoute, joinRoutes, joinedName, splitNames } from './routeEdit';
import { routeLengthM } from './routeProgress';

const LINE: [number, number][] = [[53, 69], [53, 69.05], [53, 69.1]];

describe('splitRoute', () => {
  it('две половины в сумме дают исходную длину', () => {
    const total = routeLengthM(LINE);
    const s = splitRoute(LINE, total / 2)!;
    expect(s.headM + s.tailM).toBeCloseTo(total, 3);
  });

  it('разрез в точке — конец первой и начало второй совпадают', () => {
    const s = splitRoute(LINE, routeLengthM(LINE) / 3)!;
    expect(s.head[s.head.length - 1]).toEqual(s.tail[0]);
  });

  it('у самого края не режем: огрызок — не участок', () => {
    expect(splitRoute(LINE, 1)).toBeNull();
    expect(splitRoute(LINE, routeLengthM(LINE) - 1)).toBeNull();
    expect(splitRoute(LINE, 0)).toBeNull();
  });

  it('из одной точки резать нечего', () => {
    expect(splitRoute([[53, 69]], 10)).toBeNull();
  });

  it('повороты остаются в своей половине', () => {
    const elbow: [number, number][] = [[53, 69], [53, 69.1], [53.1, 69.1]];
    const s = splitRoute(elbow, routeLengthM(elbow) * 0.9)!;
    // Вершина угла попала в первую половину — значит она и правда длиннее.
    expect(s.head.length).toBeGreaterThanOrEqual(3);
  });
});

describe('joinRoutes', () => {
  const A: [number, number][] = [[53, 69], [53, 69.05]];
  const B: [number, number][] = [[53, 69.05], [53, 69.1]];

  it('склеивает конец с началом', () => {
    const j = joinRoutes(A, B)!;
    expect(j.gapM).toBeLessThan(0.5);
    expect(j.coords).toEqual([[53, 69], [53, 69.05], [53, 69.1]]);
    expect(j.reversedA).toBe(false);
    expect(j.reversedB).toBe(false);
  });

  it('разворачивает вторую, если она нарисована навстречу', () => {
    const j = joinRoutes(A, [...B].reverse())!;
    expect(j.reversedB).toBe(true);
    expect(j.coords[j.coords.length - 1]).toEqual([53, 69.1]);
  });

  it('разворачивает первую, если стыкуются начала', () => {
    const j = joinRoutes([...A].reverse(), B)!;
    expect(j.reversedA).toBe(true);
    expect(j.coords[0]).toEqual([53, 69]);
  });

  it('далеко друг от друга — это две разные трассы', () => {
    expect(joinRoutes(A, [[52, 60], [52, 60.1]], 250)).toBeNull();
  });

  it('разрыв в пределах допуска перешагиваем и честно его называем', () => {
    const gapped: [number, number][] = [[53, 69.052], [53, 69.1]];
    const j = joinRoutes(A, gapped, 250)!;
    expect(j.gapM).toBeGreaterThan(100);
    expect(j.gapM).toBeLessThan(250);
    // Точку стыка не выбрасываем: разрыв настоящий, и он должен быть виден.
    expect(j.coords).toHaveLength(4);
  });

  it('разрезали и склеили — вернулись к тому же', () => {
    const s = splitRoute(LINE, routeLengthM(LINE) / 2)!;
    const j = joinRoutes(s.head, s.tail)!;
    expect(routeLengthM(j.coords)).toBeCloseTo(routeLengthM(LINE), 3);
  });
});

describe('имена', () => {
  it('склеенная линия называет обе', () => {
    expect(joinedName('Зеренда — Серафимовка', 'Серафимовка — Школа'))
      .toBe('Зеренда — Серафимовка + Серафимовка — Школа');
  });

  it('одинаковые названия не задваиваются', () => {
    expect(joinedName('Трасса 7', 'Трасса 7')).toBe('Трасса 7');
  });

  it('половины подписаны номерами', () => {
    expect(splitNames('Зеренда — Серафимовка'))
      .toEqual(['Зеренда — Серафимовка (1)', 'Зеренда — Серафимовка (2)']);
  });

  it('без названия — всё равно читаемо', () => {
    expect(splitNames('')).toEqual(['Трасса (1)', 'Трасса (2)']);
    expect(joinedName('', '')).toBe('Трасса');
  });
});
